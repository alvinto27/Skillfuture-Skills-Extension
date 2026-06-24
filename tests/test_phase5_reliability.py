import tempfile
import time
import unittest
from pathlib import Path

import numpy as np

import course_recommender
import skillsfuture_config as settings
from course_semantic_search import CourseSemanticIndex
from reliability import SlidingWindowRateLimiter, TTLCache
from skill_index import load_skill_index
from skillsfuture_db import connect, initialize_database, json_dumps, utc_now


class Phase5ReliabilityTests(unittest.TestCase):
    def test_ttl_cache_is_bounded_and_expires(self):
        cache = TTLCache(max_size=2, ttl_seconds=0.02)
        cache.set("first", {"value": 1})
        cache.set("second", {"value": 2})
        cache.set("third", {"value": 3})

        self.assertIsNone(cache.get("first"))
        self.assertEqual(cache.get("third"), {"value": 3})
        time.sleep(0.03)
        self.assertIsNone(cache.get("third"))

    def test_rate_limiter_returns_retry_after(self):
        limiter = SlidingWindowRateLimiter(limit=2, window_seconds=1)
        self.assertEqual(limiter.check("client"), (True, 0))
        self.assertEqual(limiter.check("client"), (True, 0))
        allowed, retry_after = limiter.check("client")
        self.assertFalse(allowed)
        self.assertGreaterEqual(retry_after, 1)

    def test_missing_and_corrupt_course_indexes_are_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = CourseSemanticIndex(Path(tmp) / "missing.npz")
            self.assertFalse(missing.ready)
            self.assertEqual(missing.freshness()["status"], "unavailable")

            corrupt_path = Path(tmp) / "corrupt.npz"
            corrupt_path.write_bytes(b"not a numpy archive")
            corrupt = CourseSemanticIndex(corrupt_path)
            self.assertFalse(corrupt.ready)
            self.assertIn("could not be loaded", corrupt.load_error)

    def test_missing_and_corrupt_skill_indexes_are_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing_frame, missing_embeddings, missing_error = load_skill_index(
                Path(tmp) / "missing.pkl"
            )
            self.assertTrue(missing_frame.empty)
            self.assertEqual(missing_embeddings.size, 0)
            self.assertIn("missing", missing_error)

            corrupt_path = Path(tmp) / "corrupt.pkl"
            corrupt_path.write_bytes(b"not a pickle")
            corrupt_frame, corrupt_embeddings, corrupt_error = load_skill_index(corrupt_path)
            self.assertTrue(corrupt_frame.empty)
            self.assertEqual(corrupt_embeddings.size, 0)
            self.assertIn("could not be loaded", corrupt_error)

    def test_course_index_detects_database_count_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "courses.sqlite3"
            index_path = Path(tmp) / "courses.npz"
            initialize_database(db_path)
            old_db_path = settings.COURSE_DB_PATH
            settings.COURSE_DB_PATH = db_path
            try:
                conn = connect(db_path)
                try:
                    now = utc_now()
                    conn.execute(
                        """
                        INSERT INTO courses (
                            source, external_course_id, title, delivery_modes,
                            fee_info, support_dates, raw_source_data, is_active,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                        """,
                        (
                            "test",
                            "C1",
                            "Course One",
                            json_dumps([]),
                            json_dumps({}),
                            json_dumps({}),
                            json_dumps({}),
                            now,
                            now,
                        ),
                    )
                    conn.commit()
                finally:
                    conn.close()

                np.savez_compressed(
                    index_path,
                    course_ids=np.asarray([], dtype=np.int64),
                    embeddings=np.empty((0, 2), dtype=np.float32),
                    model_name=np.asarray("test"),
                )
                index = CourseSemanticIndex(index_path)
                self.assertEqual(index.freshness()["status"], "unavailable")

                np.savez_compressed(
                    index_path,
                    course_ids=np.asarray([1, 2], dtype=np.int64),
                    embeddings=np.asarray([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32),
                    model_name=np.asarray("test"),
                    generated_at=np.asarray("2099-01-01T00:00:00+00:00"),
                    source_course_count=np.asarray(2, dtype=np.int64),
                    source_max_updated_at=np.asarray(now),
                )
                stale = CourseSemanticIndex(index_path).freshness()
                self.assertTrue(stale["stale"])
                self.assertIn("database has 1", stale["reason"])
            finally:
                settings.COURSE_DB_PATH = old_db_path

    def test_course_listing_supports_limit_and_offset(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "courses.sqlite3"
            initialize_database(db_path)
            old_db_path = settings.COURSE_DB_PATH
            settings.COURSE_DB_PATH = db_path
            try:
                conn = connect(db_path)
                try:
                    now = utc_now()
                    for index, title in enumerate(("Alpha", "Beta", "Gamma"), start=1):
                        conn.execute(
                            """
                            INSERT INTO courses (
                                source, external_course_id, title, delivery_modes,
                                fee_info, support_dates, raw_source_data, is_active,
                                created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                            """,
                            (
                                "test",
                                f"C{index}",
                                title,
                                json_dumps([]),
                                json_dumps({}),
                                json_dumps({}),
                                json_dumps({}),
                                now,
                                now,
                            ),
                        )
                    conn.commit()
                finally:
                    conn.close()

                first_page = course_recommender.list_courses(limit=2, offset=0)
                second_page = course_recommender.list_courses(limit=2, offset=2)
                self.assertEqual([item["title"] for item in first_page], ["Alpha", "Beta"])
                self.assertEqual([item["title"] for item in second_page], ["Gamma"])
                self.assertEqual(course_recommender.count_courses(), 3)
            finally:
                settings.COURSE_DB_PATH = old_db_path


if __name__ == "__main__":
    unittest.main()
