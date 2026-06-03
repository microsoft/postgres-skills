# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""SQL-syntax validation of skill reference fences against a live PostgreSQL.

Drives ``tests/checks/check_sql_syntax.py`` (which connects via
PGSQL_TEST_CONNECTION_STRING and parses every SQL fence) under pytest. The CI
``sql-validation`` job runs this across a PG 14–17 service matrix; locally and on
PRs without a database it skips automatically.
"""

import os
import subprocess
import sys

import pytest

from conftest import ROOT

pytestmark = pytest.mark.pg


@pytest.mark.skipif(
    not os.environ.get("PGSQL_TEST_CONNECTION_STRING"),
    reason="PGSQL_TEST_CONNECTION_STRING not set",
)
def test_sql_syntax_check_passes():
    result = subprocess.run(
        [sys.executable, "tests/checks/check_sql_syntax.py"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, (
        f"check_sql_syntax.py exited {result.returncode}\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    )
