"""
Pattern Matchers for PostgreSQL Agent Skills Evals
Validates skill output against expected patterns and anti-patterns.
"""
import re
from dataclasses import dataclass
from typing import Optional


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
    """Detects common managed-service hallucinations in agent output."""

    HALLUCINATION_PATTERNS = [
        (r"ALTER\s+SYSTEM\s+SET", "ALTER SYSTEM not available on Azure managed PostgreSQL"),
        (r"CREATE\s+\w+\s+SUPERUSER", "Superuser role does not exist on Azure"),
        (r"GRANT\s+.*superuser", "Cannot grant superuser on Azure"),
        (r"pg_hba\.conf", "pg_hba.conf not directly editable on Azure"),
        (r"postgresql\.conf", "postgresql.conf not directly editable on Azure"),
        (r"systemctl\s+.*postgresql", "No OS-level service control on managed PostgreSQL"),
        (r"pg_basebackup", "pg_basebackup not available; use Azure PITR"),
        (r"/var/lib/postgresql", "No filesystem access on managed PostgreSQL"),
        (r"sudo\s+.*postgres", "No OS-level access on managed PostgreSQL"),
    ]

    def check(self, output: str) -> list[dict]:
        """Returns list of hallucination findings."""
        findings = []
        for pattern, reason in self.HALLUCINATION_PATTERNS:
            matches = re.findall(pattern, output, re.IGNORECASE)
            if matches:
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
