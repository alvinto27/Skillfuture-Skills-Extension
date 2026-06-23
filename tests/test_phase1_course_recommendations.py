import io
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from course_semantic_search import CourseSemanticIndex
from skillsfuture_sync import SchemaDriftError, load_local_dataset, normalize_column
from skillsfuture_db import initialize_database, connect, get_or_create_skill, json_dumps, utc_now
import skillsfuture_config as settings
import course_recommender


def xlsx_bytes():
    buffer = io.BytesIO()
    pd.DataFrame([{"Course ID": "C1", "Course Title": "Python Basics"}]).to_excel(buffer, index=False)
    return buffer.getvalue()


class Phase1Tests(unittest.TestCase):
    def test_config_defaults_exist(self):
        self.assertEqual(settings.LOCAL_COURSE_DIRECTORY_XLSX.name, "MySkillsFutureCourseDirectory.xlsx")
        self.assertEqual(settings.LOCAL_COURSE_RUN_XLSX.name, "MySkillsFutureCourseRun.xlsx")

    def test_local_xlsx_is_loaded_and_hashed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "courses.xlsx"
            path.write_bytes(xlsx_bytes())
            old_path = settings.LOCAL_COURSE_DIRECTORY_XLSX
            settings.LOCAL_COURSE_DIRECTORY_XLSX = path
            try:
                dataset = load_local_dataset("courses", "skillsfuture-course-directory")
                self.assertEqual(dataset.file_path, path)
                self.assertEqual(len(dataset.sha256), 64)
            finally:
                settings.LOCAL_COURSE_DIRECTORY_XLSX = old_path

    def test_invalid_local_xlsx_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "courses.xlsx"
            path.write_bytes(b"not an xlsx")
            old_path = settings.LOCAL_COURSE_DIRECTORY_XLSX
            settings.LOCAL_COURSE_DIRECTORY_XLSX = path
            try:
                with self.assertRaises(SchemaDriftError):
                    load_local_dataset("courses", "skillsfuture-course-directory")
            finally:
                settings.LOCAL_COURSE_DIRECTORY_XLSX = old_path

    def test_column_normalisation(self):
        self.assertEqual(normalize_column(" Course  ID "), "course_id")
        self.assertEqual(normalize_column("Course-Run.ID"), "course_run_id")

    def test_recommendation_pathway_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "test.sqlite3"
            initialize_database(db_path)
            old_path = settings.COURSE_DB_PATH
            settings.COURSE_DB_PATH = db_path
            try:
                conn = connect(db_path)
                try:
                    skill_id = get_or_create_skill(conn, "SQL", ["Structured Query Language"])
                    now = utc_now()
                    cursor = conn.execute(
                        """
                        INSERT INTO courses (
                            source, external_course_id, title, description, objectives, provider_name,
                            category, level, delivery_modes, fee_info, support_dates,
                            source_last_updated_at, raw_source_data, is_active, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                        """,
                        (
                            "test", "C1", "SQL for Data Analysts", "Learn SQL", "SQL reporting",
                            "Provider", "ICT", "Beginner", json_dumps(["online"]), json_dumps({}),
                            json_dumps({}), now, json_dumps({"id": "C1"}), now, now,
                        ),
                    )
                    course_id = cursor.lastrowid
                    conn.execute(
                        """
                        INSERT INTO course_runs (
                            source, external_run_id, external_course_id, course_id, start_date,
                            registration_deadline, delivery_mode, venue, schedule_details,
                            fee_info, run_status, raw_source_data, is_active, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                        """,
                        (
                            "test", "R1", "C1", course_id, "2099-01-01", "2098-12-01",
                            "online", "Online", json_dumps({}), json_dumps({}), "open",
                            json_dumps({"id": "R1"}), now, now,
                        ),
                    )
                    conn.execute(
                        """
                        INSERT INTO course_skills (course_id, skill_id, coverage_score, confidence, source, evidence_text)
                        VALUES (?, ?, 0.9, 'high', 'manual', 'SQL')
                        """,
                        (course_id, skill_id),
                    )
                    conn.commit()
                finally:
                    conn.close()

                result = course_recommender.recommend_course_pathway(1, user_skills=[], constraints={})
                self.assertEqual(result["pathway"][0]["course"]["title"], "SQL for Data Analysts")
                self.assertGreater(result["pathway"][0]["total_score"], 0)
            finally:
                settings.COURSE_DB_PATH = old_path

    def test_semantic_course_search_ranks_and_filters(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "semantic.sqlite3"
            index_path = Path(tmp) / "course_embeddings.npz"
            initialize_database(db_path)
            old_path = settings.COURSE_DB_PATH
            settings.COURSE_DB_PATH = db_path
            try:
                conn = connect(db_path)
                try:
                    now = utc_now()
                    course_ids = []
                    for external_id, title, fee in [
                        ("PY1", "Python for Data Analysis", "400"),
                        ("LD1", "Leadership Essentials", "100"),
                    ]:
                        cursor = conn.execute(
                            """
                            INSERT INTO courses (
                                source, external_course_id, title, description, objectives,
                                provider_name, delivery_modes, fee_info, support_dates,
                                raw_source_data, is_active, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                            """,
                            (
                                "test", external_id, title, title, title, "Provider",
                                json_dumps(["online"]),
                                json_dumps({"course_fee_after_subsidies": fee}),
                                json_dumps({}), json_dumps({}), now, now,
                            ),
                        )
                        course_ids.append(cursor.lastrowid)
                    conn.execute(
                        """
                        INSERT INTO course_runs (
                            source, external_run_id, external_course_id, course_id, start_date,
                            delivery_mode, schedule_details, fee_info, raw_source_data,
                            is_active, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                        """,
                        (
                            "test", "RUN-PY1", "PY1", course_ids[0], "2099-01-01",
                            "online", json_dumps({}), json_dumps({}), json_dumps({}), now, now,
                        ),
                    )
                    conn.commit()
                finally:
                    conn.close()

                np.savez_compressed(
                    index_path,
                    course_ids=np.asarray(course_ids, dtype=np.int64),
                    embeddings=np.asarray([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32),
                    model_name=np.asarray("test-model"),
                )
                index = CourseSemanticIndex(index_path)
                recommendations = index.search(
                    query_embeddings=np.asarray([[1.0, 0.0]], dtype=np.float32),
                    skills=["Python"],
                    max_budget=500,
                    require_upcoming_run=True,
                )

                self.assertEqual(len(recommendations), 1)
                self.assertEqual(recommendations[0]["course"]["title"], "Python for Data Analysis")
                self.assertTrue(recommendations[0]["has_upcoming_run"])
                self.assertEqual(recommendations[0]["estimated_fee"], 400)
            finally:
                settings.COURSE_DB_PATH = old_path


if __name__ == "__main__":
    unittest.main()
