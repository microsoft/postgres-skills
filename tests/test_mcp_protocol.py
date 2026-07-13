# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""MCP protocol conformance tests (no database required).

Validates that the MCP server starts, completes the initialize handshake,
declares a tools capability, and lists the expected tools with input schemas,
within the cold-start budget.
"""

import time

import pytest

EXPECTED_TOOLS = [
    "pgsql_query",
    "pgsql_modify",
    "pgsql_db_context",
    "pgsql_get_server_capabilities",
]


@pytest.fixture(scope="module")
def initialized(mcp_client):
    """Run the initialize handshake once and expose the result + tool list."""
    result = mcp_client.initialize(client_name="mcp-conformance")
    tools_res = mcp_client.request("tools/list", {})
    return {"client": mcp_client, "init": result, "tools_res": tools_res}


def test_initialize_returns_server_info(initialized):
    result = initialized["init"]
    assert result.get("serverInfo"), "initialize should return serverInfo"
    assert result.get("capabilities"), "initialize should return capabilities"


def test_server_identity(initialized):
    info = initialized["init"]["serverInfo"]
    assert info.get("name") == "postgres-mcp", f"unexpected server name: {info}"


def test_tools_capability_declared(initialized):
    caps = initialized["init"].get("capabilities", {})
    assert caps.get("tools"), "server should declare a tools capability"


def test_tools_list_returns_tools(initialized):
    result = initialized["tools_res"].get("result", {})
    tools = result.get("tools")
    assert isinstance(tools, list) and tools, "tools/list should return a non-empty array"


@pytest.mark.parametrize("tool_name", EXPECTED_TOOLS)
def test_expected_tool_present(initialized, tool_name):
    tools = initialized["tools_res"]["result"]["tools"]
    names = [t["name"] for t in tools]
    assert tool_name in names, f"{tool_name} missing from tools/list: {names}"


def test_expected_tools_have_input_schema(initialized):
    # Core tools all take parameters (connectionId, query, ...), so they must
    # expose an inputSchema with properties. Argument-less tools (e.g.
    # pgsql_list_connection_profiles) legitimately have none.
    tools = {t["name"]: t for t in initialized["tools_res"]["result"]["tools"]}
    missing = [
        name
        for name in EXPECTED_TOOLS
        if not tools[name].get("inputSchema")
        or not tools[name]["inputSchema"].get("properties")
    ]
    assert not missing, f"core tools missing input schema: {missing}"


def test_cold_start_under_budget(initialized):
    # The session-scoped server already booted; a fresh tools/list round-trip
    # must complete well within the 15s cold-start threshold.
    client = initialized["client"]
    start = time.monotonic()
    client.request("tools/list", {})
    elapsed = time.monotonic() - start
    assert elapsed < 15, f"tools/list round-trip took {elapsed:.1f}s (>15s)"
