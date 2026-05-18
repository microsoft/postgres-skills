#!/usr/bin/env node
// run_mcp.js — Downloads pgsql-tools CLI from GitHub Releases and runs `pgsql-tools mcp run`.
// Used by MCP server configs so AI coding agents can launch the PostgreSQL MCP server
// without requiring a global install or npx.

const { execFileSync, spawn } = require("child_process");
const { createWriteStream, existsSync, mkdirSync, chmodSync, readdirSync } = require("fs");
const { join, resolve } = require("path");
const https = require("https");
const os = require("os");
const { createHash } = require("crypto");
const { readFileSync } = require("fs");

// --- Configuration -----------------------------------------------------------
const RELEASE_TAG = "cli-v0.0.1-dev.5";
const RELEASE_BASE = `https://github.com/microsoft/pgsql-tools/releases/download/${RELEASE_TAG}`;
const CACHE_DIR = join(os.homedir(), ".pgsql-tools", RELEASE_TAG);

const EXPECTED_HASHES = {
  "pgsql-tools-cli-linux-x64.tar.gz":    "473cfae142c8cca4fc48a103d961576e83efc866d60d228e7ac7735af97d597e",
  "pgsql-tools-cli-linux-arm64.tar.gz":   "963211fed3478d7c542e0347b64d8b8be5d5f10c7d64ea863365db4afb1684f8",
  "pgsql-tools-cli-osx-arm64.tar.gz":     "df8460aee926a36d880de3b70e3ff331b95c298b62a688c24b7dba106e3c212a",
  "pgsql-tools-cli-osx-x86.tar.gz":       "7054a7ce22797768c60d2ea20861b6514a76310ca901f9427b00eb0c250dfe52",
  "pgsql-tools-cli-win-x64.zip":          "dca158e5118244328578b6c3bb1352dd0a6f4d91f2f569a36462bcaafc305838",
};

// --- Platform detection ------------------------------------------------------
function getAssetName() {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === "win32")  return "pgsql-tools-cli-win-x64.zip";
  if (platform === "darwin")  return arch === "arm64"
    ? "pgsql-tools-cli-osx-arm64.tar.gz"
    : "pgsql-tools-cli-osx-x86.tar.gz";
  if (platform === "linux")   return arch === "arm64"
    ? "pgsql-tools-cli-linux-arm64.tar.gz"
    : "pgsql-tools-cli-linux-x64.tar.gz";
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

function getBinaryName() {
  return os.platform() === "win32" ? "pgsql-tools.exe" : "pgsql-tools";
}

// --- Download with redirect following ----------------------------------------
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const follow = (u) => {
      https.get(u, { headers: { "User-Agent": "pgsql-tools-runner" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} downloading ${u}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", reject);
    };
    follow(url);
  });
}

// --- SHA-256 verification ----------------------------------------------------
function verifySha256(filePath, expected) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  const actual = hash.digest("hex");
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch for ${filePath}\n  expected: ${expected}\n  actual:   ${actual}`
    );
  }
}

// --- Extract archive ---------------------------------------------------------
function extract(archivePath, destDir) {
  if (archivePath.endsWith(".zip")) {
    // Windows: use PowerShell to extract (suppress progress bar)
    execFileSync("powershell", [
      "-NoProfile", "-Command",
      `$ProgressPreference='SilentlyContinue'; Expand-Archive -Force -Path '${archivePath}' -DestinationPath '${destDir}'`
    ], { stdio: "ignore" });
  } else {
    // tar.gz on Linux/macOS
    execFileSync("tar", ["xzf", archivePath, "-C", destDir], { stdio: "ignore" });
  }
}

// --- Find the binary after extraction ----------------------------------------
function findBinary(dir, name) {
  // Binary may be at top level or nested one level (e.g., inside a subfolder).
  // Don't move it — it may depend on sibling files (_internal/, etc.)
  const direct = join(dir, name);
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nested = join(dir, entry.name, name);
      if (existsSync(nested)) return nested;
    }
  }
  throw new Error(`Could not find ${name} in ${dir} after extraction`);
}

// --- Main --------------------------------------------------------------------
async function main() {
  const assetName = getAssetName();
  const binaryName = getBinaryName();
  const markerPath = join(CACHE_DIR, ".installed");

  // Download and extract if not already cached
  if (!existsSync(markerPath)) {
    process.stderr.write(`[run_mcp] Downloading pgsql-tools ${RELEASE_TAG} (${assetName})...\n`);
    mkdirSync(CACHE_DIR, { recursive: true });

    const archivePath = join(CACHE_DIR, assetName);
    await download(`${RELEASE_BASE}/${assetName}`, archivePath);

    // Verify integrity
    const expectedHash = EXPECTED_HASHES[assetName];
    if (expectedHash) {
      verifySha256(archivePath, expectedHash);
      process.stderr.write("[run_mcp] SHA-256 verified.\n");
    }

    // Extract
    extract(archivePath, CACHE_DIR);

    // Mark as installed
    require("fs").writeFileSync(markerPath, RELEASE_TAG);
    process.stderr.write("[run_mcp] Installed.\n");
  }

  // Locate binary (may be in a subfolder from extraction)
  const binaryPath = findBinary(CACHE_DIR, binaryName);
  if (os.platform() !== "win32") {
    chmodSync(binaryPath, 0o755);
  }

  // Launch: pgsql-tools mcp run (inherit stdio for MCP protocol)
  const child = spawn(binaryPath, ["mcp", "run"], {
    stdio: "inherit",
    env: { ...process.env },
  });

  child.on("error", (err) => {
    process.stderr.write(`[run_mcp] Failed to start pgsql-tools: ${err.message}\n`);
    process.exit(1);
  });

  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((err) => {
  process.stderr.write(`[run_mcp] ${err.message}\n`);
  process.exit(1);
});
