import unittest

from fastapi.testclient import TestClient
from pydantic import ValidationError

import main
import skillsfuture_config as settings


class Phase6SecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_job_description_and_feedback_fields_are_validated(self):
        with self.assertRaises(ValidationError):
            main.JobRequest(job_description="short")
        with self.assertRaises(ValidationError):
            main.RecommendationFeedbackRequest(
                course_id=1,
                feedback_type="maybe",
            )

    def test_request_body_limit_returns_413(self):
        old_limit = settings.MAX_REQUEST_BODY_BYTES
        settings.MAX_REQUEST_BODY_BYTES = 20
        try:
            response = self.client.post(
                "/analyze-job",
                content='{"job_description":"this body is intentionally too large"}',
                headers={"Content-Type": "application/json"},
            )
            self.assertEqual(response.status_code, 413)
            self.assertEqual(response.json()["detail"], "Request body is too large.")
        finally:
            settings.MAX_REQUEST_BODY_BYTES = old_limit

    def test_optional_bearer_authentication(self):
        old_token = settings.API_ACCESS_TOKEN
        settings.API_ACCESS_TOKEN = "test-access-token"
        try:
            unauthenticated = self.client.get("/api/courses")
            authenticated = self.client.get(
                "/api/courses?page_size=1",
                headers={"Authorization": "Bearer test-access-token"},
            )
            health = self.client.get("/health")
            self.assertEqual(unauthenticated.status_code, 401)
            self.assertEqual(authenticated.status_code, 200)
            self.assertEqual(health.status_code, 200)
        finally:
            settings.API_ACCESS_TOKEN = old_token

    def test_feedback_rejects_unknown_course(self):
        response = self.client.post(
            "/api/recommendations/feedback",
            json={"course_id": 999_999_999, "feedback_type": "relevant"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Course not found")


if __name__ == "__main__":
    unittest.main()
