from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np

from skillsfuture_db import connect, json_loads


def clean_course_text(value):
    return " ".join(str(value or "").replace("_x000D_", " ").split())


def build_course_embedding_text(course):
    parts = [
        f"Course: {clean_course_text(course.get('title'))}",
        f"Description: {clean_course_text(course.get('description'))}",
        f"Learning outcomes: {clean_course_text(course.get('objectives'))}",
        f"Category: {clean_course_text(course.get('category'))}",
        f"Level: {clean_course_text(course.get('level'))}",
    ]
    return " | ".join(part for part in parts if part.split(": ", 1)[-1])[:6000]


def parse_course_fee(course):
    fee_info = json_loads(course.get("fee_info"), {})
    for key in ("course_fee_after_subsidies", "subsidised_fee", "nett_fee", "full_course_fee"):
        try:
            value = float(str(fee_info.get(key, "")).replace(",", "").strip())
        except (TypeError, ValueError):
            continue
        if value >= 0:
            return value
    return None


def course_duration_hours(course):
    try:
        value = float(course.get("duration_value") or 0)
    except (TypeError, ValueError):
        return 0.0
    unit = str(course.get("duration_unit") or "").lower()
    if "day" in unit:
        return value * 8
    if "week" in unit:
        return value * 40
    return value


def confidence_label(score):
    if score >= 0.60:
        return "Strong match"
    if score >= 0.42:
        return "Good match"
    return "Possible match"


class CourseSemanticIndex:
    def __init__(self, path):
        self.path = Path(path)
        self.course_ids = np.array([], dtype=np.int64)
        self.embeddings = np.empty((0, 0), dtype=np.float32)
        self.model_name = ""
        self.generated_at = ""
        self.source_course_count = None
        self.source_max_updated_at = ""
        self.load_error = ""
        self.load()

    @property
    def ready(self):
        return bool(len(self.course_ids)) and self.embeddings.ndim == 2

    def load(self):
        if not self.path.exists():
            self.load_error = "Course semantic index file is missing"
            return
        try:
            with np.load(self.path, allow_pickle=False) as index:
                self.course_ids = index["course_ids"].astype(np.int64, copy=False)
                self.embeddings = index["embeddings"].astype(np.float32, copy=False)
                self.model_name = str(index["model_name"].item())
                if "generated_at" in index.files:
                    self.generated_at = str(index["generated_at"].item())
                if "source_course_count" in index.files:
                    self.source_course_count = int(index["source_course_count"].item())
                if "source_max_updated_at" in index.files:
                    self.source_max_updated_at = str(index["source_max_updated_at"].item())
            if len(self.course_ids) != len(self.embeddings):
                raise RuntimeError("Course embedding index contains mismatched IDs and vectors")
            if self.embeddings.ndim != 2 or self.embeddings.shape[1] == 0:
                raise RuntimeError("Course embedding index contains invalid vectors")
            self.load_error = ""
        except Exception as exc:
            self.course_ids = np.array([], dtype=np.int64)
            self.embeddings = np.empty((0, 0), dtype=np.float32)
            self.model_name = ""
            self.load_error = f"Course semantic index could not be loaded: {type(exc).__name__}"

    def freshness(self):
        if not self.ready:
            return {
                "status": "unavailable",
                "stale": True,
                "reason": self.load_error or "Course semantic index is empty",
            }
        try:
            conn = connect()
            try:
                row = conn.execute(
                    """
                    SELECT COUNT(*) AS course_count, MAX(updated_at) AS max_updated_at
                    FROM courses
                    WHERE is_active = 1
                    """
                ).fetchone()
            finally:
                conn.close()
        except Exception as exc:
            return {
                "status": "unknown",
                "stale": True,
                "reason": f"Course database could not be checked: {type(exc).__name__}",
            }

        active_count = int(row["course_count"] or 0)
        max_updated_at = str(row["max_updated_at"] or "")
        reasons = []
        expected_count = self.source_course_count
        if expected_count is None:
            expected_count = len(self.course_ids)
        if active_count != expected_count or active_count != len(self.course_ids):
            reasons.append(
                f"index has {len(self.course_ids)} courses but database has {active_count}"
            )

        index_timestamp = self.generated_at
        if not index_timestamp:
            index_timestamp = datetime.fromtimestamp(
                self.path.stat().st_mtime,
                tz=timezone.utc,
            ).isoformat()
        if max_updated_at and index_timestamp and max_updated_at > index_timestamp:
            reasons.append("course data changed after the index was generated")
        if self.source_max_updated_at and max_updated_at != self.source_max_updated_at:
            reasons.append("course database update marker differs from the index")

        return {
            "status": "stale" if reasons else "fresh",
            "stale": bool(reasons),
            "reason": "; ".join(dict.fromkeys(reasons)),
            "generated_at": index_timestamp,
            "indexed_courses": len(self.course_ids),
            "active_courses": active_count,
        }

    def search(
        self,
        query_embeddings,
        skills,
        limit=10,
        available_credit=None,
        max_budget=None,
        maximum_duration_hours=None,
        require_upcoming_run=False,
    ):
        if not self.ready:
            raise RuntimeError("Course embedding index is not available")

        vectors = np.asarray(query_embeddings, dtype=np.float32)
        if vectors.ndim == 1:
            vectors = vectors.reshape(1, -1)
        if vectors.shape[1] != self.embeddings.shape[1]:
            raise RuntimeError("Course index and query embedding dimensions do not match")
        query_vector = vectors.mean(axis=0)
        norm = np.linalg.norm(query_vector)
        if norm == 0:
            return []
        query_vector /= norm

        semantic_scores = self.embeddings @ query_vector
        candidate_count = min(max(limit * 30, 200), len(self.course_ids))
        if candidate_count == len(self.course_ids):
            candidate_indexes = np.arange(len(self.course_ids))
        else:
            candidate_indexes = np.argpartition(semantic_scores, -candidate_count)[-candidate_count:]
        candidate_indexes = candidate_indexes[np.argsort(semantic_scores[candidate_indexes])[::-1]]
        candidate_ids = [int(self.course_ids[index]) for index in candidate_indexes]

        courses, upcoming_course_ids, upcoming_runs = self._load_candidates(candidate_ids)
        for course in courses:
            course["upcoming_runs"] = upcoming_runs.get(course["id"], [])
        course_by_id = {course["id"]: course for course in courses}
        index_by_id = {
            int(self.course_ids[index]): index
            for index in candidate_indexes
        }

        ranked = []
        for course_id in candidate_ids:
            course = course_by_id.get(course_id)
            if not course:
                continue

            fee = parse_course_fee(course)
            duration_hours = course_duration_hours(course)
            has_upcoming_run = course_id in upcoming_course_ids
            if max_budget is not None and fee is not None and fee > max_budget:
                continue
            if maximum_duration_hours is not None and duration_hours > maximum_duration_hours:
                continue
            if require_upcoming_run and not has_upcoming_run:
                continue

            vector_index = index_by_id[course_id]
            semantic_score = float(semantic_scores[vector_index])
            per_skill_scores = self.embeddings[vector_index] @ vectors.T
            matched_skills = [
                {
                    "skill": skill,
                    "score": round(float(score), 4),
                }
                for skill, score in sorted(
                    zip(skills, per_skill_scores),
                    key=lambda item: item[1],
                    reverse=True,
                )[:3]
            ]

            budget_reference = available_credit if available_credit is not None else max_budget
            if budget_reference is None or fee is None:
                affordability_score = 0.5
            elif budget_reference <= 0:
                affordability_score = 1.0 if fee == 0 else 0.0
            else:
                affordability_score = max(0.0, 1.0 - (fee / budget_reference))
            availability_score = 1.0 if has_upcoming_run else 0.25
            total_score = (
                max(semantic_score, 0.0) * 0.80
                + affordability_score * 0.10
                + availability_score * 0.10
            )

            top_skill_names = [item["skill"] for item in matched_skills if item["score"] > 0]
            explanation = (
                f"{confidence_label(semantic_score)} for "
                f"{', '.join(top_skill_names[:2]) or 'the selected skills'}."
            )
            if has_upcoming_run:
                explanation += " An active course run is available."

            ranked.append({
                "course": course,
                "semantic_score": round(semantic_score, 4),
                "affordability_score": round(affordability_score, 4),
                "availability_score": round(availability_score, 4),
                "total_score": round(total_score, 4),
                "confidence_label": confidence_label(semantic_score),
                "matched_skills": matched_skills,
                "has_upcoming_run": has_upcoming_run,
                "estimated_fee": fee,
                "duration_hours": round(duration_hours, 2),
                "explanation": explanation,
            })

        ranked.sort(key=lambda item: (-item["total_score"], item["course"]["title"]))
        return ranked[:limit]

    @staticmethod
    def _load_candidates(course_ids):
        if not course_ids:
            return [], set(), {}
        placeholders = ",".join("?" for _ in course_ids)
        conn = connect()
        try:
            courses = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT *
                    FROM courses
                    WHERE is_active = 1 AND id IN ({placeholders})
                    """,
                    course_ids,
                ).fetchall()
            ]
            upcoming_rows = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT id, course_id, external_run_id, start_date, end_date,
                           registration_deadline, delivery_mode, venue, run_status
                    FROM course_runs
                    WHERE is_active = 1
                      AND course_id IN ({placeholders})
                      AND (start_date IS NULL OR start_date >= ?)
                    ORDER BY start_date
                    """,
                    [*course_ids, date.today().isoformat()],
                ).fetchall()
            ]
            upcoming_by_course = {}
            for run in upcoming_rows:
                upcoming_by_course.setdefault(run["course_id"], []).append(run)
            upcoming = set(upcoming_by_course)
            return courses, upcoming, {
                course_id: runs[:3]
                for course_id, runs in upcoming_by_course.items()
            }
        finally:
            conn.close()
