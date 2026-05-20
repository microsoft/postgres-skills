#!/usr/bin/env python3
"""Security checks: scan for secrets, unsafe patterns, and dependency issues."""

import os
import re
import sys
from pathlib import Path

# Secret patterns to detect
SECRET_PATTERNS = [
    (r'(?:password|passwd|pwd)\s*[=:]\s*["\'][^"\']{8,}["\']', "Hardcoded password"),
    (r'(?:api[_-]?key|apikey)\s*[=:]\s*["\'][^"\']{16,}["\']', "API key"),
    (r'(?:secret|token)\s*[=:]\s*["\'][^"\']{16,}["\']', "Secret/token value"),
    (r'(?:postgres|postgresql)://[^:]+:[^@]+@[^/]+', "Connection string with credentials"),
    (r'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----', "Private key"),
    (r'AKIA[0-9A-Z]{16}', "AWS access key"),
    (r'AccountKey=[A-Za-z0-9+/=]{40,}', "Azure storage account key"),
    (r'(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}', "GitHub token"),
]

# Files to skip (test files, examples with fake creds)
SKIP_FILES = [
    r'check_security\.py$',  # this file itself
    r'\.git[/\\]',
    r'node_modules[/\\]',
    r'tests[/\\]evals[/\\]results[/\\]',  # auto-generated eval outputs may contain test connection strings
]

# Unsafe SQL patterns that should have warnings
UNSAFE_SQL_PATTERNS = [
    (r"SECURITY\s+DEFINER(?!.*--.*warning|.*⚠|.*CRITICAL|.*careful)", "SECURITY DEFINER without warning comment"),
    (r"EXECUTE\s+format\s*\(.*\$\d", "Dynamic SQL with format() — ensure SQL injection warning"),
]

def scan_secrets(root: Path) -> list[tuple[str, int, str]]:
    """Scan for potential secrets in all files."""
    issues = []

    for file_path in root.rglob("*"):
        if file_path.is_dir():
            continue
        if file_path.suffix in ['.png', '.jpg', '.gif', '.ico', '.woff', '.zip', '.tar', '.gz']:
            continue
        if any(re.search(p, str(file_path)) for p in SKIP_FILES):
            continue

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        rel_path = str(file_path.relative_to(root))

        for line_no, line in enumerate(content.splitlines(), 1):
            for pattern, desc in SECRET_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    # Skip if it's clearly a placeholder
                    if re.search(r'<your|example|placeholder|xxx|YOUR_|changeme', line, re.IGNORECASE):
                        continue
                    issues.append((rel_path, line_no, desc))

    return issues

def scan_unsafe_sql(root: Path) -> list[tuple[str, int, str]]:
    """Scan skill and reference files for unsafe SQL patterns without proper warnings."""
    issues = []

    skill_files = list(root.rglob("SKILL.md"))
    refs_dir = root / "skills" / "references"
    if refs_dir.exists():
        skill_files.extend(refs_dir.glob("*.md"))

    for skill_file in skill_files:
        content = skill_file.read_text(encoding="utf-8", errors="ignore")
        rel_path = str(skill_file.relative_to(root))

        for line_no, line in enumerate(content.splitlines(), 1):
            for pattern, desc in UNSAFE_SQL_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    issues.append((rel_path, line_no, desc))

    return issues

def check_sha256_hashes(root: Path) -> list[str]:
    """Verify that run_mcp.js files have SHA-256 hashes for all platforms."""
    issues = []
    expected_platforms = [
        "linux-x64", "linux-arm64", "osx-arm64", "osx-x86", "win-x64"
    ]

    for mcp_file in root.rglob("run_mcp.js"):
        content = mcp_file.read_text(encoding="utf-8")
        rel_path = str(mcp_file.relative_to(root))

        for platform in expected_platforms:
            if platform not in content:
                issues.append(f"{rel_path}: Missing hash for platform {platform}")

        # Check hash format (64 hex chars)
        hashes = re.findall(r'"([a-f0-9]{64})"', content)
        if len(hashes) < len(expected_platforms):
            issues.append(f"{rel_path}: Only {len(hashes)}/{len(expected_platforms)} SHA-256 hashes found")

    return issues

def main():
    root = Path(os.environ.get("REPO_ROOT", "."))
    print("Running security checks...\n")

    # 1. Secret scanning
    print("1. Scanning for leaked secrets...")
    secret_issues = scan_secrets(root)
    if secret_issues:
        print(f"   ✗ {len(secret_issues)} potential secrets found:")
        for f, line, desc in secret_issues[:10]:
            print(f"     {f}:{line} — {desc}")
        # Secrets are a hard failure
        sys.exit(1)
    print(f"   ✓ No secrets detected")

    # 2. Unsafe SQL patterns
    print("2. Checking SQL safety patterns...")
    sql_issues = scan_unsafe_sql(root)
    if sql_issues:
        print(f"   ⚠ {len(sql_issues)} unsafe SQL patterns without warnings:")
        for f, line, desc in sql_issues[:10]:
            print(f"     {f}:{line} — {desc}")
    else:
        print(f"   ✓ All SQL patterns have appropriate safety warnings")

    # 3. Binary integrity
    print("3. Verifying binary hash coverage...")
    hash_issues = check_sha256_hashes(root)
    if hash_issues:
        print(f"   ✗ {len(hash_issues)} hash integrity issues:")
        for issue in hash_issues:
            print(f"     {issue}")
        sys.exit(1)
    print(f"   ✓ SHA-256 hashes present for all platforms")

    # Final
    if sql_issues:
        print(f"\n⚠ {len(sql_issues)} warnings (non-blocking)")
    print("\n✓ Security checks passed")

if __name__ == "__main__":
    main()
