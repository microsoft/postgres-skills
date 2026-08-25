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

    def test_quoted_pg_hba_error_is_not_a_hallucination(self):
        output = (
            'FATAL: no pg_hba.conf entry for host "203.0.113.1". '
            "On Azure, fix the firewall rule; do **not** edit pg_hba.conf."
        )

        self.assertEqual(self.detector.check(output, "azure-postgresql"), [])

    def test_unavailable_manual_tools_are_not_hallucinations(self):
        output = "There is no pg_hba.conf or pg_basebackup workflow on HorizonDB."

        self.assertEqual(self.detector.check(output, "azure-postgresql"), [])

    def test_curly_contraction_suppresses_managed_file_warning(self):
        output = "Don’t try to edit pg_hba.conf; Azure manages network access."

        self.assertEqual(self.detector.check(output, "azure-postgresql"), [])

    def test_known_catalog_stats_view_is_not_a_hallucination(self):
        output = "SELECT * FROM pg_catalog.pg_statio_user_tables;"

        self.assertEqual(self.detector.check(output, "azure-postgresql"), [])

    def test_placeholder_extension_name_is_not_a_hallucination(self):
        output = "CREATE EXTENSION extension_name;"

        self.assertEqual(self.detector.check(output, "azure-postgresql"), [])

    def test_alter_system_is_valid_for_generic_postgresql(self):
        output = "ALTER SYSTEM SET max_connections = 200;"

        self.assertEqual(self.detector.check(output, "generic"), [])


if __name__ == "__main__":
    unittest.main()
