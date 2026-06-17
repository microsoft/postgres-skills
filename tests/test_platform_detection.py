# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Behavioral coverage for ``run_mcp.js``'s ``detectPlatform`` mapping.

The launcher maps ``process.platform``/``process.arch`` onto the published
release asset name. There is no ``win-arm64`` artifact, but Windows on ARM
transparently runs the x64 build through the OS emulation layer, so an ARM64
Windows host must resolve to the ``win-x64`` asset (mirroring the existing
macOS-Intel ``osx-x86`` special case).

These tests exercise the real function by overriding ``process.platform`` and
``process.arch`` in a child Node process, so they verify runtime behavior
rather than matching source text.
"""

import shutil
import subprocess

import pytest

from conftest import RUN_MCP

# Static Node harness: argv = [node, <run_mcp.js>, <platform>, <arch>]. It
# overrides the platform/arch globals before requiring the launcher (whose
# main() is gated behind `require.main === module`, so requiring it is inert)
# and prints "OK:<asset>" or "ERR:<message>".
_HARNESS = """
"use strict";
const target = process.argv[1];
Object.defineProperty(process, "platform", { value: process.argv[2], configurable: true });
Object.defineProperty(process, "arch", { value: process.argv[3], configurable: true });
try {
  const mod = require(target);
  process.stdout.write("OK:" + mod.detectPlatform());
} catch (err) {
  process.stdout.write("ERR:" + err.message);
}
"""

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node runtime not available"
)


def _detect(platform: str, arch: str) -> str:
    result = subprocess.run(
        ["node", "-e", _HARNESS, str(RUN_MCP), platform, arch],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, f"harness crashed: {result.stderr}"
    return result.stdout.strip()


@pytest.mark.parametrize(
    "platform,arch,expected",
    [
        ("win32", "arm64", "win-x64"),  # the behavior under test
        ("win32", "x64", "win-x64"),
        ("linux", "x64", "linux-x64"),
        ("linux", "arm64", "linux-arm64"),
        ("darwin", "arm64", "osx-arm64"),
        ("darwin", "x64", "osx-x86"),  # existing macOS-Intel special case
    ],
)
def test_detect_platform_maps_to_published_asset(platform, arch, expected):
    assert _detect(platform, arch) == f"OK:{expected}"


def test_windows_arm64_uses_x64_asset():
    """A dedicated assertion for the Windows-on-ARM emulation fallback."""
    assert _detect("win32", "arm64") == "OK:win-x64"


def test_unsupported_arch_still_rejected():
    """The arm64->x64 fallback must not loosen general arch validation."""
    out = _detect("linux", "ia32")
    assert out.startswith("ERR:")
    assert "Unsupported architecture" in out
