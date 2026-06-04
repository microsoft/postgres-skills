# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Binary integrity guarantees for the runtime-downloaded CLI launcher.

Ported from the inline Python in the ci.yml ``binary-integrity`` job. The CLI
binary is downloaded at runtime and verified against the per-release
manifest.json. Every ``run_mcp.js`` copy must perform that verification, list
every supported platform, and stay byte-identical across plugin copies.
"""

import pytest

import re

from conftest import ROOT

EXPECTED_PLATFORMS = ["linux-x64", "linux-arm64", "osx-arm64", "osx-x86", "win-x64"]
REQUIRED_MARKERS = ['"manifest.json"', "sha256", "verifyChecksum", "actual !== expected"]


def _run_mcp_copies():
    return [f for f in ROOT.rglob("run_mcp.js") if "node_modules" not in f.parts]


def test_run_mcp_copies_exist():
    files = _run_mcp_copies()
    assert files, "no run_mcp.js found"


@pytest.mark.parametrize("marker", REQUIRED_MARKERS)
def test_each_copy_has_verification_marker(marker):
    for f in _run_mcp_copies():
        assert marker in f.read_text(encoding="utf-8"), f"{f}: missing marker {marker}"


@pytest.mark.parametrize("platform", EXPECTED_PLATFORMS)
def test_each_copy_lists_platform(platform):
    for f in _run_mcp_copies():
        assert platform in f.read_text(encoding="utf-8"), f"{f}: missing platform {platform}"


def test_each_copy_invokes_checksum_verification():
    """The launcher must *call* verifyChecksum, not merely define it.

    A naive substring check on ``verifyChecksum`` passes even if the call site is
    deleted (leaving the definition dead). Assert both the definition and an
    ``await verifyChecksum(`` invocation so the download path stays gated on
    integrity verification.
    """
    call_re = re.compile(r"await\s+verifyChecksum\s*\(")
    def_re = re.compile(r"function\s+verifyChecksum\s*\(")
    for f in _run_mcp_copies():
        text = f.read_text(encoding="utf-8")
        assert def_re.search(text), f"{f}: verifyChecksum is not defined"
        assert call_re.search(text), f"{f}: verifyChecksum is defined but never awaited/called"


def test_all_copies_byte_identical():
    files = _run_mcp_copies()
    contents = {str(f): f.read_text(encoding="utf-8") for f in files}
    baseline = next(iter(contents.values()))
    for path, content in contents.items():
        assert content == baseline, f"{path} differs from other run_mcp.js copies"
