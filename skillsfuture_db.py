import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import skillsfuture_config as settings


MIGRATIONS_DIR = settings.PROJECT_ROOT / "migrations"


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def connect(db_path=None):
    path = Path(db_path or settings.COURSE_DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def transaction(db_path=None):
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def apply_migrations(db_path=None):
    with transaction(db_path) as conn:
        for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
            conn.executescript(migration.read_text(encoding="utf-8"))


def row_to_dict(row):
    return dict(row) if row is not None else None


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def json_dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def json_loads(value, default=None):
    if value in (None, ""):
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def get_or_create_skill(conn, canonical_name, aliases=None, category=None, description=None):
    canonical_name = str(canonical_name).strip()
    if not canonical_name:
        raise ValueError("canonical_name is required")

    existing = conn.execute(
        "SELECT id, aliases FROM skills WHERE lower(canonical_name) = lower(?)",
        (canonical_name,),
    ).fetchone()
    if existing:
        existing_aliases = set(json_loads(existing["aliases"], []))
        for alias in aliases or []:
            if alias:
                existing_aliases.add(str(alias).strip())
        conn.execute(
            "UPDATE skills SET aliases = ?, category = COALESCE(?, category), description = COALESCE(?, description) WHERE id = ?",
            (json_dumps(sorted(existing_aliases)), category, description, existing["id"]),
        )
        return existing["id"]

    cursor = conn.execute(
        "INSERT INTO skills (canonical_name, aliases, category, description) VALUES (?, ?, ?, ?)",
        (canonical_name, json_dumps(aliases or []), category, description),
    )
    return cursor.lastrowid


def seed_career_roles(db_path=None, seed_path=None):
    path = Path(seed_path or settings.CAREER_ROLES_SEED_PATH)
    if not path.exists():
        return {"roles": 0, "skills": 0}

    roles = json.loads(path.read_text(encoding="utf-8"))
    role_count = 0
    skill_count = 0
    with transaction(db_path) as conn:
        for role in roles:
            title = role["title"].strip()
            existing = conn.execute("SELECT id FROM career_roles WHERE title = ?", (title,)).fetchone()
            if existing:
                role_id = existing["id"]
                conn.execute(
                    "UPDATE career_roles SET sector = ?, description = ?, is_active = 1 WHERE id = ?",
                    (role.get("sector"), role.get("description"), role_id),
                )
            else:
                cursor = conn.execute(
                    "INSERT INTO career_roles (title, sector, description, is_active) VALUES (?, ?, ?, 1)",
                    (title, role.get("sector"), role.get("description")),
                )
                role_id = cursor.lastrowid
            role_count += 1

            for skill in role.get("skills", []):
                skill_id = get_or_create_skill(
                    conn,
                    skill["canonical_name"],
                    skill.get("aliases", []),
                    role.get("sector"),
                    None,
                )
                conn.execute(
                    """
                    INSERT INTO role_skills (career_role_id, skill_id, required_level, importance_weight)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(career_role_id, skill_id)
                    DO UPDATE SET required_level = excluded.required_level,
                                  importance_weight = excluded.importance_weight
                    """,
                    (
                        role_id,
                        skill_id,
                        int(skill.get("required_level", 3)),
                        float(skill.get("importance_weight", 1.0)),
                    ),
                )
                skill_count += 1
    return {"roles": role_count, "skills": skill_count}


def initialize_database(db_path=None):
    apply_migrations(db_path)
    return seed_career_roles(db_path)
