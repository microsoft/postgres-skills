# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""End-to-end MCP integration tests against a real PostgreSQL database.

Runs against the Docker-backed PostgreSQL; the module fails — rather than
skipping — when no database is reachable.

Skill-guided MCP execution (version checks, extension allowlist, EXPLAIN,
index creation/verification, capability detection, schema introspection) is
covered by the dogfood suite in ``test_ai_app.py``.
"""

import pytest

from conftest import connect_to_database, get_tool_text

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def connection(db_client):
    """Connect once and share the connectionId across the module's tests.

    Disconnect happens in teardown (not via an order-dependent test), so the
    suite is safe under any test execution order.
    """
    conn_id = connect_to_database(db_client)
    yield db_client, conn_id
    db_client.call_tool("pgsql_disconnect", {"connectionId": conn_id})


def test_list_connection_profiles(db_client):
    res = db_client.call_tool("pgsql_list_connection_profiles", {})
    text = get_tool_text(res)
    assert text, "profiles listing should return text"


def test_connect_returns_connection_id(connection):
    _client, conn_id = connection
    assert conn_id, "pgsql_connect should yield a connectionId"


def test_list_databases_includes_postgres(connection):
    client, conn_id = connection
    res = client.call_tool("pgsql_list_databases", {"connectionId": conn_id})
    text = get_tool_text(res)
    assert "postgres" in text.lower(), "should list the postgres database"


def test_query_version(connection):
    client, conn_id = connection
    res = client.call_tool(
        "pgsql_query", {"connectionId": conn_id, "query": "SELECT version();"}
    )
    text = get_tool_text(res)
    assert "postgresql" in text.lower(), "version() should mention PostgreSQL"


def test_create_insert_select_drop(connection):
    client, conn_id = connection
    client.call_tool("pgsql_modify", {
        "connectionId": conn_id,
        "statement": "CREATE TABLE IF NOT EXISTS _e2e_test "
                     "(id serial PRIMARY KEY, val text);",
    })
    client.call_tool("pgsql_modify", {
        "connectionId": conn_id,
        "statement": "INSERT INTO _e2e_test (val) VALUES ('hello_e2e');",
    })
    res = client.call_tool("pgsql_query", {
        "connectionId": conn_id,
        "query": "SELECT val FROM _e2e_test WHERE val = 'hello_e2e' LIMIT 1;",
    })
    text = get_tool_text(res)
    client.call_tool("pgsql_modify", {
        "connectionId": conn_id,
        "statement": "DROP TABLE IF EXISTS _e2e_test;",
    })
    assert "hello_e2e" in text, "should read back the inserted row"


def test_db_context_introspection(connection):
    client, conn_id = connection
    res = client.call_tool(
        "pgsql_db_context", {"connectionId": conn_id, "objectType": "tables"}
    )
    text = get_tool_text(res)
    assert len(text) > 10, "db_context should return a non-trivial response"


def test_get_server_capabilities(connection):
    client, conn_id = connection
    res = client.call_tool(
        "pgsql_get_server_capabilities", {"connectionId": conn_id}
    )
    text = get_tool_text(res)
    assert text, "capabilities should return text"


def test_disconnect(db_client):
    # Uses its own fresh connection so it is independent of test order.
    conn_id = connect_to_database(db_client)
    res = db_client.call_tool("pgsql_disconnect", {"connectionId": conn_id})
    get_tool_text(res)  # should not raise
