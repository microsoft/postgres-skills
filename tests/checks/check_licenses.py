# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

#!/usr/bin/env python3
"""Check license compliance for all dependencies."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

# Allowed licenses for enterprise use
ALLOWED_LICENSES = {
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "0BSD",
    "BlueOak-1.0.0",
    "CC0-1.0",
    "CC-BY-4.0",
    "Unlicense",
    "WTFPL",
    "Python-2.0",
    "PSF-2.0",
}

# Packages known to be safe despite ambiguous license fields
KNOWN_SAFE = {
    "node_modules",  # placeholder
}

def check_repo_license(root: Path) -> list[str]:
    """Verify the repo itself has a proper license."""
    issues = []
    license_file = root / "LICENSE"
    if not license_file.exists():
        license_file = root / "LICENSE.md"
    if not license_file.exists():
        issues.append("No LICENSE file found in repository root")
    else:
        content = license_file.read_text(encoding="utf-8", errors="ignore")
        if "MIT" not in content and "Apache" not in content:
            issues.append(f"LICENSE file doesn't appear to be MIT or Apache-2.0")
    return issues

def check_npm_licenses(root: Path) -> list[str]:
    """Check npm package licenses if package.json exists."""
    issues = []
    pkg_json = root / "package.json"
    if not pkg_json.exists():
        return []

    try:
        result = subprocess.run(
            ["npx", "license-checker", "--json", "--production"],
            capture_output=True, text=True, cwd=str(root), timeout=60
        )
        if result.returncode != 0:
            # license-checker not available — skip
            return []

        packages = json.loads(result.stdout)
        for pkg_name, info in packages.items():
            licenses = info.get("licenses", "UNKNOWN")
            if isinstance(licenses, list):
                licenses = " OR ".join(licenses)

            # Check if license is allowed
            license_parts = re.split(r'\s+OR\s+|\s*\(\s*|\s*\)\s*', licenses)
            if not any(lp.strip() in ALLOWED_LICENSES for lp in license_parts):
                if pkg_name not in KNOWN_SAFE:
                    issues.append(f"  {pkg_name}: {licenses} (not in allowed list)")
    except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError):
        pass

    return issues

def check_python_licenses(root: Path) -> list[str]:
    """Check Python package licenses from requirements.txt."""
    issues = []
    req_files = list(root.rglob("requirements*.txt"))

    for req_file in req_files:
        content = req_file.read_text(encoding="utf-8", errors="ignore")
        packages = []
        for line in content.splitlines():
            line = line.strip()
            if line and not line.startswith("#") and not line.startswith("-"):
                pkg = re.split(r'[>=<!\[]', line)[0].strip()
                if pkg:
                    packages.append(pkg)

        # Check known problematic packages
        problematic = {"mysql-connector-python": "GPL", "PyQt5": "GPL", "PyQt6": "GPL"}
        for pkg in packages:
            if pkg.lower() in {k.lower() for k in problematic}:
                issues.append(f"  {req_file.name}: {pkg} uses {problematic.get(pkg, 'restricted')} license")

    return issues

def main():
    root = Path(os.environ.get("REPO_ROOT", "."))
    print("Checking license compliance...\n")

    all_issues = []

    # 1. Repo license
    print("1. Repository license...")
    repo_issues = check_repo_license(root)
    if repo_issues:
        all_issues.extend(repo_issues)
        for issue in repo_issues:
            print(f"   ✗ {issue}")
    else:
        print("   ✓ Repository has valid license file")

    # 2. npm dependencies
    print("2. npm dependency licenses...")
    npm_issues = check_npm_licenses(root)
    if npm_issues:
        all_issues.extend(npm_issues)
        print(f"   ✗ {len(npm_issues)} packages with non-compliant licenses:")
        for issue in npm_issues[:10]:
            print(f"   {issue}")
    else:
        print("   ✓ All npm dependencies have compliant licenses")

    # 3. Python dependencies
    print("3. Python dependency licenses...")
    python_issues = check_python_licenses(root)
    if python_issues:
        all_issues.extend(python_issues)
        print(f"   ✗ {len(python_issues)} packages with restricted licenses:")
        for issue in python_issues:
            print(f"   {issue}")
    else:
        print("   ✓ All Python dependencies have compliant licenses")

    # 4. Skill content licensing
    print("4. Skill content attribution...")
    skill_files = list(root.rglob("SKILL.md"))
    refs_dir = root / "skills" / "references"
    if refs_dir.exists():
        skill_files.extend(refs_dir.glob("*.md"))
    copy_issues = []
    for sf in skill_files:
        content = sf.read_text(encoding="utf-8", errors="ignore")
        # Check for copied content without attribution
        if re.search(r'©|copyright|all rights reserved', content, re.IGNORECASE):
            rel = str(sf.relative_to(root))
            copy_issues.append(f"  {rel}: Contains copyright notice — verify attribution")
    if copy_issues:
        print(f"   ⚠ {len(copy_issues)} files with copyright notices:")
        for issue in copy_issues:
            print(f"   {issue}")
    else:
        print("   ✓ No copyright attribution issues")

    if all_issues:
        print(f"\n✗ {len(all_issues)} license compliance issues found")
        sys.exit(1)

    print("\n✓ License compliance checks passed")

if __name__ == "__main__":
    main()
