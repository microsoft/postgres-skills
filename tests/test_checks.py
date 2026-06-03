# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Run the repository's standalone Python check scripts under pytest.

Each ``tests/checks/check_*.py`` script (and the routing eval) is an executable
that exits non-zero on failure and prints a detailed report. Rather than
duplicating that logic, we drive each one as a subprocess from a single pytest
command and assert a clean exit, surfacing the script's output on failure.

The scripts remain runnable standalone (documented in CONTRIBUTING.md); this
module makes them part of the unified ``pytest`` run.
"""

import subprocess
import sys

import pytest

from conftest import ROOT

# (test-id, script path relative to repo root, extra argv)
NO_DB_CHECKS = [
    ("skill-size", "tests/checks/check_skill_size.py", []),
    ("terminology", "tests/checks/check_terminology.py", []),
    ("links", "tests/checks/check_links.py", []),
    ("activation-precision", "tests/checks/check_activation_precision.py", []),
    ("security", "tests/checks/check_security.py", []),
    ("licenses", "tests/checks/check_licenses.py", []),
    ("routing-eval", "tests/evals/routing_eval.py", ["--host", "all"]),
]


def _run(script: str, argv: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, script, *argv],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=300,
    )


@pytest.mark.parametrize("name,script,argv", NO_DB_CHECKS, ids=[c[0] for c in NO_DB_CHECKS])
def test_check_script_passes(name, script, argv):
    result = _run(script, argv)
    assert result.returncode == 0, (
        f"{script} exited {result.returncode}\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    )
