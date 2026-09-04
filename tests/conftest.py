# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Shared pytest fixtures and helpers for the PostgreSQL Agent Skills test suite.

The MCP server is launched exactly as ``plugin/.mcp.json`` declares it
(``npx @microsoft/postgres-mcp@latest run``) and speaks newline-delimited
JSON-RPC 2.0 (NDJSON) over stdio. These helpers spawn it via ``subprocess`` and
provide a small JSON-RPC client plus the skill-routing engine used by the
routing/dogfood tests.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Optional

import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parent
PLUGIN_DIR = Path(os.environ.get("PLUGIN_DIR", ROOT / "plugin")).resolve()
MCP_CONFIG = PLUGIN_DIR / ".mcp.json"
SKILLS_MANIFEST = TESTS_DIR / ".skills.json"

# Server boot budget (package download on cold npx cache + startup).
BOOT_WAIT_S = float(os.environ.get("MCP_BOOT_WAIT_S", "5"))
MSG_TIMEOUT_S = float(os.environ.get("MCP_MSG_TIMEOUT_S", "30"))

# Default DB for the Docker-backed lanes (matches tests/docker-compose.yml).
# Used when PGSQL_TEST_CONNECTION_STRING is not set so DB-backed tests connect to
# the local compose Postgres instead of skipping.
DEFAULT_CONN_STRING = (
    "host=localhost port=5432 user=testuser password=testpass dbname=testdb "
    "sslmode=disable gssencmode=disable"
)


def pytest_configure(config):
    """Register markers here so they are recognized regardless of CWD/ini discovery."""
    config.addinivalue_line(
        "markers",
        "integration: generic end-to-end MCP tests against a live PostgreSQL "
        "(Docker-backed; fails if no database is reachable)",
    )
    config.addinivalue_line(
        "markers",
        "pg: validates SQL fences against a live PostgreSQL "
        "(Docker-backed; fails if no database is reachable)",
    )
    config.addinivalue_line(
        "markers",
        "azure: dogfood tests that require a real Azure Database for PostgreSQL "
        "via PGSQL_TEST_CONNECTION_STRING (fails if absent)",
    )


# ---------------------------------------------------------------------------
# Skill routing engine (mirrors how an AI platform routes prompts → skills)
# ---------------------------------------------------------------------------
def load_skills_manifest() -> list[dict]:
    """Return the ``skills`` array from tests/.skills.json."""
    return json.loads(SKILLS_MANIFEST.read_text(encoding="utf-8"))["skills"]


_WORD_RE = re.compile(r"\W+")


def route_prompt(prompt: str, skills: list[dict]) -> list[dict]:
    """Match a prompt to skills via activation_keywords (substring or all-words)."""
    lower = prompt.lower()
    words = {w for w in _WORD_RE.split(lower) if w}
    matches: list[dict] = []
    for skill in skills:
        hit = False
        for kw in skill.get("activation_keywords") or []:
            kw_lower = kw.lower()
            if kw_lower in lower:
                hit = True
                break
            kw_words = [w for w in _WORD_RE.split(kw_lower) if w]
            if kw_words and all(w in words for w in kw_words):
                hit = True
                break
        if hit or skill.get("always_load"):
            matches.append(skill)
    return matches


def route_ids(prompt: str, skills: list[dict]) -> list[str]:
    return [s["id"] for s in route_prompt(prompt, skills)]


def load_skill_content(skill_or_id: Any, skills: list[dict]) -> Optional[str]:
    """Load a reference/SKILL.md file by skill object or by skill id.

    Paths in the manifest are repo-root relative.
    """
    if isinstance(skill_or_id, str):
        skill = next((s for s in skills if s["id"] == skill_or_id), None)
    else:
        skill = skill_or_id
    if not skill:
        return None
    rel = skill.get("path")
    if not rel:
        return None
    full = ROOT / rel
    if not full.exists():
        return None
    return full.read_text(encoding="utf-8")


def extract_sql_blocks(content: str) -> list[dict]:
    """Extract fenced ```sql (optionally ` no-execute`) blocks from markdown."""
    blocks: list[dict] = []
    regex = re.compile(r"```sql(?:\s+no-execute)?\s*\n(.*?)```", re.DOTALL)
    for m in regex.finditer(content):
        blocks.append(
            {"sql": m.group(1).strip(), "no_execute": "no-execute" in m.group(0)}
        )
    return blocks


# ---------------------------------------------------------------------------
# Connection-string helpers
# ---------------------------------------------------------------------------
def to_libpq_string(cs: str) -> str:
    """Normalize a connection string to libpq key=value format.

    Accepts either a libpq string (returned as-is, trimmed) or a postgres URL.
    """
    trimmed = cs.strip()
    if not re.match(r"^postgres(?:ql)?://", trimmed, re.IGNORECASE):
        return trimmed

    from urllib.parse import urlparse, unquote

    url = urlparse(trimmed)
    parts = [
        f"host={url.hostname}",
        f"port={url.port or 5432}",
        f"dbname={unquote((url.path or '/').lstrip('/')) or 'postgres'}",
        f"user={unquote(url.username or 'postgres')}",
    ]
    if url.password:
        parts.append(f"password={unquote(url.password)}")
    m = re.search(r"sslmode=([^\s&]+)", url.query or "")
    if m:
        parts.append(f"sslmode={m.group(1)}")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# MCP JSON-RPC client over stdio
# ---------------------------------------------------------------------------
def mcp_server_command() -> list[str]:
    """Return the argv the plugin uses to launch the postgres-mcp server.

    Read from ``plugin/.mcp.json`` so the suite exercises the shipped launch
    command (and its pinned package version) instead of a duplicate of it.
    """
    config = json.loads(MCP_CONFIG.read_text(encoding="utf-8"))
    server = config["mcpServers"]["postgres-mcp"]
    return [server["command"], *server.get("args", [])]


class MCPClient:
    """Minimal NDJSON JSON-RPC client for the postgres-mcp MCP server.

    A single background thread reads stdout, parses JSON-RPC responses, and
    stores them keyed by id (banner / non-JSON lines are skipped). Callers wait
    on a specific id, which avoids the multi-listener races of the JS tests.
    """

    def __init__(self, extra_env: Optional[dict] = None):
        import subprocess

        self._subprocess = subprocess
        env = {**os.environ}
        if extra_env:
            env.update(extra_env)
        self.proc = subprocess.Popen(
            mcp_server_command(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            text=True,
            bufsize=1,
        )
        self._next_id = 0
        self._lock = threading.Lock()
        self._responses: dict[int, dict] = {}
        self._cond = threading.Condition()
        self._stderr_buf: list[str] = []
        self._closed = False
        self._reader = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader.start()
        self._stderr_reader = threading.Thread(target=self._read_stderr, daemon=True)
        self._stderr_reader.start()

    # -- background readers --
    def _read_stdout(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue  # server banner / progress text
            if msg.get("jsonrpc") == "2.0" and "id" in msg and msg["id"] is not None:
                with self._cond:
                    self._responses[msg["id"]] = msg
                    self._cond.notify_all()

    def _read_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            self._stderr_buf.append(line)

    @property
    def stderr(self) -> str:
        return "".join(self._stderr_buf)

    # -- request/response --
    def _send(self, msg: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()

    def _wait_for(self, expected_id: int, timeout: float) -> dict:
        deadline = time.monotonic() + timeout
        with self._cond:
            while expected_id not in self._responses:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(
                        f"Timed out after {timeout}s waiting for id={expected_id}"
                    )
                self._cond.wait(remaining)
            return self._responses.pop(expected_id)

    def request(self, method: str, params: Optional[dict] = None,
                timeout: float = MSG_TIMEOUT_S) -> dict:
        with self._lock:
            self._next_id += 1
            req_id = self._next_id
        self._send({"jsonrpc": "2.0", "id": req_id, "method": method,
                    "params": params or {}})
        return self._wait_for(req_id, timeout)

    def notify(self, method: str, params: Optional[dict] = None) -> None:
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        self._send(msg)

    def call_tool(self, name: str, arguments: dict,
                  timeout: float = MSG_TIMEOUT_S) -> dict:
        return self.request("tools/call",
                            {"name": name, "arguments": arguments}, timeout)

    def initialize(self, client_name: str = "pytest") -> dict:
        res = self.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": client_name, "version": "1.0.0"},
            },
        )
        assert "result" in res, f"initialize returned no result: {res}"
        self.notify("notifications/initialized")
        time.sleep(0.5)
        return res["result"]

    # -- teardown --
    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except self._subprocess.TimeoutExpired:
                self.proc.kill()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Response-text helpers
# ---------------------------------------------------------------------------
def get_tool_text(res: dict) -> str:
    """Extract text from a tools/call response (result or error)."""
    if "error" in res and res["error"]:
        err = res["error"]
        raise RuntimeError(f"RPC error {err.get('code')}: {err.get('message')}")
    result = res.get("result", res)
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list):
        return "\n".join(
            c.get("text") or json.dumps(c) for c in content
        )
    return json.dumps(result)


def has_error(tool_text: str) -> bool:
    """True if the tool response indicates an error (errorMessage field set)."""
    try:
        obj = json.loads(tool_text)
        return bool(obj.get("errorMessage"))
    except (json.JSONDecodeError, AttributeError):
        cleaned = re.sub(r'"errorMessage"\s*:\s*null', "", tool_text, flags=re.IGNORECASE)
        return "error" in cleaned.lower()


def parse_connection_id(text: str) -> Optional[str]:
    m = re.search(r"postgres-mcp/[0-9a-f-]+(?:/[\w-]+)?", text, re.IGNORECASE)
    if m:
        return m.group(0)
    try:
        obj = json.loads(text)
        if obj.get("connectionId"):
            return obj["connectionId"]
    except (json.JSONDecodeError, AttributeError):
        pass
    m = re.search(r'"connectionId"\s*:\s*"([^"]+)"', text)
    return m.group(1) if m else None


def find_profile_id(text: str) -> Optional[str]:
    """Return the connection profile to use.

    Prefers the ``default (env)`` profile that the server auto-registers from
    ``POSTGRES_MCP_CONNECTION_STRING`` so the suite is isolated from any pre-existing
    developer profiles in ``~/.postgres-mcp/connections.yaml``. Falls back to
    the first UUID found when that named profile is not present.
    """
    try:
        obj = json.loads(text)
        for profile in obj.get("profiles", []):
            if profile.get("profileName") == "default (env)" and profile.get("profileId"):
                return profile["profileId"]
    except (json.JSONDecodeError, AttributeError, TypeError):
        pass
    m = re.search(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        text, re.IGNORECASE,
    )
    return m.group(0) if m else None


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def skills() -> list[dict]:
    return load_skills_manifest()


@pytest.fixture(scope="module")
def mcp_client():
    """MCP server without a DB connection string (protocol/tool-listing tests)."""
    client = MCPClient(extra_env={"POSTGRES_MCP_QUERY_TIMEOUT_MS": "10000"})
    time.sleep(BOOT_WAIT_S)
    yield client
    client.close()


def _require_conn_string() -> str:
    """Connection string for the Docker-backed lanes.

    Always uses the local compose Postgres (DEFAULT_CONN_STRING). These lanes do
    not read PGSQL_TEST_CONNECTION_STRING; they connect to the Docker database and
    fail (rather than skip) when it is unreachable.
    """
    return DEFAULT_CONN_STRING


def _require_azure_conn_string() -> str:
    """Connection string for the dogfood (`azure`) lane.

    No default: the dogfood suite asserts Azure-specific server detection
    (isAzure, SHOW azure.extensions), so it requires a real Azure Database for
    PostgreSQL. Fail loudly (never skip) when it is absent.
    """
    cs = os.environ.get("PGSQL_TEST_CONNECTION_STRING")
    if not cs:
        pytest.fail(
            "PGSQL_TEST_CONNECTION_STRING is required for the dogfood (`azure`) "
            "suite — set it to a real Azure Database for PostgreSQL connection "
            "string. This suite cannot run against a local/Docker Postgres."
        )
    return cs


@pytest.fixture(scope="module")
def db_client():
    """MCP server wired to the Docker-backed database via POSTGRES_MCP_CONNECTION_STRING.

    Connects to the local compose Postgres by default; fails (does not skip) when
    no database is reachable.
    """
    cs = _require_conn_string()
    client = MCPClient(extra_env={
        "POSTGRES_MCP_CONNECTION_STRING": to_libpq_string(cs),
        "POSTGRES_MCP_QUERY_TIMEOUT_MS": "30000",
        # Disable GSSAPI encryption negotiation. Without this, libpq/pgx attempts a
        # Kerberos handshake against the local Docker Postgres on hosts that have
        # GSS libraries (e.g. macOS), which fails before the normal auth flow.
        "PGGSSENCMODE": "disable",
    })
    time.sleep(BOOT_WAIT_S)
    client.initialize(client_name="pytest-integration")
    yield client
    client.close()


@pytest.fixture(scope="module")
def azure_db_client():
    """MCP server wired to a real Azure PostgreSQL for the dogfood (`azure`) lane.

    Requires PGSQL_TEST_CONNECTION_STRING (no Docker fallback); fails when unset.
    """
    cs = _require_azure_conn_string()
    client = MCPClient(extra_env={
        "POSTGRES_MCP_CONNECTION_STRING": to_libpq_string(cs),
        "POSTGRES_MCP_QUERY_TIMEOUT_MS": "30000",
    })
    time.sleep(BOOT_WAIT_S)
    client.initialize(client_name="pytest-dogfood")
    yield client
    client.close()


def connect_to_database(client: "MCPClient", max_attempts: int = 3) -> str:
    """List profiles → connect → return connectionId (with retry)."""
    list_res = client.call_tool("postgres_mcp_list_connection_profiles", {})
    profile_id = find_profile_id(get_tool_text(list_res))
    assert profile_id, "Should find a connection profile UUID"

    last = ""
    for attempt in range(1, max_attempts + 1):
        conn_res = client.call_tool("postgres_mcp_connect", {"profileId": profile_id})
        text = get_tool_text(conn_res)
        last = text
        conn_id = parse_connection_id(text)
        if conn_id:
            return conn_id
        retryable = re.search(
            r"couldn'?t get a connection|connection failed|timeout", text, re.IGNORECASE
        )
        if not retryable or attempt == max_attempts:
            break
        time.sleep(attempt * 3)
    raise AssertionError(f"Could not parse connectionId: {last[:200]}")
