import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APPROVAL_GATES = new Set([
  "access-scope",
  "pilot-write",
  "production-write",
  "application-change",
  "cutover",
  "cleanup",
]);
const INTERACTION_MODES = new Set(["guided", "standard", "expert"]);
const CHECK_LAYERS = new Set([
  "automated-core",
  "workload-acceptance",
  "production-hardening",
]);
const USER_CHECK_LAYERS = new Set([
  "workload-acceptance",
  "production-hardening",
]);
const CHECK_STATUSES = new Set([
  "pass",
  "fail",
  "approved-exception",
  "not-run",
  "unknown",
]);
const SUCCESS_OUTCOMES = new Set(["pass", "passed", "success", "succeeded", "complete", "completed", "ready"]);
const FAILURE_OUTCOMES = new Set(["fail", "failed", "error", "blocked"]);
const INCOMPLETE_OUTCOMES = new Set(["incomplete", "partial", "running", "pending", "unknown", "unavailable"]);
const SECRET_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "access_token",
  "client_secret",
  "connection_string",
  "dsn",
  "uri",
  "url",
]);
const SECRET_REFERENCE_KEYS = new Set([
  "env",
  "environment",
  "file",
  "secretref",
  "secret_ref",
  "profile",
  "profile_ref",
]);
const CONNECTION_PATTERN =
  /(?:neo4j(?:\+s|\+ssc)?:\/\/|postgres(?:ql)?:\/\/)[^/\s:@]+:[^@\s]+@[^\s"'`]+/gi;
const SECRET_PATTERN =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret)[ \t]*[:=][ \t]*([^\s,;]+)/gi;
const JOB_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const PROPOSAL_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*@[1-9][0-9]*$/;
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES"]);
const APPROVAL_VERSION = 1;

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} is required`);
  }
  return value.trim();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function now() {
  return new Date().toISOString();
}

function redact(value) {
  return String(value ?? "")
    .replace(CONNECTION_PATTERN, "<redacted-connection>")
    .replace(SECRET_PATTERN, "$1=<redacted>");
}

function assertSanitized(value, label = "value") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (CONNECTION_PATTERN.test(text) || SECRET_PATTERN.test(text)) {
    CONNECTION_PATTERN.lastIndex = 0;
    SECRET_PATTERN.lastIndex = 0;
    throw new Error(`${label} must not contain credentials or credential-bearing connection strings`);
  }
  CONNECTION_PATTERN.lastIndex = 0;
  SECRET_PATTERN.lastIndex = 0;
}

function stripYamlValue(value) {
  const comment = value.replace(/\s+#.*$/, "").trim();
  if (
    (comment.startsWith('"') && comment.endsWith('"')) ||
    (comment.startsWith("'") && comment.endsWith("'"))
  ) {
    return comment.slice(1, -1);
  }
  return comment;
}

function isSafeSecretReference(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(trimmed)) return true;
  if (/^(env|file|profile|secretref|secret_ref):[A-Za-z0-9_./:@-]+$/i.test(trimmed)) return true;
  if (/^\{\s*(env|file|profile|secretref|secret_ref)\s*:\s*[A-Za-z0-9_./:@-]+\s*\}$/i.test(trimmed)) return true;
  return false;
}

function validateSecretNode(node, location) {
  if (typeof node === "string") {
    if (!isSafeSecretReference(node)) {
      throw new Error(`Sensitive field at ${location} must use a supported secret reference`);
    }
    return;
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(`Sensitive field at ${location} must use a supported secret reference`);
  }
  const entries = Object.entries(node);
  if (entries.length !== 1 || !SECRET_REFERENCE_KEYS.has(entries[0][0].toLowerCase())) {
    throw new Error(`Sensitive field at ${location} must contain exactly one supported secret reference`);
  }
  if (typeof entries[0][1] !== "string" || !entries[0][1].trim()) {
    throw new Error(`Sensitive field at ${location} contains an invalid secret reference`);
  }
}

function validateJsonSecrets(value, location = "$", parentKey = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonSecrets(item, `${location}[${index}]`, parentKey));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    const childLocation = `${location}.${key}`;
    if (SECRET_KEYS.has(normalized) && !(["uri", "url"].includes(normalized) && typeof child === "string" && !/:[^/@\s]+@/.test(child))) {
      validateSecretNode(child, childLocation);
    } else {
      validateJsonSecrets(child, childLocation, normalized);
    }
  }
}

function validateYamlSecrets(content) {
  const lines = content.split(/\r?\n/);
  const stack = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith("#") || raw.trimStart().startsWith("---")) continue;
    if (raw.includes("\t")) throw new Error(`Job YAML uses unsupported tab indentation at line ${index + 1}`);
    const match = raw.match(/^(\s*)(?:-\s*)?([^:#][^:]*):(?:\s*(.*))?$/);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2].trim().replace(/^["']|["']$/g, "").toLowerCase();
    const value = stripYamlValue(match[3] ?? "");
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const location = [...stack.map((item) => item.key), key].join(".");
    const sensitive = SECRET_KEYS.has(key);
    if (sensitive && !(["uri", "url"].includes(key) && value && !/:[^/@\s]+@/.test(value))) {
      if (value) {
        if (!isSafeSecretReference(value)) {
          throw new Error(`Sensitive field at ${location} must use a supported secret reference`);
        }
      } else {
        const children = [];
        for (let next = index + 1; next < lines.length; next += 1) {
          const childRaw = lines[next];
          if (!childRaw.trim() || childRaw.trimStart().startsWith("#")) continue;
          const childIndent = childRaw.match(/^\s*/)[0].length;
          if (childIndent <= indent) break;
          const childMatch = childRaw.match(/^\s*(?:-\s*)?([^:#][^:]*):(?:\s*(.*))?$/);
          if (childMatch && childIndent > indent) {
            children.push([childMatch[1].trim().toLowerCase(), stripYamlValue(childMatch[2] ?? "")]);
          }
        }
        if (
          children.length !== 1 ||
          !SECRET_REFERENCE_KEYS.has(children[0][0]) ||
          !children[0][1]
        ) {
          throw new Error(`Sensitive field at ${location} must contain exactly one supported secret reference`);
        }
      }
    }
    if (!value) stack.push({ indent, key });
  }
}

export function validateJobContent(content) {
  requiredString(content, "job content");
  try {
    const parsed = JSON.parse(content);
    validateJsonSecrets(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) validateYamlSecrets(content);
    else throw error;
  }
  if (CONNECTION_PATTERN.test(content)) {
    CONNECTION_PATTERN.lastIndex = 0;
    throw new Error("job file must not contain credential-bearing connection strings");
  }
  CONNECTION_PATTERN.lastIndex = 0;
}

async function rejectSymlink(file, allowMissing = false) {
  try {
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Migration paths must not be symbolic links: ${file}`);
    }
  } catch (error) {
    if (error.code === "ENOENT" && allowMissing) return;
    throw error;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function atomicWrite(
  file,
  content,
  {
    renameImpl = rename,
    retries = 6,
    baseDelayMs = 10,
    sleepImpl = sleep,
  } = {},
) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await renameImpl(temporary, file);
        break;
      } catch (error) {
        if (!TRANSIENT_RENAME_CODES.has(error.code) || attempt >= retries) throw error;
        await sleepImpl(Math.min(baseDelayMs * (2 ** attempt), 250));
      }
    }
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function stateFile(workspace) {
  return path.join(path.resolve(workspace), "migration-state.yaml");
}

async function readState(workspace) {
  const state = JSON.parse(await readFile(stateFile(workspace), "utf8"));
  if (state.schemaVersion !== 2) {
    throw new Error(`Unsupported migration state schema: ${state.schemaVersion}`);
  }
  return state;
}

async function writeState(workspace, state) {
  state.updatedAt = now();
  state.history = (state.history ?? []).slice(-299);
  assertSanitized(state, "migration state");
  await atomicWrite(stateFile(workspace), `${JSON.stringify(state, null, 2)}\n`);
}

function appendHistory(state, event, detail = {}) {
  assertSanitized(detail, "history detail");
  state.history ??= [];
  state.history.push({ at: now(), event, ...detail });
}

function relativeArtifact(workspace, file) {
  return path.relative(path.resolve(workspace), file).replaceAll("\\", "/");
}

async function pathFingerprint(value) {
  if (!value) return null;
  const resolved = path.resolve(value);
  let metadata = "missing";
  try {
    const info = await stat(resolved);
    if (info.isDirectory()) {
      const entries = [];
      async function walk(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.name === ".git") continue;
          const absolute = path.join(directory, entry.name);
          const relative = path.relative(resolved, absolute).replaceAll("\\", "/");
          if (entry.isDirectory()) {
            entries.push(`directory:${relative}`);
            await walk(absolute);
          } else if (entry.isFile()) {
            entries.push(`file:${relative}:${digest(await readFile(absolute))}`);
          } else {
            entries.push(`other:${relative}`);
          }
        }
      }
      await walk(resolved);
      metadata = `directory:${entries.sort().join("\n")}`;
    } else {
      metadata = `file:${digest(await readFile(resolved))}`;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return digest(`${resolved}\n${metadata}`);
}

function proposalDigestMap(state, refs) {
  return Object.fromEntries(refs.map((ref) => {
    const proposal = state.proposals?.[ref];
    if (!proposal) throw new Error(`Translation proposal ${ref} is not registered`);
    return [ref, proposal.contentDigest];
  }));
}

function bindingFor(state, gate, proposalRefs = [], current = {}) {
  const base = {
    approvalVersion: APPROVAL_VERSION,
    gate,
    migrationName: state.migrationName,
    sourceProfileFingerprint: state.fingerprints.sourceProfile,
    targetProfileFingerprint: state.fingerprints.targetProfile,
    repositoryFingerprint: current.repositoryFingerprint ?? state.fingerprints.repository,
    jobDigest: current.jobDigest ?? state.jobDigest,
    mappingFingerprint: state.fingerprints.mapping,
  };
  if (gate === "pilot-write") base.readinessDigest = state.readiness?.evidenceDigest ?? null;
  if (gate === "production-write") {
    base.readinessDigest = state.readiness?.evidenceDigest ?? null;
    base.pilotEvidenceDigest = state.pilot?.evidenceDigest ?? null;
  }
  if (gate === "application-change") base.proposals = proposalDigestMap(state, proposalRefs);
  if (gate === "cutover") {
    base.goNoGoDigest = state.goNoGo?.digest ?? null;
    base.runbookDigest = state.cutover?.runbookDigest ?? null;
    base.rollbackEvidenceDigest = state.rollback?.evidenceDigest ?? null;
  }
  if (gate === "cleanup") {
    base.cutoverEvidenceDigest = state.cutover?.evidenceDigest ?? null;
    base.observationEvidenceDigest = state.observation?.evidenceDigest ?? null;
    base.rollbackWindowSatisfiedAt = state.observation?.rollbackWindowSatisfiedAt ?? null;
  }
  return base;
}

function approvalFor(state, gate) {
  return [...(state.approvals ?? [])].reverse().find((approval) => approval.gate === gate && approval.active);
}

async function currentBindingInputs(state, workspace) {
  const repositoryFingerprint = await pathFingerprint(state.repository);
  let jobDigest = state.jobDigest;
  if (state.jobFile) {
    jobDigest = digest(await readFile(path.join(path.resolve(workspace), state.jobFile), "utf8"));
  }
  return { repositoryFingerprint, jobDigest };
}

async function requireApproval(state, gate, workspace) {
  const approval = approvalFor(state, gate);
  if (!approval) {
    throw new Error(`Approval gate "${gate}" is required. Record the reviewed scope with the approve command.`);
  }
  if (approval.version !== APPROVAL_VERSION) throw new Error(`Approval gate "${gate}" uses an unsupported version`);
  if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now()) {
    throw new Error(`Approval gate "${gate}" has expired`);
  }
  const current = bindingFor(
    state,
    gate,
    approval.proposals ?? [],
    await currentBindingInputs(state, workspace),
  );
  if (digest(JSON.stringify(current)) !== approval.bindingDigest) {
    throw new Error(`Approval gate "${gate}" is stale because relevant migration state changed`);
  }
  return approval;
}

async function copyReviewedJob(source, destination) {
  const sourcePath = path.resolve(requiredString(source, "job file"));
  await rejectSymlink(sourcePath);
  const content = await readFile(sourcePath, "utf8");
  validateJobContent(content);
  await copyFile(sourcePath, destination);
  await chmod(destination, 0o600).catch(() => {});
  return digest(content);
}

function initialState({ migrationName, mode, sourceProfile, targetProfile, repository, jobDigest }) {
  const createdAt = now();
  return {
    schemaVersion: 2,
    migrationName,
    interactionMode: mode,
    phase: jobDigest ? "initialized" : "discovery-only",
    status: "needs-attention",
    createdAt,
    updatedAt: createdAt,
    jobFile: jobDigest ? "job.yaml" : null,
    jobDigest: jobDigest ?? null,
    profiles: { source: sourceProfile ?? null, target: targetProfile ?? null },
    repository: repository ? path.resolve(repository) : null,
    fingerprints: {
      sourceProfile: sourceProfile ? digest(sourceProfile) : null,
      targetProfile: targetProfile ? digest(targetProfile) : null,
      repository: null,
      mapping: jobDigest ?? null,
    },
    agefreighter: {
      jobId: null,
      context: null,
      activeJobFile: jobDigest ? "job.yaml" : null,
      activeJobDigest: jobDigest ?? null,
      lastCommand: null,
      lastExitCode: null,
      binary: null,
    },
    approvals: [],
    proposals: {},
    readiness: { completed: false, outcome: "BLOCKED", evidenceDigest: null },
    pilot: { completed: false, accepted: false, evidenceDigest: null },
    checks: {
      "automated-core": { status: "not-run", evidence: null, owner: "runner" },
      "workload-acceptance": { status: "not-run", evidence: null },
      "production-hardening": { status: "not-run", evidence: null },
    },
    rollback: { evidence: null, evidenceDigest: null },
    cutover: {
      runbookDigest: null,
      outcome: null,
      evidenceDigest: null,
      approvalId: null,
    },
    observation: {
      accepted: false,
      evidenceDigest: null,
      rollbackWindowSatisfiedAt: null,
    },
    goNoGo: { decision: null, digest: null },
    artifacts: {
      discovery: "discovery-readiness.md",
      readiness: "readiness.md",
      dashboard: "migration-status.md",
      verification: "verification.md",
      cutover: "cutover-runbook.md",
      report: "migration-report.md",
    },
    blockers: jobDigest ? [] : ["A reviewed AGEFreighter job has not been attached"],
    nextAction: jobDigest
      ? "Approve the bounded access scope, then run assess."
      : "Review discovery-readiness.md, then attach a reviewed job with attach-job.",
    rollbackState: "not yet created",
    history: [{ at: createdAt, event: jobDigest ? "initialized" : "discovery-initialized" }],
  };
}

export async function initializeMigration({
  workspace,
  name,
  job = null,
  sourceProfile = null,
  targetProfile = null,
  repository = null,
  mode = "standard",
}) {
  const root = path.resolve(requiredString(workspace, "workspace"));
  const migrationName = requiredString(name, "migration name");
  if (!INTERACTION_MODES.has(mode)) {
    throw new Error(`Interaction mode must be one of: ${[...INTERACTION_MODES].join(", ")}`);
  }
  if (!job && !(sourceProfile && targetProfile && repository)) {
    throw new Error("init requires either --job or saved source-profile, target-profile, and repository references");
  }
  await rejectSymlink(root, true);
  await mkdir(root, { recursive: true });
  await rejectSymlink(root);
  for (const directory of ["logs", "translations", "command-output"]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  let jobDigest = null;
  if (job) jobDigest = await copyReviewedJob(job, path.join(root, "job.yaml"));
  const state = initialState({
    migrationName,
    mode,
    sourceProfile: sourceProfile && requiredString(sourceProfile, "source profile"),
    targetProfile: targetProfile && requiredString(targetProfile, "target profile"),
    repository: repository && requiredString(repository, "repository"),
    jobDigest,
  });
  state.fingerprints.repository = await pathFingerprint(state.repository);
  await writeState(root, state);
  await atomicWrite(
    path.join(root, "target-diagnostics.sql"),
    [
      "SHOW server_version;",
      "SHOW shared_preload_libraries;",
      "",
      "SELECT name, default_version, installed_version",
      "FROM pg_available_extensions",
      "WHERE name = 'age';",
      "",
    ].join("\n"),
  );
  if (!jobDigest) {
    await atomicWrite(
      path.join(root, state.artifacts.discovery),
      [
        "# Discovery and Readiness Intake",
        "",
        `- Saved source profile reference: ${state.profiles.source}`,
        `- Saved target profile reference: ${state.profiles.target}`,
        `- Application repository: ${state.repository}`,
        "- AGEFreighter job: not attached",
        "- AGEFreighter assessment/load: blocked until a reviewed job is attached",
        "",
        "The runner stores references only. It does not resolve profile secrets or create migration mappings.",
        "",
      ].join("\n"),
    );
  }
  await renderDashboard(root, state);
  return state;
}

export async function attachReviewedJob({ workspace, job }) {
  const state = await readState(workspace);
  if (state.agefreighter.jobId) throw new Error("Cannot replace the job after an AGEFreighter job has started");
  const jobDigest = await copyReviewedJob(job, path.join(path.resolve(workspace), "job.yaml"));
  state.jobFile = "job.yaml";
  state.jobDigest = jobDigest;
  state.fingerprints.mapping = jobDigest;
  state.agefreighter.activeJobFile = "job.yaml";
  state.agefreighter.activeJobDigest = jobDigest;
  state.agefreighter.context = null;
  state.approvals.forEach((approval) => {
    approval.active = false;
  });
  state.readiness = { completed: false, outcome: "BLOCKED", evidenceDigest: null };
  state.pilot = { completed: false, accepted: false, evidenceDigest: null };
  state.checks = {
    "automated-core": { status: "not-run", evidence: null, owner: "runner" },
    "workload-acceptance": { status: "not-run", evidence: null },
    "production-hardening": { status: "not-run", evidence: null },
  };
  state.phase = "initialized";
  state.blockers = [];
  state.nextAction = "Approve the bounded access scope, then run assess.";
  appendHistory(state, "job-attached", { jobDigest });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return state;
}

export async function registerProposal({
  workspace,
  id,
  version,
  file,
  location,
  status = "pending",
}) {
  const state = await readState(workspace);
  const proposalId = requiredString(id, "proposal ID");
  const proposalVersion = Number(version);
  if (!Number.isInteger(proposalVersion) || proposalVersion < 1) throw new Error("proposal version must be a positive integer");
  const proposalFile = path.resolve(requiredString(file, "proposal file"));
  const proposalLocation = requiredString(location, "proposal location");
  const content = await readFile(proposalFile, "utf8");
  assertSanitized(content, "translation proposal");
  const ref = `${proposalId}@${proposalVersion}`;
  const existing = state.proposals[ref];
  const contentDigest = digest(content);
  if (existing && existing.contentDigest !== contentDigest) {
    throw new Error(`Translation proposal ${ref} is immutable; register a new version`);
  }
  state.proposals[ref] = {
    id: proposalId,
    version: proposalVersion,
    contentDigest,
    file: relativeArtifact(workspace, proposalFile),
    location: proposalLocation,
    status,
    registeredAt: existing?.registeredAt ?? now(),
  };
  appendHistory(state, "proposal-registered", { ref, contentDigest });
  await writeState(workspace, state);
  return state.proposals[ref];
}

export async function recordApproval({
  workspace,
  gate,
  scope,
  proposals = [],
  expiresAt = null,
}) {
  if (!APPROVAL_GATES.has(gate)) {
    throw new Error(`Approval gate must be one of: ${[...APPROVAL_GATES].join(", ")}`);
  }
  const state = await readState(workspace);
  const reviewedScope = requiredString(scope, "approval scope");
  const normalizedProposals = [...new Set(proposals.filter(Boolean))].sort();
  if (gate === "application-change") {
    if (!normalizedProposals.length) throw new Error("Application-change approval requires exact registered ID@VERSION proposals");
    for (const ref of normalizedProposals) {
      if (!PROPOSAL_REF_PATTERN.test(ref)) throw new Error(`Invalid proposal reference: ${ref}`);
      if (!state.proposals[ref]) throw new Error(`Translation proposal ${ref} is not registered`);
    }
  } else if (normalizedProposals.length) {
    throw new Error(`Proposal references are only valid for application-change approval`);
  }
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    throw new Error("approval expiry must be a future ISO timestamp");
  }
  assertSanitized({ reviewedScope, normalizedProposals }, "approval");
  const current = await currentBindingInputs(state, workspace);
  if (state.jobDigest && current.jobDigest !== state.jobDigest) {
    throw new Error("The reviewed job changed; use attach-job before recording approval");
  }
  const binding = bindingFor(state, gate, normalizedProposals, current);
  const approval = {
    id: randomUUID(),
    version: APPROVAL_VERSION,
    gate,
    operationScope: reviewedScope,
    scopeDigest: digest(reviewedScope),
    proposals: normalizedProposals,
    binding,
    bindingDigest: digest(JSON.stringify(binding)),
    approvedAt: now(),
    expiresAt,
    active: true,
  };
  state.approvals.push(approval);
  if (gate === "application-change") {
    for (const ref of normalizedProposals) state.proposals[ref].status = "approved";
  }
  appendHistory(state, "approval-recorded", { gate, approvalId: approval.id });
  state.nextAction = gate === "access-scope"
    ? "Run the bounded readiness assessment."
    : `Continue the approved ${gate} operation.`;
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return state;
}

function defaultRunner(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    executable,
    args,
    status: result.status ?? 1,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr || result.error?.message),
    truncated: Boolean(result.error?.code === "ENOBUFS"),
  };
}

function uniqueOutput(workspace, label, extension = "json") {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return path.join(path.resolve(workspace), "command-output", `${stamp}-${label}-${randomUUID()}.${extension}`);
}

function parseMachineOutcome(receipt, command, outputContent) {
  if (receipt.truncated) return { classification: "failure", outcome: "truncated", detail: "required evidence was truncated" };
  if (command.contract === "version") {
    const version = String(receipt.stdout ?? "").match(/\bv?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b/)?.[1];
    if (version && receipt.status === 0) {
      return {
        classification: "pass",
        outcome: "completed",
        detail: null,
        machine: { version, path: receipt.executable },
      };
    }
  }
  let machine = receipt.machineOutcome ?? null;
  if (!machine && outputContent) {
    try {
      machine = JSON.parse(outputContent);
    } catch {
      return { classification: "failure", outcome: "invalid", detail: "machine-readable output was invalid JSON" };
    }
  }
  if (!machine && receipt.stdout?.trim().startsWith("{")) {
    try {
      machine = JSON.parse(receipt.stdout);
    } catch {
      return { classification: "failure", outcome: "invalid", detail: "machine-readable stdout was invalid JSON" };
    }
  }
  if (!machine) {
    if (command.contract === "review") {
      return { classification: "review", outcome: "needs-review", detail: "command has no reliable machine contract" };
    }
    return { classification: "failure", outcome: "unavailable", detail: "required machine-readable evidence was unavailable" };
  }
  const raw = machine.outcome ?? machine.status ?? machine.result ?? machine.state;
  const outcome = String(raw ?? "").toLowerCase();
  const complete = machine.complete ?? machine.completed ?? !INCOMPLETE_OUTCOMES.has(outcome);
  if (machine.truncated || complete === false || INCOMPLETE_OUTCOMES.has(outcome)) {
    return { classification: "failure", outcome: outcome || "incomplete", detail: "required evidence was incomplete or unknown" };
  }
  if (FAILURE_OUTCOMES.has(outcome) || machine.success === false || machine.passed === false) {
    return { classification: "failure", outcome: outcome || "failed", detail: "machine-readable evidence reported failure" };
  }
  if (SUCCESS_OUTCOMES.has(outcome) || machine.success === true || machine.passed === true) {
    return { classification: "pass", outcome: outcome || "passed", detail: null, machine };
  }
  return { classification: "failure", outcome: outcome || "unknown", detail: "machine-readable outcome was unknown" };
}

async function runCommand(workspace, label, executable, args, runner, command = {}) {
  const receipt = (runner ?? defaultRunner)(executable, args, { cwd: path.resolve(workspace) });
  let outputContent = null;
  if (command.outputFile) {
    outputContent = await readFile(command.outputFile, "utf8").catch(() => null);
  }
  const evidence = parseMachineOutcome(receipt, command, outputContent);
  const logFile = uniqueOutput(workspace, label, "log");
  const log = [
    `command: ${executable} ${args.join(" ")}`,
    `exitCode: ${receipt.status}`,
    `evidenceClassification: ${evidence.classification}`,
    `evidenceOutcome: ${evidence.outcome}`,
    "",
    "[stdout]",
    receipt.stdout ?? "",
    "",
    "[stderr]",
    receipt.stderr ?? "",
    "",
  ].join("\n");
  await atomicWrite(logFile, redact(log));
  return { ...receipt, evidence, logFile: relativeArtifact(workspace, logFile) };
}

async function runSequence(workspace, state, commands, runner) {
  const receipts = [];
  for (const command of commands) {
    const receipt = await runCommand(workspace, command.label, command.executable, command.args, runner, command);
    receipts.push(receipt);
    state.agefreighter.lastCommand = `${command.executable} ${command.args.join(" ")}`;
    state.agefreighter.lastExitCode = receipt.status;
    appendHistory(state, "command-completed", {
      label: command.label,
      exitCode: receipt.status,
      evidence: receipt.evidence.classification,
      outcome: receipt.evidence.outcome,
      logFile: receipt.logFile,
    });
    const parsedJobId = command.args[0] === "load" ? parseJobId([receipt]) : null;
    if (parsedJobId) state.agefreighter.jobId = parsedJobId;
    await writeState(workspace, state);
    await renderDashboard(workspace, state);
    if (receipt.status !== 0 || receipt.evidence.classification === "failure") break;
  }
  return receipts;
}

function firstFailure(receipts) {
  return receipts.find((receipt) => receipt.status !== 0 || receipt.evidence.classification === "failure");
}

function hasReview(receipts) {
  return receipts.some((receipt) => receipt.evidence.classification === "review");
}

function parseJobId(receipts) {
  for (const receipt of [...receipts].reverse()) {
    const machineJobId = receipt.evidence?.machine?.jobId ?? receipt.machineOutcome?.jobId;
    if (machineJobId && JOB_ID_PATTERN.test(machineJobId)) return machineJobId;
    const match = `${receipt.stdout}\n${receipt.stderr}`.match(JOB_ID_PATTERN);
    if (match) return match[0];
  }
  return null;
}

function requireAttachedJob(state) {
  if (!state.jobFile || !state.jobDigest) {
    throw new Error("A reviewed job must be attached with attach-job before AGEFreighter assess or load");
  }
}

function commandsForAssessment(workspace, state, sampleSize, includeProfile) {
  const doctorOutput = uniqueOutput(workspace, "doctor");
  const commands = [
    { label: "version", executable: "agefreighter", args: ["version"], contract: "version" },
    { label: "validate", executable: "agefreighter", args: ["validate", state.jobFile], contract: "review" },
    { label: "plan", executable: "agefreighter", args: ["plan", state.jobFile], contract: "review" },
    { label: "inspect", executable: "agefreighter-tools", args: ["inspect", state.jobFile], contract: "review" },
    {
      label: "doctor",
      executable: "agefreighter",
      args: ["doctor", "--target", state.jobFile, "--format", "json", "--output", relativeArtifact(workspace, doctorOutput)],
      contract: "required",
      outputFile: doctorOutput,
    },
  ];
  if (includeProfile) {
    const profileOutput = uniqueOutput(workspace, "source-profile");
    commands.push({
      label: "profile",
      executable: "agefreighter",
      args: ["profile", "--sample-size", String(sampleSize), "--format", "json", "--output", relativeArtifact(workspace, profileOutput), state.jobFile],
      contract: "required",
      outputFile: profileOutput,
    });
  }
  return commands;
}

export async function assessMigration(workspace, { sampleSize = 25000, includeProfile = true, runner } = {}) {
  const state = await readState(workspace);
  requireAttachedJob(state);
  await requireApproval(state, "access-scope", workspace);
  state.phase = "readiness-assessment";
  state.status = "on-track";
  await writeState(workspace, state);
  const receipts = await runSequence(workspace, state, commandsForAssessment(workspace, state, sampleSize, includeProfile), runner);
  const versionEvidence = receipts.find((receipt) => receipt.args[0] === "version")?.evidence?.machine;
  if (versionEvidence?.version) {
    state.agefreighter.binary = {
      path: path.resolve(versionEvidence.path ?? "agefreighter"),
      version: versionEvidence.version,
    };
  }
  const failure = firstFailure(receipts);
  const readiness = failure ? "BLOCKED" : hasReview(receipts) ? "READY WITH REMEDIATION" : "READY";
  const evidenceDigest = digest(JSON.stringify(receipts.map((receipt) => ({
    command: receipt.args[0],
    exitCode: receipt.status,
    classification: receipt.evidence.classification,
    outcome: receipt.evidence.outcome,
  }))));
  state.readiness = {
    completed: !failure,
    outcome: readiness,
    evidenceDigest,
    assessedAt: now(),
  };
  state.status = failure ? "blocked" : readiness === "READY" ? "on-track" : "needs-attention";
  state.blockers = failure ? [`${failure.executable} evidence ${failure.evidence.outcome}; review ${failure.logFile}`] : [];
  state.nextAction = failure
    ? "Resolve failed, incomplete, unknown, unavailable, or truncated readiness evidence, then rerun assess."
    : "Review readiness and run an approved thin-slice pilot.";
  state.phase = "readiness-reviewed";
  const readinessText = [
    "# Neo4j Migration Readiness",
    "",
    `**Migration readiness:** ${readiness}`,
    `**AGEFreighter evidence:** ${failure ? "failed closed" : hasReview(receipts) ? "explicit outcomes passed; non-contract commands need review" : "explicit outcomes passed"}`,
    `**Critical blockers:** ${state.blockers.length ? state.blockers.join("; ") : "None from required machine evidence"}`,
    `**Next decision:** ${state.nextAction}`,
    "",
    "READY WITH REMEDIATION is used only when required machine evidence passed and additional commands lack a reliable machine contract.",
    "",
  ].join("\n");
  await atomicWrite(path.join(path.resolve(workspace), state.artifacts.readiness), readinessText);
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) throw new Error(`Readiness assessment failed closed; review ${failure.logFile}`);
  return { state, receipts, readiness };
}

async function loadJob(workspace, state, { jobFile, context, runner, suppliedJobId = null }) {
  state.agefreighter.context = context;
  state.agefreighter.activeJobFile = jobFile;
  state.agefreighter.activeJobDigest = digest(
    await readFile(path.join(path.resolve(workspace), jobFile), "utf8"),
  );
  await writeState(workspace, state);
  const receipts = await runSequence(workspace, state, [
    { label: `${context}-validate`, executable: "agefreighter", args: ["validate", jobFile], contract: "review" },
    { label: `${context}-plan`, executable: "agefreighter", args: ["plan", jobFile], contract: "review" },
    { label: `${context}-load`, executable: "agefreighter", args: ["load", jobFile], contract: "required" },
  ], runner);
  const failure = firstFailure(receipts);
  if (failure) {
    state.status = "blocked";
    state.blockers = [`${failure.executable} evidence ${failure.evidence.outcome}; review ${failure.logFile}`];
    state.nextAction = "Choose retry, reconfigure, abort, or rollback based on preserved state.";
    await writeState(workspace, state);
    await renderDashboard(workspace, state);
    throw new Error(`${context} load failed closed; review ${failure.logFile}`);
  }
  const jobId = suppliedJobId ?? parseJobId(receipts);
  if (!jobId) throw new Error(`${context} load did not return a machine-verifiable AGEFreighter job ID`);
  state.agefreighter.jobId = jobId;
  state.status = "on-track";
  state.nextAction = "Run status and verification.";
  appendHistory(state, "load-started", { context, jobIdPresent: true });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return { state, receipts, jobId };
}

export async function runPilot(workspace, { pilotJob, runner, jobId = null } = {}) {
  const state = await readState(workspace);
  requireAttachedJob(state);
  if (!state.readiness.completed || !["READY", "READY WITH REMEDIATION"].includes(state.readiness.outcome)) {
    throw new Error("Pilot requires completed, passing readiness evidence");
  }
  await requireApproval(state, "pilot-write", workspace);
  const pilotFile = path.join(path.resolve(workspace), "pilot-job.yaml");
  await copyReviewedJob(requiredString(pilotJob, "pilot job"), pilotFile);
  state.phase = "thin-slice-pilot";
  state.rollbackState = "pilot graph must be retained or safely removable";
  await writeState(workspace, state);
  return loadJob(workspace, state, { jobFile: "pilot-job.yaml", context: "pilot", runner, suppliedJobId: jobId });
}

export async function recordPilotEvidence({ workspace, outcome, evidence }) {
  if (!["accepted", "rejected"].includes(outcome)) throw new Error("pilot outcome must be accepted or rejected");
  const state = await readState(workspace);
  if (state.agefreighter.context !== "pilot" || !state.agefreighter.jobId) throw new Error("Pilot evidence requires a completed pilot load");
  const reviewedEvidence = requiredString(evidence, "pilot evidence");
  assertSanitized(reviewedEvidence, "pilot evidence");
  state.pilot = {
    completed: true,
    accepted: outcome === "accepted",
    evidence: reviewedEvidence,
    evidenceDigest: digest(reviewedEvidence),
    recordedAt: now(),
  };
  appendHistory(state, "pilot-evidence-recorded", { outcome });
  await writeState(workspace, state);
  return state;
}

export async function runProductionLoad(workspace, { runner, jobId = null } = {}) {
  const state = await readState(workspace);
  requireAttachedJob(state);
  if (!state.readiness.completed || !["READY", "READY WITH REMEDIATION"].includes(state.readiness.outcome)) {
    throw new Error("Production load requires completed, passing readiness evidence");
  }
  if (!state.pilot.completed || !state.pilot.accepted) {
    throw new Error("Production load requires accepted pilot evidence");
  }
  await requireApproval(state, "production-write", workspace);
  state.phase = "production-load";
  state.rollbackState = "pending retained-backup evidence";
  await writeState(workspace, state);
  return loadJob(workspace, state, { jobFile: state.jobFile, context: "production", runner, suppliedJobId: jobId });
}

function requireJobId(state, suppliedJobId) {
  const jobId = suppliedJobId ?? state.agefreighter.jobId;
  if (!jobId) throw new Error("AGEFreighter job ID is required");
  return jobId;
}

export async function inspectStatus(workspace, { runner, jobId = null } = {}) {
  const state = await readState(workspace);
  const resolvedJobId = requireJobId(state, jobId);
  const receipts = await runSequence(workspace, state, [{
    label: "status",
    executable: "agefreighter",
    args: ["status", "--target", state.agefreighter.activeJobFile, resolvedJobId],
    contract: "required",
  }], runner);
  const failure = firstFailure(receipts);
  state.agefreighter.jobId = resolvedJobId;
  state.status = failure ? "blocked" : "on-track";
  state.nextAction = failure ? "Review status evidence before deciding whether resume is safe." : "Continue monitoring or verify after completion.";
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) throw new Error(`Status failed closed; review ${failure.logFile}`);
  return { state, receipts };
}

export async function resumeMigration(workspace, { runner, jobId = null, binaryPath = null, binaryVersion = null } = {}) {
  const state = await readState(workspace);
  const gate = state.agefreighter.context === "pilot" ? "pilot-write" : "production-write";
  await requireApproval(state, gate, workspace);
  const currentJobDigest = digest(await readFile(path.join(path.resolve(workspace), state.agefreighter.activeJobFile), "utf8"));
  const expectedDigest = state.agefreighter.activeJobDigest;
  if (currentJobDigest !== expectedDigest) throw new Error("Resume refused because the stored job fingerprint changed");
  const currentRepository = await pathFingerprint(state.repository);
  if (currentRepository !== state.fingerprints.repository) throw new Error("Resume refused because the repository fingerprint changed");
  if (state.agefreighter.binary?.path && binaryPath && path.resolve(binaryPath) !== state.agefreighter.binary.path) {
    throw new Error("Resume refused because the AGEFreighter binary path changed");
  }
  if (state.agefreighter.binary?.version && binaryVersion && binaryVersion !== state.agefreighter.binary.version) {
    throw new Error("Resume refused because the AGEFreighter binary version changed");
  }
  const resolvedJobId = requireJobId(state, jobId);
  const receipts = await runSequence(workspace, state, [{
    label: "resume",
    executable: binaryPath ?? "agefreighter",
    args: ["resume", "--job", state.agefreighter.activeJobFile, resolvedJobId],
    contract: "required",
  }], runner);
  const failure = firstFailure(receipts);
  state.status = failure ? "blocked" : "on-track";
  state.nextAction = failure ? "Recheck fingerprints before another resume attempt." : "Monitor status and verify the resumed job.";
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) throw new Error(`Resume failed closed; review ${failure.logFile}`);
  return { state, receipts };
}

export async function verifyMigration(workspace, { runner, jobId = null } = {}) {
  const state = await readState(workspace);
  if (state.agefreighter.context !== "production") throw new Error("Automated core verification requires a production load");
  const resolvedJobId = requireJobId(state, jobId);
  state.phase = "verification";
  const reportOutput = uniqueOutput(workspace, "report", "json");
  const receipts = await runSequence(workspace, state, [
    {
      label: "verify",
      executable: "agefreighter",
      args: ["verify", "--target", state.agefreighter.activeJobFile, "--counts", "--integrity", "--limit", "100", resolvedJobId],
      contract: "required",
    },
    {
      label: "report",
      executable: "agefreighter",
      args: ["report", "--target", state.agefreighter.activeJobFile, "--format", "json", "--output", relativeArtifact(workspace, reportOutput), resolvedJobId],
      contract: "required",
      outputFile: reportOutput,
    },
  ], runner);
  const failure = firstFailure(receipts);
  state.checks["automated-core"] = {
    status: failure ? "fail" : "pass",
    evidence: failure ? failure.logFile : relativeArtifact(workspace, reportOutput),
    evidenceDigest: digest(JSON.stringify(receipts.map((receipt) => receipt.evidence))),
    owner: "runner",
    recordedAt: now(),
  };
  state.goNoGo = { decision: null, digest: null };
  state.status = failure ? "blocked" : "needs-attention";
  state.nextAction = failure
    ? "Resolve automated verification failures before go/no-go."
    : "Record workload acceptance, production hardening, and rollback evidence.";
  await atomicWrite(path.join(path.resolve(workspace), state.artifacts.verification), [
    "# Migration Verification",
    "",
    `- Automated core: ${state.checks["automated-core"].status}`,
    `- Workload acceptance: ${state.checks["workload-acceptance"].status}`,
    `- Production hardening: ${state.checks["production-hardening"].status}`,
    "",
  ].join("\n"));
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) throw new Error(`Verification failed closed; review ${failure.logFile}`);
  return { state, receipts };
}

export async function recordCheck({ workspace, layer, status, evidence }) {
  if (!CHECK_LAYERS.has(layer)) throw new Error(`Check layer must be one of: ${[...CHECK_LAYERS].join(", ")}`);
  if (!USER_CHECK_LAYERS.has(layer)) throw new Error("automated-core is runner-owned and cannot be overwritten through record-check");
  if (!CHECK_STATUSES.has(status)) throw new Error(`Check status must be one of: ${[...CHECK_STATUSES].join(", ")}`);
  const state = await readState(workspace);
  const reviewedEvidence = requiredString(evidence, "evidence");
  assertSanitized(reviewedEvidence, "check evidence");
  state.checks[layer] = {
    status,
    evidence: reviewedEvidence,
    evidenceDigest: digest(reviewedEvidence),
    recordedAt: now(),
  };
  state.goNoGo = { decision: null, digest: null };
  appendHistory(state, "check-recorded", { layer, status });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return state;
}

export async function recordRollbackEvidence({ workspace, evidence }) {
  const state = await readState(workspace);
  const reviewedEvidence = requiredString(evidence, "rollback evidence");
  assertSanitized(reviewedEvidence, "rollback evidence");
  state.rollback = {
    evidence: reviewedEvidence,
    evidenceDigest: digest(reviewedEvidence),
    recordedAt: now(),
  };
  state.rollbackState = "evidence recorded and available for cutover review";
  await writeState(workspace, state);
  return state;
}

export function determineGoNoGo(checks) {
  const statuses = [...CHECK_LAYERS].map((layer) => checks[layer]?.status ?? "unknown");
  if (statuses.some((status) => ["fail", "not-run", "unknown"].includes(status))) return "NO-GO";
  if (statuses.some((status) => status === "approved-exception")) return "CONDITIONAL GO";
  return "GO";
}

export async function generateGoNoGo(workspace) {
  const state = await readState(workspace);
  const decision = determineGoNoGo(state.checks);
  state.phase = "go-no-go";
  state.status = decision === "NO-GO" ? "blocked" : "needs-attention";
  state.nextAction = decision === "GO"
    ? "Generate the runbook, record rollback evidence, then obtain current cutover approval."
    : "Resolve exceptions or missing evidence before cutover.";
  const report = [
    "# Cutover Go/No-Go",
    "",
    `**Cutover recommendation:** ${decision}`,
    `**Automated core:** ${state.checks["automated-core"].status}`,
    `**Workload acceptance:** ${state.checks["workload-acceptance"].status}`,
    `**Production hardening:** ${state.checks["production-hardening"].status}`,
    "",
  ].join("\n");
  await atomicWrite(path.join(path.resolve(workspace), "go-no-go.md"), report);
  state.goNoGo = { decision, digest: digest(report), generatedAt: now() };
  appendHistory(state, "go-no-go-generated", { decision });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return { state, decision };
}

export async function generateCutoverRunbook({ workspace, rpo, rto, downtime, strategy, trafficSwitch, rollbackWindow }) {
  const state = await readState(workspace);
  const inputs = {
    rpo: requiredString(rpo, "RPO"),
    rto: requiredString(rto, "RTO"),
    downtime: requiredString(downtime, "downtime"),
    strategy: requiredString(strategy, "source-change strategy"),
    trafficSwitch: requiredString(trafficSwitch, "traffic switch"),
    rollbackWindow: requiredString(rollbackWindow, "rollback window"),
  };
  assertSanitized(inputs, "cutover inputs");
  const runbook = [
    "# Neo4j Migration Cutover and Rollback Runbook",
    "",
    `- RPO: ${inputs.rpo}`,
    `- RTO: ${inputs.rto}`,
    `- Accepted downtime: ${inputs.downtime}`,
    `- Source-change strategy: ${inputs.strategy}`,
    `- Traffic switch: ${inputs.trafficSwitch}`,
    `- Rollback window: ${inputs.rollbackWindow}`,
    "",
    "## T-30 minutes",
    "- Fence source writes, run the approved final delta, verify, and review GO evidence.",
    "",
    "## T0",
    `- Switch application traffic using: ${inputs.trafficSwitch}`,
    "- Run critical smoke tests and verify transaction behavior.",
    "",
    "## Rollback",
    "- Restore the approved traffic path and activate retained rollback state.",
    "",
    "## Cleanup",
    `- Observe through the ${inputs.rollbackWindow} rollback window before requesting cleanup.`,
    "",
  ].join("\n");
  await atomicWrite(path.join(path.resolve(workspace), state.artifacts.cutover), runbook);
  state.cutover.runbookDigest = digest(runbook);
  state.cutover.rollbackWindow = inputs.rollbackWindow;
  state.phase = "cutover-planning";
  appendHistory(state, "cutover-runbook-generated", { inputDigest: digest(JSON.stringify(inputs)) });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return state;
}

export async function recordCutover({ workspace, outcome, evidence }) {
  if (!new Set(["completed", "rolled-back", "failed"]).has(outcome)) {
    throw new Error("Cutover outcome must be completed, rolled-back, or failed");
  }
  const state = await readState(workspace);
  if (state.goNoGo.decision !== "GO" || !state.goNoGo.digest) throw new Error("Cutover completion requires a current GO decision");
  if (!state.cutover.runbookDigest) throw new Error("Cutover completion requires a generated runbook");
  if (!state.rollback.evidenceDigest) throw new Error("Cutover completion requires rollback evidence");
  const approval = await requireApproval(state, "cutover", workspace);
  const reviewedEvidence = requiredString(evidence, "cutover evidence");
  assertSanitized(reviewedEvidence, "cutover evidence");
  state.cutover.outcome = outcome;
  state.cutover.evidenceDigest = digest(reviewedEvidence);
  state.cutover.approvalId = approval.id;
  state.phase = outcome === "completed" ? "observation-window" : `cutover-${outcome}`;
  state.status = outcome === "completed" ? "on-track" : "blocked";
  state.rollbackState = outcome === "completed" ? "available through the approved rollback window" : "rollback decision recorded";
  appendHistory(state, "cutover-recorded", { outcome, evidenceDigest: state.cutover.evidenceDigest });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return state;
}

export async function recordObservation({ workspace, evidence, rollbackWindowSatisfied }) {
  const state = await readState(workspace);
  if (state.cutover.outcome !== "completed") throw new Error("Observation evidence requires completed cutover");
  if (rollbackWindowSatisfied !== true) throw new Error("Cleanup requires explicit rollback-window satisfaction");
  const reviewedEvidence = requiredString(evidence, "observation evidence");
  assertSanitized(reviewedEvidence, "observation evidence");
  state.observation = {
    accepted: true,
    evidence: reviewedEvidence,
    evidenceDigest: digest(reviewedEvidence),
    rollbackWindowSatisfiedAt: now(),
  };
  await writeState(workspace, state);
  return state;
}

export async function cleanupMigration(workspace, { runner, jobId = null } = {}) {
  const state = await readState(workspace);
  if (state.cutover.outcome !== "completed") throw new Error("Cleanup requires completed cutover");
  if (!state.observation.accepted || !state.observation.evidenceDigest) throw new Error("Cleanup requires observation and acceptance evidence");
  if (!state.observation.rollbackWindowSatisfiedAt) throw new Error("Cleanup requires rollback-window satisfaction");
  await requireApproval(state, "cleanup", workspace);
  const resolvedJobId = requireJobId(state, jobId);
  const receipts = await runSequence(workspace, state, [{
    label: "cleanup",
    executable: "agefreighter",
    args: ["cleanup", "--target", state.agefreighter.activeJobFile, resolvedJobId],
    contract: "required",
  }], runner);
  const failure = firstFailure(receipts);
  state.status = failure ? "blocked" : "on-track";
  state.phase = failure ? "cleanup-failed" : "completed";
  state.rollbackState = failure ? state.rollbackState : "expired and cleaned up";
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) throw new Error(`Cleanup failed closed; review ${failure.logFile}`);
  return { state, receipts };
}

export async function renderDashboard(workspace, suppliedState = null) {
  const state = suppliedState ?? await readState(workspace);
  const dashboard = [
    "# Neo4j Migration Status",
    "",
    `- Migration status: ${state.status}`,
    `- Phase: ${state.phase}`,
    `- AGEFreighter job ID: ${state.agefreighter.jobId ?? "not recorded"}`,
    `- Readiness: ${state.readiness.outcome}`,
    `- Pilot accepted: ${state.pilot.accepted}`,
    `- Automated core: ${state.checks["automated-core"].status}`,
    `- Workload acceptance: ${state.checks["workload-acceptance"].status}`,
    `- Production hardening: ${state.checks["production-hardening"].status}`,
    `- Blockers/unknowns: ${state.blockers.length ? state.blockers.join("; ") : "none recorded"}`,
    `- Next recommended action: ${state.nextAction}`,
    `- Approval needed: ${nextApproval(state)}`,
    `- Resume: ${resumeText(state)}`,
    `- Rollback state: ${state.rollbackState}`,
    "",
  ].join("\n");
  await atomicWrite(path.join(path.resolve(workspace), state.artifacts.dashboard), dashboard);
  return dashboard;
}

function nextApproval(state) {
  if (!approvalFor(state, "access-scope")) return "access-scope";
  if (state.readiness.completed && !approvalFor(state, "pilot-write")) return "pilot-write";
  if (state.pilot.accepted && !approvalFor(state, "production-write")) return "production-write";
  if (state.goNoGo.decision === "GO" && !approvalFor(state, "cutover")) return "cutover";
  if (state.observation.accepted && !approvalFor(state, "cleanup")) return "cleanup";
  return "none currently";
}

function resumeText(state) {
  if (!state.agefreighter.jobId) return "no active AGEFreighter job";
  return `neo4j-migration-runner resume --workspace <workspace> --job-id ${state.agefreighter.jobId}`;
}

function parseOptions(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (["no-profile", "rollback-window-satisfied"].includes(key)) {
      options[key.replaceAll("-", "_")] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    options[key.replaceAll("-", "_")] = value;
    index += 1;
  }
  return { command, options };
}

function proposalList(value) {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function usage() {
  return `Usage:
  neo4j-migration-runner init --workspace PATH --name NAME [--job JOB | --source-profile REF --target-profile REF --repository PATH]
  neo4j-migration-runner attach-job --workspace PATH --job JOB
  neo4j-migration-runner register-proposal --workspace PATH --id ID --version N --file FILE --location SCOPE
  neo4j-migration-runner approve --workspace PATH --gate GATE --scope TEXT [--proposals ID@VERSION,...] [--expires-at ISO]
  neo4j-migration-runner assess --workspace PATH [--sample-size N] [--no-profile]
  neo4j-migration-runner pilot --workspace PATH --pilot-job JOB [--job-id ID]
  neo4j-migration-runner record-pilot --workspace PATH --outcome accepted|rejected --evidence TEXT
  neo4j-migration-runner load --workspace PATH [--job-id ID]
  neo4j-migration-runner status|resume|verify --workspace PATH [--job-id ID]
  neo4j-migration-runner record-check --workspace PATH --layer LAYER --status STATUS --evidence TEXT
  neo4j-migration-runner record-rollback --workspace PATH --evidence TEXT
  neo4j-migration-runner go-no-go --workspace PATH
  neo4j-migration-runner cutover-plan --workspace PATH --rpo TEXT --rto TEXT --downtime TEXT --strategy TEXT --traffic-switch TEXT --rollback-window TEXT
  neo4j-migration-runner record-cutover --workspace PATH --outcome completed|rolled-back|failed --evidence TEXT
  neo4j-migration-runner record-observation --workspace PATH --evidence TEXT --rollback-window-satisfied
  neo4j-migration-runner cleanup|dashboard --workspace PATH`;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseOptions(argv);
  const workspace = options.workspace;
  switch (command) {
    case "init":
      return initializeMigration({
        workspace,
        name: options.name,
        job: options.job,
        sourceProfile: options.source_profile,
        targetProfile: options.target_profile,
        repository: options.repository,
        mode: options.mode ?? "standard",
      });
    case "attach-job":
      return attachReviewedJob({ workspace, job: options.job });
    case "register-proposal":
      return registerProposal({
        workspace,
        id: options.id,
        version: options.version,
        file: options.file,
        location: options.location,
        status: options.status ?? "pending",
      });
    case "approve":
      return recordApproval({
        workspace,
        gate: options.gate,
        scope: options.scope,
        proposals: proposalList(options.proposals),
        expiresAt: options.expires_at ?? null,
      });
    case "assess":
      return assessMigration(workspace, { sampleSize: Number(options.sample_size ?? 25000), includeProfile: !options.no_profile });
    case "pilot":
      return runPilot(workspace, { pilotJob: options.pilot_job, jobId: options.job_id });
    case "record-pilot":
      return recordPilotEvidence({ workspace, outcome: options.outcome, evidence: options.evidence });
    case "load":
      return runProductionLoad(workspace, { jobId: options.job_id });
    case "status":
      return inspectStatus(workspace, { jobId: options.job_id });
    case "resume":
      return resumeMigration(workspace, {
        jobId: options.job_id,
        binaryPath: options.binary_path,
        binaryVersion: options.binary_version,
      });
    case "verify":
      return verifyMigration(workspace, { jobId: options.job_id });
    case "record-check":
      return recordCheck({ workspace, layer: options.layer, status: options.status, evidence: options.evidence });
    case "record-rollback":
      return recordRollbackEvidence({ workspace, evidence: options.evidence });
    case "go-no-go":
      return generateGoNoGo(workspace);
    case "cutover-plan":
      return generateCutoverRunbook({
        workspace,
        rpo: options.rpo,
        rto: options.rto,
        downtime: options.downtime,
        strategy: options.strategy,
        trafficSwitch: options.traffic_switch,
        rollbackWindow: options.rollback_window,
      });
    case "record-cutover":
      return recordCutover({ workspace, outcome: options.outcome, evidence: options.evidence });
    case "record-observation":
      return recordObservation({
        workspace,
        evidence: options.evidence,
        rollbackWindowSatisfied: options.rollback_window_satisfied === true,
      });
    case "cleanup":
      return cleanupMigration(workspace, { jobId: options.job_id });
    case "dashboard":
      return renderDashboard(workspace);
    default:
      throw new Error(usage());
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then((result) => {
      if (typeof result === "string") process.stdout.write(result);
      else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${redact(error.message)}\n`);
      process.exitCode = 1;
    });
}
