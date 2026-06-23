import hashlib
import json
import re
import time
from pathlib import Path

import pandas as pd

import skillsfuture_config as settings
from skillsfuture_db import connect, json_dumps, utc_now, initialize_database


COURSE_SOURCE = "skillsfuture.local_excel"
DATASET_IDS = {
    "courses": "skillsfuture-course-directory",
    "course-runs": "skillsfuture-course-runs",
}


class SchemaDriftError(RuntimeError):
    pass


class LocalDataset:
    def __init__(self, dataset_id, metadata, file_path, sha256):
        self.dataset_id = dataset_id
        self.metadata = metadata
        self.file_path = Path(file_path)
        self.sha256 = sha256


def normalize_column(name):
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def find_column(columns, candidates, required=False):
    normalized = {normalize_column(column): column for column in columns}
    for candidate in candidates:
        key = normalize_column(candidate)
        if key in normalized:
            return normalized[key]
    if required:
        raise SchemaDriftError(f"Missing required source column. Tried: {', '.join(candidates)}")
    return None


def first_value(row, columns):
    for column in columns:
        if column and column in row and pd.notna(row[column]):
            value = str(row[column]).strip()
            if value:
                return value
    return ""


def parse_float(value):
    if value is None:
        return None
    cleaned = str(value).strip().replace(",", "")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def as_json_record(row):
    result = {}
    for key, value in row.items():
        if pd.isna(value):
            result[str(key)] = None
        elif hasattr(value, "isoformat"):
            result[str(key)] = value.isoformat()
        else:
            result[str(key)] = value
    return result


def inspect_workbook(path):
    excel = pd.ExcelFile(path)
    sheets = []
    for sheet_name in excel.sheet_names:
        frame = pd.read_excel(path, sheet_name=sheet_name, nrows=5)
        sheets.append({
            "sheet_name": sheet_name,
            "columns": [str(column) for column in frame.columns],
            "sample_rows": int(len(frame)),
        })
    return sheets


def load_non_empty_sheets(path):
    excel = pd.ExcelFile(path)
    frames = []
    for sheet_name in excel.sheet_names:
        frame = pd.read_excel(path, sheet_name=sheet_name)
        frame = frame.dropna(how="all")
        if frame.empty:
            continue
        frame["_source_sheet"] = sheet_name
        frames.append(frame)
    if not frames:
        raise SchemaDriftError("Workbook does not contain non-empty sheets")
    return pd.concat(frames, ignore_index=True)


def map_course_row(row, columns, source_last_updated_at):
    course_id_col = find_column(columns, [
        "course id", "course code", "course reference number", "coursereferencenumber",
        "course run course id", "external course id"
    ], required=True)
    title_col = find_column(columns, ["course title", "coursetitle", "title", "course name"], required=True)
    description_col = find_column(columns, [
        "course description", "description", "course synopsis", "synopsis", "about this course", "about_this_course"
    ])
    objective_col = find_column(columns, [
        "course objectives", "objectives", "learning objectives", "what you learn", "what_you_learn"
    ])
    provider_col = find_column(columns, [
        "training provider", "provider", "provider name", "organisation name",
        "trainingprovideralias", "training provider alias"
    ])
    category_col = find_column(columns, ["category", "course category", "area of training"])
    level_col = find_column(columns, ["level", "course level"])
    duration_col = find_column(columns, ["duration", "course duration", "training duration", "number_of_hours", "number of hours"])
    duration_unit_col = find_column(columns, ["duration unit", "course duration unit"])
    delivery_col = find_column(columns, ["mode of training", "delivery mode", "training mode", "conducted_in", "conducted in"])
    fee_col = find_column(columns, ["fee", "course fee", "full fee", "full_course_fee", "nett fee"])
    subsidised_fee_col = find_column(columns, ["course_fee_after_subsidies", "course fee after subsidies"])

    external_course_id = first_value(row, [course_id_col])
    if not external_course_id:
        raise SchemaDriftError("Course row is missing external course ID")

    return {
        "source": COURSE_SOURCE,
        "external_course_id": external_course_id,
        "title": first_value(row, [title_col]) or "Untitled course",
        "description": first_value(row, [description_col]),
        "objectives": first_value(row, [objective_col]),
        "provider_name": first_value(row, [provider_col]),
        "category": first_value(row, [category_col]),
        "level": first_value(row, [level_col]),
        "duration_value": parse_float(first_value(row, [duration_col])),
        "duration_unit": first_value(row, [duration_unit_col]) or ("hours" if first_value(row, [duration_col]) else ""),
        "delivery_modes": json_dumps([first_value(row, [delivery_col])] if first_value(row, [delivery_col]) else []),
        "fee_info": json_dumps({
            key: value for key, value in {
                "full_course_fee": first_value(row, [fee_col]),
                "course_fee_after_subsidies": first_value(row, [subsidised_fee_col]),
            }.items() if value
        }),
        "support_dates": json_dumps({}),
        "source_last_updated_at": source_last_updated_at,
        "raw_source_data": json_dumps(as_json_record(row)),
    }


def map_course_run_row(row, columns):
    run_id_col = find_column(columns, ["course run id", "run id", "course run code", "external run id"])
    course_id_col = find_column(columns, [
        "course id", "course code", "course reference number", "coursereferencenumber", "external course id"
    ], required=True)
    start_col = find_column(columns, ["start date", "course start date", "run start date", "courserunstartdate"])
    end_col = find_column(columns, ["end date", "course end date", "run end date", "courserunenddate"])
    deadline_col = find_column(columns, ["registration deadline", "registration closing date", "application closing date"])
    mode_col = find_column(columns, ["mode of training", "mode_of_training", "delivery mode", "training mode"])
    venue_col = find_column(columns, ["venue", "training venue", "location"])
    status_col = find_column(columns, ["status", "run status"])
    fee_col = find_column(columns, ["fee", "course fee", "full fee", "nett fee"])

    external_course_id = first_value(row, [course_id_col])
    if not external_course_id:
        raise SchemaDriftError("Course run row is missing course ID")
    external_run_id = first_value(row, [run_id_col])
    if not external_run_id:
        generated_parts = [
            external_course_id,
            first_value(row, [start_col]),
            first_value(row, [end_col]),
            first_value(row, [mode_col]),
        ]
        external_run_id = "generated-" + hashlib.sha256("|".join(generated_parts).encode("utf-8")).hexdigest()[:16]

    return {
        "source": COURSE_SOURCE,
        "external_run_id": external_run_id,
        "external_course_id": external_course_id,
        "start_date": first_value(row, [start_col]),
        "end_date": first_value(row, [end_col]),
        "registration_deadline": first_value(row, [deadline_col]),
        "delivery_mode": first_value(row, [mode_col]),
        "venue": first_value(row, [venue_col]),
        "schedule_details": json_dumps({}),
        "fee_info": json_dumps({"source_fee": first_value(row, [fee_col])} if first_value(row, [fee_col]) else {}),
        "run_status": first_value(row, [status_col]),
        "raw_source_data": json_dumps(as_json_record(row)),
    }


def latest_successful_sync(conn, dataset_id):
    return conn.execute(
        """
        SELECT * FROM dataset_sync_runs
        WHERE dataset_id = ? AND status = 'success'
        ORDER BY completed_at DESC
        LIMIT 1
        """,
        (dataset_id,),
    ).fetchone()


def deactivate_missing_records(conn, table_name, external_id_column, seen_ids, now):
    if not seen_ids:
        return 0

    deactivated = 0
    rows = conn.execute(
        f"""
        SELECT id, {external_id_column}
        FROM {table_name}
        WHERE source = ? AND is_active = 1
        """,
        (COURSE_SOURCE,),
    ).fetchall()
    for row in rows:
        if row[external_id_column] in seen_ids:
            continue
        cursor = conn.execute(
            f"UPDATE {table_name} SET is_active = 0, updated_at = ? WHERE id = ?",
            (now, row["id"]),
        )
        deactivated += cursor.rowcount
    return deactivated


def local_dataset_path(dataset):
    if dataset == "courses":
        return settings.LOCAL_COURSE_DIRECTORY_XLSX
    return settings.LOCAL_COURSE_RUN_XLSX


def load_local_dataset(dataset, dataset_id):
    path = local_dataset_path(dataset)
    if not path.exists():
        raise FileNotFoundError(f"Local backup XLSX not found: {path}")
    content = path.read_bytes()
    if not content.startswith(b"PK"):
        raise SchemaDriftError(f"Local backup file is not a valid XLSX archive: {path}")
    return LocalDataset(
        dataset_id=dataset_id,
        metadata={
            "source": "local-backup",
            "fileName": path.name,
            "lastUpdatedAt": path.stat().st_mtime,
        },
        file_path=path,
        sha256=hashlib.sha256(content).hexdigest(),
    )


def upsert_courses(conn, records):
    now = utc_now()
    inserted = updated = 0
    seen = set()
    for record in records:
        seen.add(record["external_course_id"])
        existing = conn.execute(
            "SELECT id FROM courses WHERE source = ? AND external_course_id = ?",
            (record["source"], record["external_course_id"]),
        ).fetchone()
        if existing:
            updated += 1
            conn.execute(
                """
                UPDATE courses SET title = ?, description = ?, objectives = ?, provider_name = ?,
                    category = ?, level = ?, duration_value = ?, duration_unit = ?, delivery_modes = ?,
                    fee_info = ?, support_dates = ?, source_last_updated_at = ?, raw_source_data = ?,
                    is_active = 1, updated_at = ?
                WHERE id = ?
                """,
                (
                    record["title"], record["description"], record["objectives"], record["provider_name"],
                    record["category"], record["level"], record["duration_value"], record["duration_unit"],
                    record["delivery_modes"], record["fee_info"], record["support_dates"],
                    record["source_last_updated_at"], record["raw_source_data"], now, existing["id"],
                ),
            )
        else:
            inserted += 1
            conn.execute(
                """
                INSERT INTO courses (
                    source, external_course_id, title, description, objectives, provider_name,
                    category, level, duration_value, duration_unit, delivery_modes, fee_info,
                    support_dates, source_last_updated_at, raw_source_data, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    record["source"], record["external_course_id"], record["title"], record["description"],
                    record["objectives"], record["provider_name"], record["category"], record["level"],
                    record["duration_value"], record["duration_unit"], record["delivery_modes"],
                    record["fee_info"], record["support_dates"], record["source_last_updated_at"],
                    record["raw_source_data"], now, now,
                ),
            )

    deactivated = deactivate_missing_records(conn, "courses", "external_course_id", seen, now)
    return inserted, updated, deactivated


def upsert_course_runs(conn, records):
    now = utc_now()
    inserted = updated = 0
    seen = set()
    for record in records:
        seen.add(record["external_run_id"])
        course = conn.execute(
            "SELECT id FROM courses WHERE source = ? AND external_course_id = ?",
            (record["source"], record["external_course_id"]),
        ).fetchone()
        course_id = course["id"] if course else None
        existing = conn.execute(
            "SELECT id FROM course_runs WHERE source = ? AND external_run_id = ?",
            (record["source"], record["external_run_id"]),
        ).fetchone()
        values = (
            record["external_course_id"], course_id, record["start_date"], record["end_date"],
            record["registration_deadline"], record["delivery_mode"], record["venue"],
            record["schedule_details"], record["fee_info"], record["run_status"],
            record["raw_source_data"], now,
        )
        if existing:
            updated += 1
            conn.execute(
                """
                UPDATE course_runs SET external_course_id = ?, course_id = ?, start_date = ?, end_date = ?,
                    registration_deadline = ?, delivery_mode = ?, venue = ?, schedule_details = ?,
                    fee_info = ?, run_status = ?, raw_source_data = ?, is_active = 1, updated_at = ?
                WHERE id = ?
                """,
                (*values, existing["id"]),
            )
        else:
            inserted += 1
            conn.execute(
                """
                INSERT INTO course_runs (
                    source, external_run_id, external_course_id, course_id, start_date, end_date,
                    registration_deadline, delivery_mode, venue, schedule_details, fee_info,
                    run_status, raw_source_data, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    record["source"], record["external_run_id"], record["external_course_id"], course_id,
                    record["start_date"], record["end_date"], record["registration_deadline"],
                    record["delivery_mode"], record["venue"], record["schedule_details"],
                    record["fee_info"], record["run_status"], record["raw_source_data"], now, now,
                ),
            )
    deactivated = deactivate_missing_records(conn, "course_runs", "external_run_id", seen, now)
    return inserted, updated, deactivated


def build_skill_dictionary(conn):
    return conn.execute("SELECT id, canonical_name, aliases FROM skills").fetchall()


def map_courses_to_skills(conn, changed_course_ids=None):
    skills = build_skill_dictionary(conn)
    courses = conn.execute(
        """
        SELECT id, title, description, objectives, category
        FROM courses
        WHERE is_active = 1
        """
    ).fetchall()
    changed = set(changed_course_ids or [])
    mapped = 0
    for course in courses:
        if changed and course["id"] not in changed:
            continue
        searchable = " ".join(str(course[key] or "") for key in ["title", "description", "objectives", "category"]).lower()
        for skill in skills:
            names = [skill["canonical_name"], *json.loads(skill["aliases"] or "[]")]
            evidence = ""
            for name in names:
                if not name:
                    continue
                pattern = r"\b" + re.escape(str(name).lower()) + r"\b"
                if re.search(pattern, searchable):
                    evidence = name
                    break
            if not evidence:
                continue
            confidence = "high" if evidence.lower() == skill["canonical_name"].lower() else "medium"
            score = 0.9 if confidence == "high" else 0.65
            conn.execute(
                """
                INSERT INTO course_skills (course_id, skill_id, coverage_score, confidence, source, evidence_text)
                VALUES (?, ?, ?, ?, 'keyword', ?)
                ON CONFLICT(course_id, skill_id)
                DO UPDATE SET coverage_score = excluded.coverage_score,
                              confidence = excluded.confidence,
                              source = excluded.source,
                              evidence_text = excluded.evidence_text
                """,
                (course["id"], skill["id"], score, confidence, evidence),
            )
            mapped += 1
    return mapped


def sync_dataset(dataset, force=False, dry_run=False):
    initialize_database()
    dataset_id = DATASET_IDS[dataset]
    started_at = utc_now()
    started_time = time.perf_counter()
    downloaded = load_local_dataset(dataset, dataset_id)
    metadata = downloaded.metadata
    source_last_updated_at = (
        metadata.get("lastUpdatedAt")
        or metadata.get("last_updated_at")
        or metadata.get("lastUpdated")
        or ""
    )
    sheets = inspect_workbook(downloaded.file_path)

    conn = connect()
    try:
        previous = latest_successful_sync(conn, dataset_id)
        if previous and previous["sha256"] == downloaded.sha256 and not force:
            return {
                "dataset": dataset,
                "dataset_id": dataset_id,
                "status": "skipped",
                "reason": "unchanged",
                "source_used": "local",
                "sha256": downloaded.sha256,
                "sheets": sheets,
            }

        frame = load_non_empty_sheets(downloaded.file_path)
        columns = list(frame.columns)
        if dataset == "courses":
            records = [map_course_row(row, columns, source_last_updated_at) for _, row in frame.iterrows()]
        else:
            records = [map_course_run_row(row, columns) for _, row in frame.iterrows()]

        if dry_run:
            return {
                "dataset": dataset,
                "dataset_id": dataset_id,
                "status": "dry-run",
                "source_used": "local",
                "rows_read": len(records),
                "sha256": downloaded.sha256,
                "sheets": sheets,
                "columns": [str(column) for column in columns],
            }

        with conn:
            if dataset == "courses":
                inserted, updated, deactivated = upsert_courses(conn, records)
                mapped = map_courses_to_skills(conn)
            else:
                inserted, updated, deactivated = upsert_course_runs(conn, records)
                mapped = 0
            conn.execute(
                """
                INSERT INTO dataset_sync_runs (
                    dataset_id, dataset_name, source_last_updated_at, raw_file_path, sha256, status,
                    rows_read, rows_inserted, rows_updated, rows_deactivated, warnings, error_message,
                    started_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, 'success', ?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    dataset_id, dataset, source_last_updated_at, str(downloaded.file_path), downloaded.sha256,
                    len(records), inserted, updated, deactivated, json_dumps({"sheets": sheets, "mapped_skills": mapped}),
                    started_at, utc_now(),
                ),
            )

        return {
            "dataset": dataset,
            "dataset_id": dataset_id,
            "status": "success",
            "source_used": "local",
            "rows_read": len(records),
            "rows_inserted": inserted,
            "rows_updated": updated,
            "rows_deactivated": deactivated,
            "mapped_skills": mapped,
            "duration_seconds": round(time.perf_counter() - started_time, 2),
            "sha256": downloaded.sha256,
            "sheets": sheets,
            "columns": [str(column) for column in columns],
        }
    except Exception as exc:
        with conn:
            conn.execute(
                """
                INSERT INTO dataset_sync_runs (
                    dataset_id, dataset_name, raw_file_path, sha256, status, error_message,
                    started_at, completed_at
                ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?)
                """,
                (dataset_id, dataset, str(downloaded.file_path), downloaded.sha256, str(exc), started_at, utc_now()),
            )
        raise
    finally:
        conn.close()


def sync_skillsfuture_data(dataset="all", force=False, dry_run=False):
    datasets = ["courses", "course-runs"] if dataset == "all" else [dataset]
    return [sync_dataset(item, force=force, dry_run=dry_run) for item in datasets]
