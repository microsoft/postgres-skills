import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from matchers import HallucinationDetector


class HallucinationDetectorTests(unittest.TestCase):
    def setUp(self):
        self.detector = HallucinationDetector()

    def test_superuser_prohibition_is_not_a_hallucination(self):
        output = "Azure Database for PostgreSQL does not grant customer logins true superuser access."

        self.assertEqual(self.detector.check(output, "azure-postgresql"), [])

    def test_superuser_contraction_is_not_a_hallucination(self):
        output = "You can’t grant SUPERUSER on Azure Database for PostgreSQL."

        self.assertEqual(self.detector.check(output, "azure-postgresql"), [])

    def test_superuser_recommendation_remains_a_hallucination(self):
        output = "Run GRANT SUPERUSER TO app_user."

        findings = self.detector.check(output, "azure-postgresql")

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["reason"], "Cannot grant superuser on Azure")


if __name__ == "__main__":
    unittest.main()
