"""
Pattern Matchers for PostgreSQL Agent Skills Evals
Validates skill output against expected patterns and anti-patterns.
"""
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml


@dataclass
class MatchResult:
    """Result of a pattern match evaluation."""
    passed: bool
    score: float  # 0.0 - 1.0
    matched_patterns: list[str]
    missing_patterns: list[str]
    triggered_anti_patterns: list[str]
    details: str


class PatternMatcher:
    """Evaluates agent output against expected/anti patterns."""

    def evaluate(self, output: str, expected: list[str], anti: list[str] | None = None) -> MatchResult:
        matched = []
        missing = []
        triggered = []

        for pattern in expected:
            if re.search(pattern, output, re.IGNORECASE | re.MULTILINE):
                matched.append(pattern)
            else:
                missing.append(pattern)

        if anti:
            for pattern in anti:
                if re.search(pattern, output, re.IGNORECASE | re.MULTILINE):
                    triggered.append(pattern)

        total = len(expected)
        score = len(matched) / total if total > 0 else 1.0
        passed = len(missing) == 0 and len(triggered) == 0

        return MatchResult(
            passed=passed,
            score=score,
            matched_patterns=matched,
            missing_patterns=missing,
            triggered_anti_patterns=triggered,
            details=f"{len(matched)}/{total} patterns matched, {len(triggered)} anti-patterns triggered"
        )


class HallucinationDetector:
    """Detects hallucinations in agent output with context-aware scoping."""

    DEFAULT_KNOWN_EXTENSIONS = [
        "pgcrypto",
        "uuid-ossp",
        "pg_stat_statements",
        "vector",
        "age",
        "postgis",
        "pg_trgm",
        "btree_gin",
        "btree_gist",
        "hstore",
        "citext",
        "ltree",
        "intarray",
        "fuzzystrmatch",
        "unaccent",
        "tablefunc",
        "earthdistance",
        "cube",
        "pg_prewarm",
        "pg_buffercache",
        "postgres_fdw",
        "dblink",
        "amcheck",
        "pageinspect",
        "pg_visibility",
        "bloom",
        "rum",
        "timescaledb",
        "citus",
        "pgrouting",
        "plpgsql",
        "plpython3u",
        "pltcl",
        "plperl",
        "xml2",
        "pgaudit",
        "pg_cron",
        "pg_partman",
        "pg_repack",
        "pg_hint_plan",
        "hypopg",
        "decoderbufs",
        "wal2json",
        "pglogical",
        "orafce",
        "mysql_fdw",
        "tds_fdw",
        "file_fdw",
        "log_fdw",
        "azure_ai",
        "azure_storage",
        "pgvector",
        "pg_diskann",
        "auto_explain",
        "sslinfo",
        "pg_freespacemap",
        "pg_stat_kcache",
        "pg_wait_sampling",
        "plv8",
        "lo",
        "seg",
        "isn",
        "dict_int",
        "dict_xsyn",
        "tsm_system_rows",
        "tsm_system_time",
        "address_standardizer",
        "postgis_topology",
        "postgis_raster",
    ]

    def __init__(self, known_extensions_path: Optional[Path] = None):
        if known_extensions_path is None:
            known_extensions_path = Path(__file__).parent.parent / "dossier" / "known_extensions.yaml"

        self.known_extensions = list(self.DEFAULT_KNOWN_EXTENSIONS)
        try:
            with open(known_extensions_path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            loaded_extensions = data.get("extensions", [])
            if isinstance(loaded_extensions, list) and loaded_extensions:
                self.known_extensions = [str(ext) for ext in loaded_extensions]
        except Exception:
            pass

        ext_pattern = "|".join(re.escape(ext) for ext in self.known_extensions)
        self.UNIVERSAL_PATTERNS = [
            (rf"CREATE\s+EXTENSION\s+(?!IF\s+NOT\s+EXISTS)(?!(?:{ext_pattern})\b)\w+\b",
             "References non-existent PostgreSQL extension"),
            (r"pg_catalog\.(?!pg_class|pg_attribute|pg_namespace|pg_type|pg_index|pg_stat_user_tables|pg_stat_user_indexes|pg_stat_activity|pg_locks|pg_settings|pg_roles|pg_database|pg_tablespace|pg_constraint|pg_trigger|pg_proc|pg_depend|pg_description|pg_am|pg_operator|pg_opclass|pg_statistic|pg_replication_slots|pg_stat_replication|pg_stat_wal_receiver|pg_publication|pg_subscription|pg_stat_progress_vacuum|pg_stat_bgwriter|pg_stat_archiver)\w+",
             "References non-existent pg_catalog object"),
            (r"SET\s+(?:shared_preload_libraries|shared_buffers|max_connections|wal_level|max_wal_senders|max_replication_slots|hot_standby|archive_mode)\s*=",
             "SET cannot change postmaster-level GUC at runtime (requires restart)"),
        ]

    # Azure-managed patterns: only wrong when platform_scope is "azure"
    # These are perfectly valid for generic/self-hosted PostgreSQL
    AZURE_MANAGED_PATTERNS = [
        (r"ALTER\s+SYSTEM\s+SET", "ALTER SYSTEM not available on Azure managed PostgreSQL"),
        (r"GRANT\s+.*superuser", "Cannot grant superuser on Azure"),
        (r"pg_hba\.conf", "pg_hba.conf not directly editable on Azure"),
        (r"postgresql\.conf", "postgresql.conf not directly editable on Azure"),
        (r"systemctl\s+.*postgresql", "No OS-level service control on managed PostgreSQL"),
        (r"pg_basebackup", "pg_basebackup not available; use Azure PITR"),
        (r"/var/lib/postgresql", "No filesystem access on managed PostgreSQL"),
        (r"sudo\s+.*postgres", "No OS-level access on managed PostgreSQL"),
    ]

    # Patterns where the match should be suppressed if preceded by negation context
    NEGATION_EXEMPT_PATTERNS = {
        r"GRANT\s+.*superuser",
        r"ALTER\s+SYSTEM\s+SET",
        r"pg_hba\.conf",
        r"postgresql\.conf",
        r"pg_basebackup",
    }
    NEGATION_CONTEXT = re.compile(
        r"(cannot|does not allow|not\s+possible|not\s+allowed|not\s+supported|not\s+available"
        r"|do not|never|don't|doesn't|isn't|aren't|instead of|rather than|avoid|unlike)\s+",
        re.IGNORECASE
    )
    # Also suppress when the match appears in a "warning" or "note" context
    WARNING_CONTEXT = re.compile(
        r"(note:|warning:|important:|caution:|⚠|not.*on azure|not.*on managed|unavailable)",
        re.IGNORECASE
    )

    def check(self, output: str, platform_scope: str = "azure") -> list[dict]:
        """Returns list of hallucination findings.
        
        Args:
            output: The agent's response text
            platform_scope: "generic" for self-hosted PostgreSQL challenges,
                          "azure" for Azure-managed challenges (applies stricter rules)
        """
        findings = []

        # Always check universal patterns
        patterns_to_check = list(self.UNIVERSAL_PATTERNS)

        # Only add Azure-managed patterns for Azure-scoped challenges
        if platform_scope in ("azure", "azure-postgresql"):
            patterns_to_check.extend(self.AZURE_MANAGED_PATTERNS)

        for pattern, reason in patterns_to_check:
            matches = list(re.finditer(pattern, output, re.IGNORECASE))
            if matches:
                # Filter out matches preceded by negation/warning context (within 80 chars)
                if pattern in self.NEGATION_EXEMPT_PATTERNS:
                    real_matches = []
                    for m in matches:
                        preceding = output[max(0, m.start() - 80):m.start()]
                        if (not self.NEGATION_CONTEXT.search(preceding)
                                and not self.WARNING_CONTEXT.search(preceding)):
                            real_matches.append(m.group())
                    if not real_matches:
                        continue
                    matches = real_matches
                else:
                    matches = [m.group() for m in matches]
                findings.append({
                    "pattern": pattern,
                    "reason": reason,
                    "occurrences": len(matches),
                    "examples": matches[:3]
                })
        return findings


class SQLSyntaxValidator:
    """Basic SQL syntax validation for generated queries."""

    BALANCED_PAIRS = [
        ("(", ")"),
        ("BEGIN", "END"),
    ]

    def validate(self, sql: str) -> dict:
        """Basic SQL validation checks."""
        issues = []

        # Check balanced parentheses
        open_count = sql.count("(")
        close_count = sql.count(")")
        if open_count != close_count:
            issues.append(f"Unbalanced parentheses: {open_count} open, {close_count} close")

        # Check for unterminated strings
        single_quotes = sql.count("'")
        if single_quotes % 2 != 0:
            issues.append("Unbalanced single quotes (possible unterminated string)")

        # Check for common syntax errors
        if re.search(r"SELECT\s+FROM", sql, re.IGNORECASE):
            issues.append("SELECT with no columns before FROM")

        if re.search(r"WHERE\s+ORDER\s+BY", sql, re.IGNORECASE):
            issues.append("WHERE clause with no condition")

        return {
            "valid": len(issues) == 0,
            "issues": issues
        }


class TokenBudgetValidator:
    """Validates that skill output stays within token budget."""

    TIER_LIMITS = {
        "generic": 1200,
        "azure-standard": 1500,
        "azure-ai": 1800,
    }
    HARD_CAP = 2000

    def check(self, text: str, tier: str) -> dict:
        # Approximate token count (rough: 1 token ~= 4 chars for English)
        approx_tokens = len(text) // 4
        limit = self.TIER_LIMITS.get(tier, self.HARD_CAP)

        return {
            "approx_tokens": approx_tokens,
            "tier": tier,
            "limit": limit,
            "within_budget": approx_tokens <= limit,
            "within_hard_cap": approx_tokens <= self.HARD_CAP,
        }
