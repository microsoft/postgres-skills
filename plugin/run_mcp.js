#!/usr/bin/env node
// --------------------------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.
// --------------------------------------------------------------------------------------------
//
// Plugin entry point for `pgsql-tools mcp run`.
//
// Ensures the `pgsql-tools` CLI matching the version pinned in
// `PGSQL_TOOLS_CLI_VERSION` (sibling to this file) is installed
// locally, then execs `pgsql-tools mcp run` with stdio inherited so
// the MCP client's JSON-RPC stream flows through unchanged.
//
// Self-contained: install + exec use only Node stdlib (`node:https`,
// `node:zlib`, `node:crypto`, `node:fs`, `node:child_process`) — no
// curl, wget, or bash dependency. Optional Windows user-PATH
// persistence shells out to powershell.exe (best-effort; any failure
// is logged and non-fatal). Mirrors the download + SHA-256 manifest
// verification + extraction flow of public/cli/install.sh and
// install.ps1, including their shell-rc / user-PATH update at the
// end of install so `pgsql-tools` resolves directly in new terminals.
//
// All diagnostic output goes to stderr so the MCP JSON-RPC channel
// on stdout stays clean.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const crypto = require("crypto");
const { execFileSync, spawn } = require("child_process");

const SCRIPT_DIR = __dirname;
const VERSION_FILE = path.join(SCRIPT_DIR, "PGSQL_TOOLS_CLI_VERSION");

const GITHUB_REPO = "microsoft/pgsql-tools";
const MANIFEST_NAME = "manifest.json";
const BINARY_NAME = "pgsql-tools";
const IS_WINDOWS = process.platform === "win32";

// Defensive bounds on fetchUrl() so a stalled or pathologically large
// release/manifest response can't hang the plugin startup or exhaust
// the Node heap before we reach the SHA-256 verification step. The
// timeout is per-request idle (resets on each chunk), so a slow but
// progressing download won't false-trip; only a truly stalled
// connection will. The byte cap bounds the worst case for an
// in-memory download buffer.
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

// Config root is preserved across (re)installs and upgrades; the
// PyInstaller bundle lives under bin/ so it can be replaced without
// nuking user data (connections.yaml + other state at the config
// root). Mirrors public/cli/install.sh.
const CONFIG_DIR = path.join(os.homedir(), ".pgsql-tools-cli");
const INSTALL_DIR = path.join(CONFIG_DIR, "bin");
const LOCAL_BIN_PATH = path.join(
  INSTALL_DIR,
  IS_WINDOWS ? `${BINARY_NAME}.exe` : BINARY_NAME,
);

// Shared install transaction state. The lock serializes concurrent
// launchers (and concurrent CLI installers); the staging dir holds the
// new bundle until verify-then-promote.
const LOCK_FILE = path.join(CONFIG_DIR, ".install.lock");
// Marker dropped after addToUserPath() completes (successfully or as a
// no-op when PATH was already configured) so subsequent launches skip
// the rc-read overhead. Lives under CONFIG_DIR so it survives bundle
// upgrades the same way connections.yaml does.
const PATH_MARKER_FILE = path.join(CONFIG_DIR, ".path-configured");
const installState = {
  lockAcquired: false,
  stagingDir: null,
};

// Source-of-truth: .pipelines/include-release.yml and the
// _PUBLISHED_TARGETS set in ossdbtoolsservice/cli/main.py. Failing
// here surfaces an explicit error instead of letting the user hit
// a generic 404 on the unsupported pair.
const SUPPORTED_TARGETS = new Set([
  "linux-arm64",
  "linux-x64",
  "osx-arm64",
  "osx-x86",
  "win-x64",
]);

function log(message) {
  process.stderr.write(`[pgsql-tools/run_mcp] ${message}\n`);
}

function readPinnedVersion() {
  let raw;
  try {
    raw = fs.readFileSync(VERSION_FILE, "utf8");
  } catch (err) {
    throw new Error(
      `Failed to read pinned version file at ${VERSION_FILE}: ${err.message}`,
    );
  }
  const trimmed = raw.trim().replace(/^v/, "");
  if (!trimmed) {
    throw new Error(`Pinned version file ${VERSION_FILE} is empty`);
  }
  return trimmed;
}

function detectPlatform() {
  let osName;
  switch (process.platform) {
    case "linux":
      osName = "linux";
      break;
    case "darwin":
      osName = "osx";
      break;
    case "win32":
      osName = "win";
      break;
    default:
      throw new Error(`Unsupported operating system: ${process.platform}`);
  }
  let arch;
  switch (process.arch) {
    case "x64":
      arch = "x64";
      break;
    case "arm64":
      arch = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${process.arch}`);
  }
  // macOS Intel ships under the osx-x86 asset name; mirror the
  // mapping in public/cli/install.sh::detect_platform.
  if (osName === "osx" && arch === "x64") {
    arch = "x86";
  }
  const platform = `${osName}-${arch}`;
  if (!SUPPORTED_TARGETS.has(platform)) {
    throw new Error(
      `No release artifact is published for ${platform}. ` +
        `Supported targets: ${[...SUPPORTED_TARGETS].join(", ")}`,
    );
  }
  return platform;
}

function fetchUrl(url, { maxRedirects = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const visit = (current, remaining) => {
      const req = https.get(
        current,
        { headers: { "User-Agent": "pgsql-tools-plugin-launcher" } },
        (res) => {
          const code = res.statusCode || 0;
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume();
            if (remaining <= 0) {
              reject(new Error(`Too many redirects fetching ${url}`));
              return;
            }
            const next = new URL(res.headers.location, current).toString();
            visit(next, remaining - 1);
            return;
          }
          if (code !== 200) {
            res.resume();
            reject(new Error(`HTTP ${code} fetching ${current}`));
            return;
          }
          const chunks = [];
          let total = 0;
          res.on("data", (c) => {
            total += c.length;
            if (total > MAX_DOWNLOAD_BYTES) {
              req.destroy(
                new Error(
                  `Response exceeded ${MAX_DOWNLOAD_BYTES} byte cap ` +
                    `while fetching ${current}`,
                ),
              );
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        },
      );
      // Per-request idle timeout: resets on each chunk, so a slow but
      // progressing download won't trip it; only a truly stalled
      // connection will. Destroying the request with an error routes
      // through the existing req.on("error", reject) below.
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(
          new Error(
            `Timed out after ${REQUEST_TIMEOUT_MS}ms fetching ${current}`,
          ),
        );
      });
      req.on("error", reject);
    };
    visit(url, maxRedirects);
  });
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function verifyChecksum(manifestUrl, archiveBuf, assetName) {
  log(`Fetching checksum manifest: ${manifestUrl}`);
  let raw;
  try {
    raw = await fetchUrl(manifestUrl);
  } catch (err) {
    throw new Error(
      `Failed to download ${MANIFEST_NAME} from the release: ${err.message}`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    throw new Error(`Failed to parse ${MANIFEST_NAME}: ${err.message}`);
  }
  if (manifest.algorithm !== "sha256") {
    throw new Error(
      `${MANIFEST_NAME} does not declare algorithm sha256 ` +
        `(got '${manifest.algorithm}')`,
    );
  }
  const declared =
    (manifest.hashes && manifest.hashes[assetName]) || "";
  const expected = String(declared).toLowerCase();
  if (!expected) {
    throw new Error(`${MANIFEST_NAME} has no entry for ${assetName}`);
  }
  const actual = sha256Hex(archiveBuf);
  if (actual !== expected) {
    throw new Error(
      `SHA-256 verification failed for ${assetName}.\n` +
        `  Expected: ${expected}\n` +
        `  Actual:   ${actual}\n` +
        `The downloaded file may be corrupted or tampered with.`,
    );
  }
  log(`Checksum OK (${expected})`);
}

// USTAR + GNU LongLink tar parser. Returns
//   { kind: "file" | "dir" | "symlink", name, mode, body?, linkname? }
// entries. Pax extended headers (typeflag 'x'/'g') are skipped
// (their body is consumed so the offset advances correctly).
// Hardlinks (typeflag '1') are not seen in any current published
// PyInstaller bundle and throw a clear error if encountered.
function parseTar(buf) {
  const entries = [];
  let off = 0;
  let pendingName = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;

    const readStr = (start, len) => {
      const slice = header.subarray(start, start + len);
      const zero = slice.indexOf(0);
      return slice.subarray(0, zero === -1 ? len : zero).toString("ascii");
    };
    const readOctal = (start, len) => {
      const s = readStr(start, len).trim();
      return s ? parseInt(s, 8) : 0;
    };

    const name = readStr(0, 100);
    const mode = readOctal(100, 8);
    const size = readOctal(124, 12);
    const typeflag =
      header[156] === 0 ? "\0" : String.fromCharCode(header[156]);
    const linkname = readStr(157, 100);
    const prefix = readStr(345, 155);

    let fullName;
    if (pendingName !== null) {
      fullName = pendingName;
      pendingName = null;
    } else if (prefix) {
      fullName = `${prefix}/${name}`;
    } else {
      fullName = name;
    }

    const bodyStart = off + 512;
    const body = buf.subarray(bodyStart, bodyStart + size);
    const bodyEnd = bodyStart + Math.ceil(size / 512) * 512;

    if (typeflag === "L") {
      const zero = body.indexOf(0);
      pendingName = body
        .subarray(0, zero === -1 ? body.length : zero)
        .toString("utf8");
    } else if (typeflag === "0" || typeflag === "\0") {
      entries.push({ kind: "file", name: fullName, mode, body });
    } else if (typeflag === "5") {
      entries.push({ kind: "dir", name: fullName, mode });
    } else if (typeflag === "2") {
      entries.push({ kind: "symlink", name: fullName, mode, linkname });
    } else if (typeflag === "1") {
      throw new Error(
        `Hardlink entries are not supported (got ${fullName} -> ${linkname})`,
      );
    }
    // typeflag 'x', 'g', 'K' etc.: skip — body already accounted for
    // via bodyEnd.

    off = bodyEnd;
  }
  return entries;
}

// Minimal zip reader supporting stored (0) and deflate (8). Bails on
// ZIP64 — PyInstaller's slim bundle stays well below the 4 GB / 65k-
// entry threshold, so no ZIP64 records are produced.
function parseZip(buf) {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;

  let eocdOff = -1;
  const minEocd = 22;
  const scanStart = Math.max(0, buf.length - (minEocd + 0xffff));
  for (let i = buf.length - minEocd; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOff = i;
      break;
    }
  }
  if (eocdOff < 0) {
    throw new Error("Not a zip archive: end-of-central-directory not found");
  }

  const totalEntries = buf.readUInt16LE(eocdOff + 10);
  const cdOffset = buf.readUInt32LE(eocdOff + 16);
  if (cdOffset === 0xffffffff || totalEntries === 0xffff) {
    throw new Error("ZIP64 archives are not supported");
  }

  const entries = [];
  let off = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(off) !== CD_SIG) {
      throw new Error(`Bad central directory signature at offset ${off}`);
    }
    const compMethod = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const externalAttrs = buf.readUInt32LE(off + 38);
    const localHeaderOff = buf.readUInt32LE(off + 42);
    const name = buf
      .subarray(off + 46, off + 46 + nameLen)
      .toString("utf8");

    if (
      compSize === 0xffffffff ||
      uncompSize === 0xffffffff ||
      localHeaderOff === 0xffffffff
    ) {
      throw new Error("ZIP64 archives are not supported");
    }
    if (buf.readUInt32LE(localHeaderOff) !== LFH_SIG) {
      throw new Error(
        `Bad local file header signature at offset ${localHeaderOff}`,
      );
    }
    const lNameLen = buf.readUInt16LE(localHeaderOff + 26);
    const lExtraLen = buf.readUInt16LE(localHeaderOff + 28);
    const dataOff = localHeaderOff + 30 + lNameLen + lExtraLen;
    const compBuf = buf.subarray(dataOff, dataOff + compSize);

    let body;
    if (compMethod === 0) {
      body = compBuf;
    } else if (compMethod === 8) {
      body = zlib.inflateRawSync(compBuf);
    } else {
      throw new Error(
        `Unsupported zip compression method ${compMethod} for ${name}`,
      );
    }
    if (body.length !== uncompSize) {
      throw new Error(`Uncompressed size mismatch for ${name}`);
    }

    const isDir = name.endsWith("/");
    // Info-ZIP encodes Unix file type + mode in the high 16 bits of
    // external_attrs. S_IFLNK = 0o120000 means symlink; the entry
    // body holds the link target as utf-8.
    const unixMode = (externalAttrs >>> 16) & 0o177777;
    const isSymlink = !isDir && (unixMode & 0o170000) === 0o120000;
    let mode = unixMode & 0o777;
    if (!mode) mode = isDir ? 0o755 : 0o644;
    if (isSymlink) {
      entries.push({
        kind: "symlink",
        name,
        mode,
        linkname: body.toString("utf8"),
      });
    } else {
      entries.push({ kind: isDir ? "dir" : "file", name, mode, body });
    }

    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Mirrors `tar --strip-components=1` (install.sh) and install.ps1's
// "single top-level dir" check: if every entry shares one top-level
// segment, strip it; otherwise leave names alone.
function chooseStripCount(entries) {
  const tops = new Set();
  for (const e of entries) {
    const first = e.name.split("/")[0];
    if (first) tops.add(first);
  }
  return tops.size === 1 ? 1 : 0;
}

function writeEntries(entries, destDir, strip) {
  const destReal = path.resolve(destDir);
  for (const e of entries) {
    let name = e.name;
    if (strip > 0) {
      const parts = name.split("/").filter(Boolean);
      if (parts.length <= strip) continue;
      name = parts.slice(strip).join("/");
    }
    if (!name) continue;

    const target = path.join(destDir, name);
    const rel = path.relative(destDir, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Refusing to extract outside destDir: ${e.name}`);
    }
    if (e.kind === "dir") {
      fs.mkdirSync(target, { recursive: true });
    } else if (e.kind === "symlink") {
      // Validate the symlink target resolves inside destDir to defend
      // against archives that try to escape via "..", absolute paths,
      // or paths containing other symlinks. We don't require the
      // target to exist yet — tar entries can reference paths laid
      // down by later entries — so we just resolve lexically.
      const linkname = e.linkname || "";
      if (!linkname) continue;
      const resolved = path.isAbsolute(linkname)
        ? path.resolve(linkname)
        : path.resolve(path.dirname(target), linkname);
      const resolvedRel = path.relative(destReal, resolved);
      if (resolvedRel.startsWith("..") || path.isAbsolute(resolvedRel)) {
        throw new Error(
          `Refusing to create symlink escaping destDir: ` +
            `${e.name} -> ${linkname}`,
        );
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Replace any prior entry at this path (e.g. partial state from
      // an interrupted install) before creating the symlink.
      try {
        fs.rmSync(target, { recursive: true, force: true });
      } catch (_) {
        // best effort
      }
      try {
        fs.symlinkSync(linkname, target);
      } catch (err) {
        if (IS_WINDOWS && err.code === "EPERM") {
          throw new Error(
            `Failed to create symlink ${target} -> ${linkname}: ` +
              `Windows requires Developer Mode or admin to create ` +
              `symlinks. Original error: ${err.message}`,
          );
        }
        throw err;
      }
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, e.body, {
        mode: (e.mode & 0o777) || 0o644,
      });
    }
  }
}

function extractArchive(buf, destDir, assetName) {
  const entries = assetName.endsWith(".zip")
    ? parseZip(buf)
    : parseTar(zlib.gunzipSync(buf));
  writeEntries(entries, destDir, chooseStripCount(entries));
}

function sleepSync(ms) {
  // Block the event loop without busy-waiting. Atomics.wait on a
  // SharedArrayBuffer is the stdlib way to sleep synchronously in Node;
  // we only need it during lock-contention backoff, which is rare.
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function acquireInstallLock() {
  const maxAttempts = 120;
  let attempt = 0;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  while (true) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      try {
        fs.writeSync(fd, String(process.pid));
      } finally {
        fs.closeSync(fd);
      }
      installState.lockAcquired = true;
      installCleanupOnExitOnce();
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holder = null;
      try {
        const raw = fs.readFileSync(LOCK_FILE, "utf8").trim();
        const parsed = parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0) holder = parsed;
      } catch (_) {
        // unreadable lock — treat as stale
      }
      if (holder !== null && !isProcessAlive(holder)) {
        log(`Removing stale install lock (pid ${holder})`);
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch (_) {
          // raced with another cleaner
        }
        continue;
      }
      if (attempt >= maxAttempts) {
        throw new Error(
          `Install lock at ${LOCK_FILE} held by pid ${holder ?? "?"}. ` +
            `Wait for the other installer to finish, then retry.`,
        );
      }
      if (attempt === 0) {
        log(`Waiting for install lock (pid ${holder ?? "?"})...`);
      }
      attempt += 1;
      sleepSync(500);
    }
  }
}

function installCleanup() {
  if (installState.stagingDir) {
    try {
      fs.rmSync(installState.stagingDir, { recursive: true, force: true });
    } catch (_) {
      // best effort
    }
    installState.stagingDir = null;
  }
  if (installState.lockAcquired) {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch (_) {
      // best effort
    }
    installState.lockAcquired = false;
  }
}

let _cleanupHooked = false;
function installCleanupOnExitOnce() {
  if (_cleanupHooked) return;
  _cleanupHooked = true;
  const run = () => installCleanup();
  process.on("exit", run);
  process.on("SIGINT", () => {
    run();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    run();
    process.exit(143);
  });
}

function sweepTransientDirs() {
  let entries;
  try {
    entries = fs.readdirSync(CONFIG_DIR);
  } catch (_) {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(".staging.") && !name.startsWith(".old.")) continue;
    try {
      fs.rmSync(path.join(CONFIG_DIR, name), {
        recursive: true,
        force: true,
      });
    } catch (_) {
      // best effort
    }
  }
}

function verifyStagedBundle(stagedDir, pinnedVersion) {
  const stagedBin = path.join(
    stagedDir,
    IS_WINDOWS ? `${BINARY_NAME}.exe` : BINARY_NAME,
  );
  if (!fs.existsSync(stagedBin)) {
    throw new Error(`Staged binary missing at ${stagedBin}`);
  }
  if (!IS_WINDOWS) {
    fs.chmodSync(stagedBin, 0o755);
  }
  const version = readInstalledVersion(stagedBin);
  if (!version || version !== pinnedVersion) {
    throw new Error(
      `Staged binary reports version '${version ?? "unknown"}', ` +
        `expected '${pinnedVersion}'.`,
    );
  }
  log(`Staged binary verified: ${version}`);
}

function promoteStaging(stagedDir) {
  let oldDir = null;
  if (fs.existsSync(INSTALL_DIR)) {
    oldDir = path.join(
      CONFIG_DIR,
      `.old.${crypto.randomBytes(6).toString("hex")}`,
    );
    fs.renameSync(INSTALL_DIR, oldDir);
  }
  try {
    fs.renameSync(stagedDir, INSTALL_DIR);
  } catch (err) {
    if (oldDir) {
      try {
        fs.renameSync(oldDir, INSTALL_DIR);
      } catch (_) {
        // rollback failed; surface original error
      }
    }
    throw err;
  }
  installState.stagingDir = null;
  if (oldDir) {
    try {
      fs.rmSync(oldDir, { recursive: true, force: true });
    } catch (_) {
      // best effort
    }
  }
}

async function installCli(pinnedVersion) {
  const platform = detectPlatform();
  log(`Detected platform: ${platform}`);

  const ext = platform.startsWith("win-") ? "zip" : "tar.gz";
  const assetName = `pgsql-tools-cli-${platform}.${ext}`;
  const releaseTag = `cli-v${pinnedVersion}`;
  const baseUrl =
    `https://github.com/${GITHUB_REPO}/releases/download/${releaseTag}`;
  const assetUrl = `${baseUrl}/${assetName}`;
  const manifestUrl = `${baseUrl}/${MANIFEST_NAME}`;

  acquireInstallLock();
  try {
    sweepTransientDirs();

    log(`Downloading: ${assetUrl}`);
    let archive;
    try {
      archive = await fetchUrl(assetUrl);
    } catch (err) {
      throw new Error(`Failed to download ${assetName}: ${err.message}`);
    }

    await verifyChecksum(manifestUrl, archive, assetName);

    // Stage in a sibling of INSTALL_DIR so the promote rename is on the
    // same filesystem. Existing bundle stays untouched until verified.
    const stagingDir = path.join(
      CONFIG_DIR,
      `.staging.${crypto.randomBytes(6).toString("hex")}`,
    );
    fs.mkdirSync(stagingDir, { recursive: true });
    installState.stagingDir = stagingDir;

    log(`Staging to ${stagingDir}`);
    extractArchive(archive, stagingDir, assetName);

    verifyStagedBundle(stagingDir, pinnedVersion);

    if (fs.existsSync(INSTALL_DIR)) {
      log(
        `Replacing existing bundle at ${INSTALL_DIR} ` +
          `(config preserved at ${CONFIG_DIR})`,
      );
    }
    promoteStaging(stagingDir);
  } finally {
    // Release the lock as soon as install is done so the launcher's
    // long-running MCP child doesn't keep it held for the session.
    installCleanup();
  }

  // Mirror install.sh's add_to_path / install.ps1's Add-ToPath, which
  // run at the end of a successful install so `pgsql-tools` is
  // available directly in new terminals. Failure here never breaks
  // MCP launch — the launcher execs the binary by absolute path.
  addToUserPath({ force: true });
}

// Pick the shell rc file that a non-interactive Node process should
// edit. Mirrors install.sh add_to_path(), but since $ZSH_VERSION /
// $BASH_VERSION are only set in interactive shells we rely on $SHELL
// (with os.userInfo().shell as a fallback for IDE / launchd contexts
// where the env var may be unset). On macOS, default to .zshrc when
// the shell is unknown or a non-shell sentinel (nologin / false) —
// modern macOS ships zsh as the login shell, so .profile would be a
// file the user's shell never sources.
function detectShellRcPath() {
  const envShell = process.env.SHELL ?? "";
  let shell = envShell;
  if (!shell || /\/(nologin|false)$/.test(shell)) {
    try {
      shell = os.userInfo().shell ?? "";
    } catch (_) {
      shell = "";
    }
  }
  if (shell.includes("zsh")) {
    return path.join(os.homedir(), ".zshrc");
  }
  if (shell.includes("bash")) {
    return process.platform === "darwin"
      ? path.join(os.homedir(), ".bash_profile")
      : path.join(os.homedir(), ".bashrc");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), ".zshrc");
  }
  return path.join(os.homedir(), ".profile");
}

// POSIX branch of addToUserPath. Idempotent: a substring check on the
// install-dir marker prevents duplicate appends even if the marker
// file is missing (e.g., user deleted CONFIG_DIR/.path-configured).
function addToUserPathPosix() {
  const rc = detectShellRcPath();
  const marker = ".pgsql-tools-cli/bin";
  if (fs.existsSync(rc)) {
    let existing;
    try {
      existing = fs.readFileSync(rc, "utf8");
    } catch (err) {
      log(`Could not read ${rc} to configure PATH: ${err.message}`);
      return false;
    }
    if (existing.includes(marker)) {
      log(`PATH already configured in ${rc}`);
      return true;
    }
  }
  const block =
    `\n# pgsql-tools-cli\n` +
    `export PATH="$HOME/.pgsql-tools-cli/bin:$PATH"\n`;
  try {
    fs.appendFileSync(rc, block);
  } catch (err) {
    log(`Could not update ${rc} to add pgsql-tools to PATH: ${err.message}`);
    return false;
  }
  log(`Added pgsql-tools to PATH in ${rc}`);
  log(`Open a new terminal (or 'source ${rc}') to pick up the change.`);
  return true;
}

// Windows branch of addToUserPath. Mirrors install.ps1 Add-ToPath: read
// the User scope Path, check for the install dir, persist via
// SetEnvironmentVariable("Path", ..., "User") if missing. stdout from
// the child is captured (execFileSync), never inherited, so the MCP
// JSON-RPC channel on this process's stdout stays clean.
function addToUserPathWindows() {
  const escapedBin = INSTALL_DIR.replace(/'/g, "''");
  const psScript = [
    `$ErrorActionPreference = 'Stop'`,
    `$binPath = '${escapedBin}'`,
    `$current = [Environment]::GetEnvironmentVariable('Path', `
      + `[EnvironmentVariableTarget]::User)`,
    `$entries = if ($current) { $current.Split(';') } else { @() }`,
    `if ($entries -contains $binPath) {`,
    `  Write-Output 'ALREADY_CONFIGURED'`,
    `} else {`,
    `  $newPath = if ($current) { "$binPath;$current" } else { $binPath }`,
    `  [Environment]::SetEnvironmentVariable('Path', $newPath, `
      + `[EnvironmentVariableTarget]::User)`,
    `  Write-Output 'ADDED'`,
    `}`,
  ].join("; ");
  let output;
  try {
    output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psScript],
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (err) {
    log(`Could not update user PATH via PowerShell: ${err.message}`);
    return false;
  }
  if (output.includes("ALREADY_CONFIGURED")) {
    log(`User PATH already contains ${INSTALL_DIR}`);
  } else if (output.includes("ADDED")) {
    log(`Added ${INSTALL_DIR} to user PATH`);
    log(`Open a new terminal to pick up the change.`);
  } else {
    log(`PowerShell PATH update returned unexpected output: ${output}`);
    return false;
  }
  return true;
}

// Cross-platform dispatcher. `force` makes us redo the check + edit
// even when the marker file says we've already attempted it (used
// right after a fresh install, mirroring install.sh's unconditional
// add_to_path call). Without `force`, the marker short-circuits the
// rc-read on every subsequent MCP launch.
function addToUserPath({ force = false } = {}) {
  try {
    if (!force && fs.existsSync(PATH_MARKER_FILE)) {
      return;
    }
    const ok = IS_WINDOWS ? addToUserPathWindows() : addToUserPathPosix();
    if (!ok) {
      return;
    }
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(PATH_MARKER_FILE, "");
    } catch (err) {
      log(`Could not write PATH marker ${PATH_MARKER_FILE}: ${err.message}`);
    }
  } catch (err) {
    log(`PATH setup skipped: ${err.message}`);
  }
}

// Output shape is set by `click.version_option(message="%(prog)s
// %(version)s")` in ossdbtoolsservice/cli/main.py; parse the last
// whitespace-separated token so a minor formatting change in click
// (e.g. trailing build metadata) doesn't break the check.
function readInstalledVersion(cliPath) {
  try {
    const out = execFileSync(cliPath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    const line = out.trim().split(/\r?\n/).pop() || "";
    const tokens = line.split(/\s+/);
    const last = tokens[tokens.length - 1] || "";
    return last.replace(/^v/, "") || null;
  } catch (err) {
    log(`pgsql-tools --version failed: ${err.message}`);
    return null;
  }
}

// The plugin-managed bundle at LOCAL_BIN_PATH is the only path we
// trust for binary resolution. We deliberately do not probe the
// user's PATH: a binary named `pgsql-tools` on PATH with a matching
// `--version` would otherwise bypass the upstream-verified download
// + checksum flow. The PATH edit performed by addToUserPath() is a
// separate concern — it only helps the user invoke `pgsql-tools`
// from their own shell, and never affects how this launcher locates
// the binary it execs.
async function ensureCli(pinnedVersion) {
  if (fs.existsSync(LOCAL_BIN_PATH)) {
    const installed = readInstalledVersion(LOCAL_BIN_PATH);
    if (installed === pinnedVersion) {
      log(`pgsql-tools ${installed} found at ${LOCAL_BIN_PATH}`);
      // Handles users whose bundle predates this launcher's PATH-edit
      // support: the marker file gates this to a one-time attempt so
      // steady-state launches stay quiet.
      addToUserPath();
      return LOCAL_BIN_PATH;
    }
    log(
      `pgsql-tools version mismatch at ${LOCAL_BIN_PATH} ` +
        `(installed=${installed ?? "unknown"}, pinned=${pinnedVersion})`,
    );
  } else {
    log(`pgsql-tools not found at ${LOCAL_BIN_PATH}`);
  }

  await installCli(pinnedVersion);

  if (!fs.existsSync(LOCAL_BIN_PATH)) {
    throw new Error(`pgsql-tools missing at ${LOCAL_BIN_PATH} after install`);
  }
  const postVersion = readInstalledVersion(LOCAL_BIN_PATH);
  if (postVersion !== pinnedVersion) {
    throw new Error(
      `Installed pgsql-tools ${postVersion ?? "unknown"} at ${LOCAL_BIN_PATH}, ` +
        `expected ${pinnedVersion}`,
    );
  }
  log(`pgsql-tools ${postVersion} installed at ${LOCAL_BIN_PATH}`);
  return LOCAL_BIN_PATH;
}

function execMcp(cliPath) {
  const child = spawn(cliPath, ["mcp", "run"], {
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.on("error", (err) => {
    log(`Failed to spawn ${cliPath}: ${err.message}`);
    process.exit(1);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (!child.killed) child.kill(sig);
    });
  }
}

async function main() {
  let pinnedVersion;
  try {
    pinnedVersion = readPinnedVersion();
  } catch (err) {
    log(err.message);
    process.exit(1);
  }
  log(`Pinned pgsql-tools version: ${pinnedVersion}`);

  let cliPath;
  try {
    cliPath = await ensureCli(pinnedVersion);
  } catch (err) {
    log(err.message);
    process.exit(1);
  }
  execMcp(cliPath);
}

main().catch((err) => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
