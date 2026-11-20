import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
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
const CHECK_STATUSES = new Set([
  "pass",
  "fail",
  "approved-exception",
  "not-run",
  "unknown",
]);
const CONNECTION_PATTERN =
  /(?:neo4j(?:\+s|\+ssc)?:\/\/|postgres(?:ql)?:\/\/)[^/\s:@]+:[^@\s]+@[^\s"'`]+/gi;
const SECRET_PATTERN =
  /\b(password|passwd|pwd|secret|token|api[_-]?key)[ \t]*[:=][ \t]*([^\s,;]+)/gi;
const JOB_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

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
    throw new Error(`${label} must not contain credentials or connection strings`);
  }
  CONNECTION_PATTERN.lastIndex = 0;
  SECRET_PATTERN.lastIndex = 0;
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

async function atomicWrite(file, content) {
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
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function stateFile(workspace) {
  return path.join(path.resolve(workspace), "migration-state.yaml");
}

async function readState(workspace) {
  const file = stateFile(workspace);
  const state = JSON.parse(await readFile(file, "utf8"));
  if (state.schemaVersion !== 1) {
    throw new Error(`Unsupported migration state schema: ${state.schemaVersion}`);
  }
  return state;
}

async function writeState(workspace, state) {
  state.updatedAt = now();
  state.history = (state.history ?? []).slice(-199);
  assertSanitized(state, "migration state");
  await atomicWrite(stateFile(workspace), `${JSON.stringify(state, null, 2)}\n`);
}

function appendHistory(state, event, detail = {}) {
  assertSanitized(detail, "history detail");
  state.history ??= [];
  state.history.push({ at: now(), event, ...detail });
}

function approvalFor(state, gate) {
  return [...(state.approvals ?? [])]
    .reverse()
    .find((approval) => approval.gate === gate && approval.active);
}

function requireApproval(state, gate) {
  const approval = approvalFor(state, gate);
  if (!approval) {
    throw new Error(
      `Approval gate "${gate}" is required. Record the reviewed scope with the approve command.`,
    );
  }
  return approval;
}

function relativeArtifact(workspace, file) {
  return path.relative(path.resolve(workspace), file).replaceAll("\\", "/");
}

async function copyReviewedJob(source, destination) {
  const sourcePath = path.resolve(requiredString(source, "job file"));
  await rejectSymlink(sourcePath);
  const content = await readFile(sourcePath, "utf8");
  assertSanitized(content, "job file");
  await copyFile(sourcePath, destination);
  await chmod(destination, 0o600).catch(() => {});
  return digest(content);
}

export async function initializeMigration({
  workspace,
  name,
  job,
  mode = "standard",
}) {
  const root = path.resolve(requiredString(workspace, "workspace"));
  const migrationName = requiredString(name, "migration name");
  if (!INTERACTION_MODES.has(mode)) {
    throw new Error(`Interaction mode must be one of: ${[...INTERACTION_MODES].join(", ")}`);
  }
  await rejectSymlink(root, true);
  await mkdir(root, { recursive: true });
  await rejectSymlink(root);
  for (const directory of ["logs", "translations"]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  const reviewedJob = path.join(root, "job.yaml");
  const jobDigest = await copyReviewedJob(job, reviewedJob);
  const createdAt = now();
  const state = {
    schemaVersion: 1,
    migrationName,
    interactionMode: mode,
    phase: "initialized",
    status: "needs-attention",
    createdAt,
    updatedAt: createdAt,
    jobFile: "job.yaml",
    jobDigest,
    agefreighter: {
      jobId: null,
      context: null,
      activeJobFile: "job.yaml",
      lastCommand: null,
      lastExitCode: null,
    },
    approvals: [],
    checks: {
      "automated-core": { status: "not-run", evidence: null },
      "workload-acceptance": { status: "not-run", evidence: null },
      "production-hardening": { status: "not-run", evidence: null },
    },
    artifacts: {
      readiness: "readiness.md",
      dashboard: "migration-status.md",
      verification: "verification.md",
      cutover: "cutover-runbook.md",
      report: "migration-report.md",
    },
    blockers: [],
    nextAction: "Approve the bounded access scope, then run assess.",
    rollbackState: "not yet created",
    history: [{ at: createdAt, event: "initialized", jobDigest }],
  };
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
  await renderDashboard(root, state);
  return state;
}

export async function recordApproval({
  workspace,
  gate,
  scope,
  proposals = [],
}) {
  if (!APPROVAL_GATES.has(gate)) {
    throw new Error(`Approval gate must be one of: ${[...APPROVAL_GATES].join(", ")}`);
  }
  const state = await readState(workspace);
  const reviewedScope = requiredString(scope, "approval scope");
  const normalizedProposals = [...new Set(proposals.filter(Boolean))].sort();
  assertSanitized({ reviewedScope, normalizedProposals }, "approval");
  state.approvals.push({
    id: randomUUID(),
    gate,
    scope: reviewedScope,
    scopeDigest: digest(JSON.stringify([gate, reviewedScope, normalizedProposals])),
    proposals: normalizedProposals,
    approvedAt: now(),
    active: true,
  });
  appendHistory(state, "approval-recorded", {
    gate,
    proposalCount: normalizedProposals.length,
  });
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
  });
  return {
    executable,
    args,
    status: result.status ?? 1,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr || result.error?.message),
  };
}

async function runCommand(workspace, label, executable, args, runner) {
  const receipt = (runner ?? defaultRunner)(executable, args, {
    cwd: path.resolve(workspace),
  });
  const logFile = path.join(
    path.resolve(workspace),
    "logs",
    `${new Date().toISOString().replaceAll(":", "-")}-${label}.log`,
  );
  const log = [
    `command: ${executable} ${args.join(" ")}`,
    `exitCode: ${receipt.status}`,
    "",
    "[stdout]",
    receipt.stdout ?? "",
    "",
    "[stderr]",
    receipt.stderr ?? "",
    "",
  ].join("\n");
  await atomicWrite(logFile, redact(log));
  return {
    ...receipt,
    logFile: relativeArtifact(workspace, logFile),
  };
}

async function runSequence(workspace, state, commands, runner) {
  const receipts = [];
  for (const command of commands) {
    const receipt = await runCommand(
      workspace,
      command.label,
      command.executable,
      command.args,
      runner,
    );
    receipts.push(receipt);
    state.agefreighter.lastCommand = `${command.executable} ${command.args.join(" ")}`;
    state.agefreighter.lastExitCode = receipt.status;
    appendHistory(state, "command-completed", {
      label: command.label,
      exitCode: receipt.status,
      logFile: receipt.logFile,
    });
    const parsedJobId = command.args[0] === "load" ? parseJobId([receipt]) : null;
    if (parsedJobId) state.agefreighter.jobId = parsedJobId;
    await writeState(workspace, state);
    await renderDashboard(workspace, state);
    if (receipt.status !== 0) break;
  }
  return receipts;
}

function firstFailure(receipts) {
  return receipts.find((receipt) => receipt.status !== 0);
}

function parseJobId(receipts) {
  for (const receipt of [...receipts].reverse()) {
    const match = `${receipt.stdout}\n${receipt.stderr}`.match(JOB_ID_PATTERN);
    if (match) return match[0];
  }
  return null;
}

function commandsForAssessment(state, sampleSize, includeProfile) {
  const commands = [
    { label: "version", executable: "agefreighter", args: ["version"] },
    { label: "validate", executable: "agefreighter", args: ["validate", state.jobFile] },
    { label: "plan", executable: "agefreighter", args: ["plan", state.jobFile] },
    {
      label: "inspect",
      executable: "agefreighter-tools",
      args: ["inspect", state.jobFile],
    },
    {
      label: "doctor",
      executable: "agefreighter",
      args: [
        "doctor",
        "--target",
        state.jobFile,
        "--format",
        "markdown",
        "--output",
        "doctor.md",
      ],
    },
  ];
  if (includeProfile) {
    commands.push({
      label: "profile",
      executable: "agefreighter",
      args: [
        "profile",
        "--sample-size",
        String(sampleSize),
        "--format",
        "markdown",
        "--output",
        "source-profile.md",
        state.jobFile,
      ],
    });
  }
  return commands;
}

export async function assessMigration(
  workspace,
  { sampleSize = 25000, includeProfile = true, runner } = {},
) {
  const state = await readState(workspace);
  requireApproval(state, "access-scope");
  state.phase = "readiness-assessment";
  state.status = "on-track";
  state.nextAction = "Run compatibility, target, and bounded source checks.";
  await writeState(workspace, state);
  const receipts = await runSequence(
    workspace,
    state,
    commandsForAssessment(state, sampleSize, includeProfile),
    runner,
  );
  const failure = firstFailure(receipts);
  const readiness = failure ? "BLOCKED" : "READY WITH REMEDIATION";
  state.status = failure ? "blocked" : "needs-attention";
  state.blockers = failure
    ? [`${failure.executable} failed; review ${failure.logFile}`]
    : [];
  state.nextAction = failure
    ? "Resolve the failed readiness check, then rerun assess."
    : "Review the readiness card, application discovery, and proposed thin-slice pilot.";
  state.phase = "readiness-reviewed";
  const readinessText = [
    "# Neo4j Migration Readiness",
    "",
    `**Migration readiness:** ${readiness}`,
    `**Interaction mode:** ${state.interactionMode}`,
    `**AGEFreighter checks:** ${failure ? "failed" : "passed"}`,
    `**Bounded source profile:** ${includeProfile ? "requested" : "not run"}`,
    `**Critical blockers:** ${state.blockers.length ? state.blockers.join("; ") : "None from automated checks"}`,
    "**Application discovery:** Required before production qualification",
    "**Recommended pilot:** Representative labels, relationships, critical queries, and one application connection path",
    `**Next decision:** ${state.nextAction}`,
    "",
    "This automated assessment does not by itself qualify production scale or application compatibility.",
    "",
  ].join("\n");
  await atomicWrite(path.join(path.resolve(workspace), state.artifacts.readiness), readinessText);
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) {
    throw new Error(`Readiness assessment failed; review ${failure.logFile}`);
  }
  return { state, receipts, readiness };
}

async function loadJob(
  workspace,
  state,
  { jobFile, context, runner, suppliedJobId = null },
) {
  state.agefreighter.context = context;
  state.agefreighter.activeJobFile = jobFile;
  await writeState(workspace, state);
  const receipts = await runSequence(
    workspace,
    state,
    [
      { label: `${context}-validate`, executable: "agefreighter", args: ["validate", jobFile] },
      { label: `${context}-plan`, executable: "agefreighter", args: ["plan", jobFile] },
      { label: `${context}-load`, executable: "agefreighter", args: ["load", jobFile] },
    ],
    runner,
  );
  const failure = firstFailure(receipts);
  if (failure) {
    state.status = "blocked";
    state.blockers = [`${failure.executable} failed; review ${failure.logFile}`];
    state.nextAction = "Choose retry, reconfigure, abort, or rollback based on preserved state.";
    await writeState(workspace, state);
    await renderDashboard(workspace, state);
    throw new Error(`${context} load failed; review ${failure.logFile}`);
  }
  const jobId = suppliedJobId ?? parseJobId(receipts);
  state.agefreighter.jobId = jobId;
  state.status = jobId ? "on-track" : "needs-attention";
  state.nextAction = jobId
    ? "Run status and verification."
    : "Record the AGEFreighter job ID, then run status.";
  appendHistory(state, "load-started", { context, jobIdPresent: Boolean(jobId) });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return { state, receipts, jobId };
}

export async function runPilot(
  workspace,
  { pilotJob, runner, jobId = null } = {},
) {
  const state = await readState(workspace);
  requireApproval(state, "pilot-write");
  const pilotFile = path.join(path.resolve(workspace), "pilot-job.yaml");
  await copyReviewedJob(requiredString(pilotJob, "pilot job"), pilotFile);
  state.phase = "thin-slice-pilot";
  state.rollbackState = "pilot graph must be retained or safely removable";
  await writeState(workspace, state);
  return loadJob(workspace, state, {
    jobFile: "pilot-job.yaml",
    context: "pilot",
    runner,
    suppliedJobId: jobId,
  });
}

export async function runProductionLoad(workspace, { runner, jobId = null } = {}) {
  const state = await readState(workspace);
  requireApproval(state, "production-write");
  state.phase = "production-load";
  state.rollbackState = "pending AGEFreighter retained backup evidence";
  await writeState(workspace, state);
  return loadJob(workspace, state, {
    jobFile: state.jobFile,
    context: "production",
    runner,
    suppliedJobId: jobId,
  });
}

function requireJobId(state, suppliedJobId) {
  const jobId = suppliedJobId ?? state.agefreighter.jobId;
  if (!jobId) {
    throw new Error("AGEFreighter job ID is required");
  }
  return jobId;
}

export async function inspectStatus(workspace, { runner, jobId = null } = {}) {
  const state = await readState(workspace);
  const resolvedJobId = requireJobId(state, jobId);
  const receipts = await runSequence(
    workspace,
    state,
    [{
      label: "status",
      executable: "agefreighter",
      args: ["status", "--target", state.agefreighter.activeJobFile, resolvedJobId],
    }],
    runner,
  );
  const failure = firstFailure(receipts);
  state.agefreighter.jobId = resolvedJobId;
  state.status = failure ? "needs-attention" : "on-track";
  state.nextAction = failure
    ? "Review status evidence before deciding whether resume is safe."
    : "Continue monitoring or run verification when loading completes.";
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) throw new Error(`Status failed; review ${failure.logFile}`);
  return { state, receipts };
}

export async function resumeMigration(workspace, { runner, jobId = null } = {}) {
  const state = await readState(workspace);
  const gate = state.agefreighter.context === "pilot" ? "pilot-write" : "production-write";
  requireApproval(state, gate);
  const resolvedJobId = requireJobId(state, jobId);
  const receipts = await runSequence(
    workspace,
    state,
    [{
      label: "resume",
      executable: "agefreighter",
      args: ["resume", "--job", state.agefreighter.activeJobFile, resolvedJobId],
    }],
    runner,
  );
  const failure = firstFailure(receipts);
  state.status = failure ? "blocked" : "on-track";
  state.nextAction = failure
    ? "Recheck source and configuration fingerprints before another resume attempt."
    : "Monitor status and verify the resumed job.";
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) throw new Error(`Resume failed; review ${failure.logFile}`);
  return { state, receipts };
}

export async function verifyMigration(workspace, { runner, jobId = null } = {}) {
  const state = await readState(workspace);
  const resolvedJobId = requireJobId(state, jobId);
  state.phase = "verification";
  const receipts = await runSequence(
    workspace,
    state,
    [
      {
        label: "verify",
        executable: "agefreighter",
        args: [
          "verify",
          "--target",
          state.agefreighter.activeJobFile,
          "--counts",
          "--integrity",
          "--limit",
          "100",
          resolvedJobId,
        ],
      },
      {
        label: "report",
        executable: "agefreighter",
        args: [
          "report",
          "--target",
          state.agefreighter.activeJobFile,
          "--format",
          "markdown",
          "--output",
          state.artifacts.report,
          resolvedJobId,
        ],
      },
    ],
    runner,
  );
  const failure = firstFailure(receipts);
  state.checks["automated-core"] = {
    status: failure ? "fail" : "pass",
    evidence: failure ? failure.logFile : state.artifacts.report,
  };
  state.status = failure ? "blocked" : "needs-attention";
  state.nextAction = failure
    ? "Resolve automated verification failures before go/no-go."
    : "Record workload-acceptance and production-hardening evidence, then run go-no-go.";
  const verification = [
    "# Migration Verification",
    "",
    `- Automated core: ${state.checks["automated-core"].status}`,
    `- Workload acceptance: ${state.checks["workload-acceptance"].status}`,
    `- Production hardening: ${state.checks["production-hardening"].status}`,
    `- AGEFreighter evidence: ${state.checks["automated-core"].evidence}`,
    "",
  ].join("\n");
  await atomicWrite(
    path.join(path.resolve(workspace), state.artifacts.verification),
    verification,
  );
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) throw new Error(`Verification failed; review ${failure.logFile}`);
  return { state, receipts };
}

export async function recordCheck({ workspace, layer, status, evidence }) {
  if (!CHECK_LAYERS.has(layer)) {
    throw new Error(`Check layer must be one of: ${[...CHECK_LAYERS].join(", ")}`);
  }
  if (!CHECK_STATUSES.has(status)) {
    throw new Error(`Check status must be one of: ${[...CHECK_STATUSES].join(", ")}`);
  }
  const state = await readState(workspace);
  const reviewedEvidence = requiredString(evidence, "evidence");
  assertSanitized(reviewedEvidence, "check evidence");
  state.checks[layer] = { status, evidence: reviewedEvidence, recordedAt: now() };
  appendHistory(state, "check-recorded", { layer, status });
  state.nextAction = "Run go-no-go after all required evidence is recorded.";
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return state;
}

export function determineGoNoGo(checks) {
  const statuses = [...CHECK_LAYERS].map((layer) => checks[layer]?.status ?? "unknown");
  if (statuses.some((status) => ["fail", "not-run", "unknown"].includes(status))) {
    return "NO-GO";
  }
  if (statuses.some((status) => status === "approved-exception")) {
    return "CONDITIONAL GO";
  }
  return "GO";
}

export async function generateGoNoGo(workspace) {
  const state = await readState(workspace);
  const decision = determineGoNoGo(state.checks);
  state.phase = "go-no-go";
  state.status = decision === "NO-GO" ? "blocked" : "needs-attention";
  state.nextAction = decision === "NO-GO"
    ? "Resolve failed, unknown, or unrun checks before requesting cutover approval."
    : "Review the finalized runbook and record production cutover approval.";
  const report = [
    "# Cutover Go/No-Go",
    "",
    `**Cutover recommendation:** ${decision}`,
    `**Automated core:** ${state.checks["automated-core"].status}`,
    `**Workload acceptance:** ${state.checks["workload-acceptance"].status}`,
    `**Production hardening:** ${state.checks["production-hardening"].status}`,
    `**Rollback readiness:** ${state.rollbackState}`,
    `**Recommended decision:** ${state.nextAction}`,
    "",
  ].join("\n");
  await atomicWrite(path.join(path.resolve(workspace), "go-no-go.md"), report);
  appendHistory(state, "go-no-go-generated", { decision });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return { state, decision };
}

export async function generateCutoverRunbook({
  workspace,
  rpo,
  rto,
  downtime,
  strategy,
  trafficSwitch,
  rollbackWindow,
}) {
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
    "## T-7 days",
    "- Confirm readiness, pilot, rehearsal, verification, and rollback evidence.",
    "- Confirm application release and source-change procedure.",
    "",
    "## T-1 day",
    "- Recheck source and target fingerprints.",
    "- Confirm monitoring, smoke tests, escalation path, and rollback authority.",
    "",
    "## T-30 minutes",
    "- Fence or coordinate source writes according to the approved strategy.",
    "- Run the approved final delta and critical verification.",
    "- Review go/no-go evidence and obtain production cutover approval.",
    "",
    "## T0",
    `- Switch application traffic using: ${inputs.trafficSwitch}`,
    "- Run critical smoke tests and verify data and transaction behavior.",
    "",
    "## T+30 minutes",
    "- Review errors, latency, throughput, connection health, and business invariants.",
    "- Roll back when an approved threshold is exceeded.",
    "",
    "## Rollback",
    "- Restore the approved application traffic path.",
    "- Activate the retained source or AGEFreighter backup according to recorded evidence.",
    "- Re-run smoke tests and verify write ownership before reopening traffic.",
    "",
    "## T+1 day and cleanup",
    `- Observe through the ${inputs.rollbackWindow} rollback window.`,
    "- Request destructive-cleanup approval only after business acceptance.",
    "",
  ].join("\n");
  await atomicWrite(
    path.join(path.resolve(workspace), state.artifacts.cutover),
    runbook,
  );
  state.phase = "cutover-planning";
  state.nextAction = "Review the runbook and go/no-go evidence, then record cutover approval.";
  appendHistory(state, "cutover-runbook-generated", {
    inputDigest: digest(JSON.stringify(inputs)),
  });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return state;
}

export async function recordCutover({ workspace, outcome, evidence }) {
  const allowed = new Set(["completed", "rolled-back", "failed"]);
  if (!allowed.has(outcome)) {
    throw new Error(`Cutover outcome must be one of: ${[...allowed].join(", ")}`);
  }
  const state = await readState(workspace);
  requireApproval(state, "cutover");
  const reviewedEvidence = requiredString(evidence, "cutover evidence");
  assertSanitized(reviewedEvidence, "cutover evidence");
  state.phase = outcome === "completed" ? "observation-window" : `cutover-${outcome}`;
  state.status = outcome === "completed" ? "on-track" : "blocked";
  state.rollbackState = outcome === "completed"
    ? "available through the approved rollback window"
    : outcome === "rolled-back"
      ? "rollback executed; source or prior target restored"
      : "requires an explicit rollback decision";
  state.nextAction = outcome === "completed"
    ? "Monitor the observation window and request cleanup only after acceptance."
    : "Review preserved state and choose retry, reconfigure, abort, or rollback.";
  appendHistory(state, "cutover-recorded", {
    outcome,
    evidence: reviewedEvidence,
  });
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  return state;
}

export async function cleanupMigration(workspace, { runner, jobId = null } = {}) {
  const state = await readState(workspace);
  requireApproval(state, "cleanup");
  const resolvedJobId = requireJobId(state, jobId);
  const receipts = await runSequence(
    workspace,
    state,
    [{
      label: "cleanup",
      executable: "agefreighter",
      args: ["cleanup", "--target", state.agefreighter.activeJobFile, resolvedJobId],
    }],
    runner,
  );
  const failure = firstFailure(receipts);
  state.status = failure ? "blocked" : "on-track";
  state.phase = failure ? "cleanup-failed" : "completed";
  state.rollbackState = failure ? state.rollbackState : "expired and cleaned up";
  state.nextAction = failure
    ? "Review cleanup evidence without manually dropping AGEFreighter objects."
    : "Migration is complete; retain the final report and evidence.";
  await writeState(workspace, state);
  await renderDashboard(workspace, state);
  if (failure) throw new Error(`Cleanup failed; review ${failure.logFile}`);
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
  await atomicWrite(
    path.join(path.resolve(workspace), state.artifacts.dashboard),
    dashboard,
  );
  return dashboard;
}

function nextApproval(state) {
  if (!approvalFor(state, "access-scope")) return "access-scope";
  if (state.phase === "readiness-reviewed" && !approvalFor(state, "pilot-write")) {
    return "pilot-write";
  }
  if (state.phase === "go-no-go" && !approvalFor(state, "cutover")) return "cutover";
  if (state.phase === "completed" && !approvalFor(state, "cleanup")) return "cleanup";
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
    if (key === "no-profile") {
      options.noProfile = true;
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
  neo4j-migration-runner init --workspace PATH --name NAME --job JOB [--mode guided|standard|expert]
  neo4j-migration-runner approve --workspace PATH --gate GATE --scope TEXT [--proposals ID@VERSION,...]
  neo4j-migration-runner assess --workspace PATH [--sample-size N] [--no-profile]
  neo4j-migration-runner pilot --workspace PATH --pilot-job JOB [--job-id ID]
  neo4j-migration-runner load --workspace PATH [--job-id ID]
  neo4j-migration-runner status --workspace PATH [--job-id ID]
  neo4j-migration-runner resume --workspace PATH [--job-id ID]
  neo4j-migration-runner verify --workspace PATH [--job-id ID]
  neo4j-migration-runner record-check --workspace PATH --layer LAYER --status STATUS --evidence TEXT
  neo4j-migration-runner go-no-go --workspace PATH
  neo4j-migration-runner cutover-plan --workspace PATH --rpo TEXT --rto TEXT --downtime TEXT --strategy TEXT --traffic-switch TEXT --rollback-window TEXT
  neo4j-migration-runner record-cutover --workspace PATH --outcome completed|rolled-back|failed --evidence TEXT
  neo4j-migration-runner cleanup --workspace PATH [--job-id ID]
  neo4j-migration-runner dashboard --workspace PATH`;
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
        mode: options.mode ?? "standard",
      });
    case "approve":
      return recordApproval({
        workspace,
        gate: options.gate,
        scope: options.scope,
        proposals: proposalList(options.proposals),
      });
    case "assess":
      return assessMigration(workspace, {
        sampleSize: Number(options.sample_size ?? 25000),
        includeProfile: !options.noProfile,
      });
    case "pilot":
      return runPilot(workspace, {
        pilotJob: options.pilot_job,
        jobId: options.job_id,
      });
    case "load":
      return runProductionLoad(workspace, { jobId: options.job_id });
    case "status":
      return inspectStatus(workspace, { jobId: options.job_id });
    case "resume":
      return resumeMigration(workspace, { jobId: options.job_id });
    case "verify":
      return verifyMigration(workspace, { jobId: options.job_id });
    case "record-check":
      return recordCheck({
        workspace,
        layer: options.layer,
        status: options.status,
        evidence: options.evidence,
      });
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
      return recordCutover({
        workspace,
        outcome: options.outcome,
        evidence: options.evidence,
      });
    case "cleanup":
      return cleanupMigration(workspace, { jobId: options.job_id });
    case "dashboard":
      return renderDashboard(workspace);
    default:
      throw new Error(usage());
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then((result) => {
      if (typeof result === "string") process.stdout.write(result);
      else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
