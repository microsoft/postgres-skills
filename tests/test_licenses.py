# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""License compliance.

Native port of the former ``tests/checks/check_licenses.py``: the repository must
carry an MIT/Apache LICENSE and no Python dependency may use a restricted (GPL)
license. The npm and skill-attribution checks from the original were either
optional (license-checker, skipped when unavailable) or non-blocking warnings, so
only the failing assertions are reproduced here.
"""

import re

from conftest import ROOT

PROBLEMATIC_PY = {"mysql-connector-python": "GPL", "pyqt5": "GPL", "pyqt6": "GPL"}


def test_repo_has_permissive_license():
    license_file = ROOT / "LICENSE"
    if not license_file.exists():
        license_file = ROOT / "LICENSE.md"
    assert license_file.exists(), "no LICENSE file found in repository root"
    content = license_file.read_text(encoding="utf-8", errors="ignore")
    assert "MIT" in content or "Apache" in content, "LICENSE is not MIT or Apache-2.0"


def test_python_dependencies_not_restricted():
    issues = []
    for req_file in ROOT.rglob("requirements*.txt"):
        for line in req_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("-"):
                continue
            pkg = re.split(r"[>=<!\[]", line)[0].strip().lower()
            if pkg in PROBLEMATIC_PY:
                issues.append(f"{req_file.name}: {pkg} uses {PROBLEMATIC_PY[pkg]} license")
    assert not issues, "restricted licenses:\n" + "\n".join(issues)
