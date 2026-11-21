import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assessMigration,
  atomicWrite,
  attachReviewedJob,
  cleanupMigration,
  generateCutoverRunbook,
  generateGoNoGo,
  initializeMigration,
  recordApproval,
  recordCheck,
  recordCutover,
  recordObservation,
  recordPilotEvidence,
  recordRollbackEvidence,
  registerProposal,
  resumeMigration,
  runPilot,
  runProductionLoad,
  verifyMigration,
} from "../skills/pg-graph/scripts/neo4j-migration-runner.mjs";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";
const TEST_ROOT = path.join(
  process.env.POSTGRES_SKILLS_TEST_TEMP_ROOT ??
    path.join(os.homedir(), ".postgres-skills-test-workspaces"),
  "neo4j-migration-runner",
);
const RETRYABLE_CLEANUP_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

async function removeTestPath(target, { attempts = 7, baseDelayMs = 20 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!RETRYABLE_CLEANUP_CODES.has(error.code) || attempt >= attempts - 1) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(baseDelayMs * (2 ** attempt), 500)),
      );
    }
  }
}

async function fixture({ initialize = true } = {}) {
  await mkdir(TEST_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(TEST_ROOT, "runner-"));
  const workspace = path.join(root, "workspace");
  const repository = path.join(root, "repository");
  const job = path.join(root, "job.yaml");
  await mkdir(repository);
  await writeFile(path.join(repository, "app.txt"), "stable repository\n");
  await writeFile(job, `apiVersion: agefreighter.io/v2
kind: LoadJob
metadata:
  name: test-migration
source:
  type: neo4j
  neo4j:
    uri: neo4j+s://example.databases.neo4j.io
    username: neo4j
    password:
      env: AGEFREIGHTER_NEO4J_PASSWORD
target:
  type: apache-age
  graph: test_graph
  connection:
    env: AGEFREIGHTER_TARGET_DSN
`);
  if (initialize) {
    await initializeMigration({
      workspace,
      name: "test-migration",
      job,
      repository,
      mode: "standard",
    });
  }
  return { root, workspace, repository, job };
}

async function state(workspace) {
  return JSON.parse(await readFile(path.join(workspace, "migration-state.yaml"), "utf8"));
}

function successRunner(executable, args) {
  const command = args[0];
  const machineOutcome = {
    status: "completed",
    complete: true,
    jobId: command === "load" ? JOB_ID : undefined,
    version: command === "version" ? "2.4.2" : undefined,
    path: command === "version" ? "agefreighter" : undefined,
  };
  return {
    executable,
    args,
    status: 0,
    stdout: command === "load" ? JSON.stringify(machineOutcome) : "",
    stderr: "",
    machineOutcome,
  };
}

function zeroExitFailedRunner(executable, args) {
  return {
    executable,
    args,
    status: 0,
    stdout: "",
    stderr: "",
    machineOutcome: {
      status: args[0] === "doctor" ? "failed" : "completed",
      complete: true,
    },
  };
}

function zeroExitIncompleteRunner(executable, args) {
  return {
    executable,
    args,
    status: 0,
    stdout: "",
    stderr: "",
    machineOutcome: {
      status: args[0] === "verify" ? "incomplete" : "completed",
      complete: args[0] !== "verify",
      jobId: args[0] === "load" ? JOB_ID : undefined,
    },
  };
}

async function assessReady(workspace) {
  await recordApproval({
    workspace,
    gate: "access-scope",
    scope: "Bounded source, target, and repository assessment",
  });
  return assessMigration(workspace, { runner: successRunner });
}

async function acceptPilot(workspace, job) {
  await recordApproval({
    workspace,
    gate: "pilot-write",
    scope: "Isolated representative pilot graph",
  });
  await runPilot(workspace, { pilotJob: job, runner: successRunner });
  await recordPilotEvidence({
    workspace,
    outcome: "accepted",
    evidence: "Pilot counts, integrity, critical queries, and rollback checks accepted",
  });
}

async function productionVerified(workspace, job) {
  await assessReady(workspace);
  await acceptPilot(workspace, job);
  await recordApproval({
    workspace,
    gate: "production-write",
    scope: "Production shadow graph with retained rollback state",
  });
  await runProductionLoad(workspace, { runner: successRunner });
  await verifyMigration(workspace, { runner: successRunner });
}

test("minimal-input initialization is secret-free and blocks AGEFreighter until job attachment", async () => {
  const { root, workspace, repository, job } = await fixture({ initialize: false });
  try {
    await initializeMigration({
      workspace,
      name: "discovery-only",
      sourceProfile: "saved-neo4j-readonly",
      targetProfile: "saved-postgres-target",
      repository,
    });
    const migration = await state(workspace);
    assert.equal(migration.phase, "discovery-only");
    assert.equal(migration.jobFile, null);
    assert.match(
      await readFile(path.join(workspace, "discovery-readiness.md"), "utf8"),
      /does not resolve profile secrets/,
    );
    await assert.rejects(
      assessMigration(workspace, { runner: successRunner }),
      /reviewed job must be attached/,
    );
    await attachReviewedJob({ workspace, job });
    assert.equal((await state(workspace)).jobFile, "job.yaml");
  } finally {
    await removeTestPath(root);
  }
});

test("zero-exit failed, incomplete, unavailable, and truncated evidence fail closed", async () => {
  const { root, workspace } = await fixture();
  try {
    await recordApproval({ workspace, gate: "access-scope", scope: "Bounded assessment" });
    await assert.rejects(
      assessMigration(workspace, { runner: zeroExitFailedRunner }),
      /failed closed/,
    );
    assert.equal((await state(workspace)).readiness.outcome, "BLOCKED");
  } finally {
    await removeTestPath(root);
  }

  const second = await fixture();
  try {
    await recordApproval({ workspace: second.workspace, gate: "access-scope", scope: "Bounded assessment" });
    await assert.rejects(
      assessMigration(second.workspace, {
        runner: (executable, args) => ({
          executable,
          args,
          status: 0,
          stdout: "",
          stderr: "",
          truncated: args[0] === "validate",
          machineOutcome: args[0] === "validate" ? null : { status: "completed", complete: true },
        }),
      }),
      /failed closed/,
    );
  } finally {
    await removeTestPath(second.root);
  }

  const third = await fixture();
  try {
    await recordApproval({ workspace: third.workspace, gate: "access-scope", scope: "Bounded assessment" });
    await assert.rejects(
      assessMigration(third.workspace, {
        runner: (executable, args) => ({ executable, args, status: 0, stdout: "", stderr: "" }),
      }),
      /failed closed/,
    );
  } finally {
    await removeTestPath(third.root);
  }
});

test("commands without reliable contracts require review rather than passing", async () => {
  const { root, workspace } = await fixture();
  try {
    await recordApproval({ workspace, gate: "access-scope", scope: "Bounded assessment" });
    const result = await assessMigration(workspace, {
      runner: (executable, args) => ({
        executable,
        args,
        status: 0,
        stdout: "",
        stderr: "",
        machineOutcome: ["plan", "inspect"].includes(args[0])
          ? null
          : { status: "completed", complete: true },
      }),
    });
    assert.equal(result.readiness, "READY WITH REMEDIATION");
  } finally {
    await removeTestPath(root);
  }
});

test("automated-core is runner-owned and incomplete verification cannot pass", async () => {
  const { root, workspace, job } = await fixture();
  try {
    await productionVerified(workspace, job);
    await assert.rejects(
      recordCheck({
        workspace,
        layer: "automated-core",
        status: "pass",
        evidence: "manual overwrite",
      }),
      /runner-owned/,
    );
    await assert.rejects(
      verifyMigration(workspace, { runner: zeroExitIncompleteRunner }),
      /failed closed/,
    );
    assert.equal((await state(workspace)).checks["automated-core"].status, "fail");
  } finally {
    await removeTestPath(root);
  }
});

test("phase sequencing blocks production, cutover, and cleanup skips", async () => {
  const { root, workspace, job } = await fixture();
  try {
    await recordApproval({ workspace, gate: "production-write", scope: "Production graph" });
    await assert.rejects(runProductionLoad(workspace, { runner: successRunner }), /readiness/);

    await assessReady(workspace);
    await assert.rejects(runProductionLoad(workspace, { runner: successRunner }), /pilot evidence/);
    await acceptPilot(workspace, job);
    await assert.rejects(runProductionLoad(workspace, { runner: successRunner }), /stale/);

    await recordApproval({ workspace, gate: "production-write", scope: "Production graph after accepted pilot" });
    await runProductionLoad(workspace, { runner: successRunner });
    await recordApproval({ workspace, gate: "cutover", scope: "Traffic switch" });
    await assert.rejects(
      recordCutover({ workspace, outcome: "completed", evidence: "Smoke tests passed" }),
      /GO decision/,
    );
    await recordApproval({ workspace, gate: "cleanup", scope: "Remove retained state" });
    await assert.rejects(
      cleanupMigration(workspace, { runner: successRunner }),
      /completed cutover/,
    );
  } finally {
    await removeTestPath(root);
  }
});

test("approvals expire and invalidate after relevant state changes", async () => {
  const { root, workspace, job } = await fixture();
  try {
    await assessReady(workspace);
    await recordApproval({ workspace, gate: "pilot-write", scope: "Pilot graph" });
    await writeFile(job, `${await readFile(job, "utf8")}\n# changed\n`);
    await attachReviewedJob({ workspace, job });
    await assert.rejects(
      runPilot(workspace, { pilotJob: job, runner: successRunner }),
      /readiness/,
    );
    await recordApproval({
      workspace,
      gate: "access-scope",
      scope: "Expired assessment",
      expiresAt: new Date(Date.now() + 10).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(
      assessMigration(workspace, { runner: successRunner }),
      /expired/,
    );
  } finally {
    await removeTestPath(root);
  }
});

test("resume rejects changed job, repository, and binary identity", async () => {
  const { root, workspace, job, repository } = await fixture();
  try {
    await assessReady(workspace);
    await acceptPilot(workspace, job);
    await writeFile(path.join(workspace, "pilot-job.yaml"), "changed: true\n");
    await assert.rejects(
      resumeMigration(workspace, { runner: successRunner }),
      /job fingerprint changed/,
    );

    await writeFile(path.join(workspace, "pilot-job.yaml"), await readFile(job, "utf8"));
    await writeFile(path.join(repository, "app.txt"), "repository changed\n");
    await assert.rejects(
      resumeMigration(workspace, { runner: successRunner }),
      /stale|repository fingerprint changed/,
    );

    await writeFile(path.join(repository, "app.txt"), "stable repository\n");
    await assert.rejects(
      resumeMigration(workspace, {
        runner: successRunner,
        binaryPath: path.join(root, "other-agefreighter.exe"),
        binaryVersion: "2.4.2",
      }),
      /binary path changed/,
    );
  } finally {
    await removeTestPath(root);
  }
});

test("structural secret validation rejects nested literals and receipts redact secret-bearing errors", async () => {
  const { root, workspace } = await fixture({ initialize: false });
  try {
    const unsafe = path.join(root, "unsafe.yaml");
    await writeFile(unsafe, `source:
  auth:
    password:
      value: deeply-secret-value
`);
    await assert.rejects(
      initializeMigration({ workspace, name: "unsafe", job: unsafe }),
      /supported secret reference/,
    );

    const safe = path.join(root, "safe.yaml");
    await writeFile(safe, `source:
  password:
    env: SAFE_PASSWORD
`);
    await initializeMigration({ workspace, name: "safe", job: safe });
    await recordApproval({ workspace, gate: "access-scope", scope: "Assessment" });
    await assert.rejects(
      assessMigration(workspace, {
        runner: (executable, args) => ({
          executable,
          args,
          status: 1,
          stdout: "",
          stderr: "password=should-not-appear",
          machineOutcome: { status: "failed", complete: true },
        }),
      }),
      /failed closed/,
    );
    const logs = await readdir(path.join(workspace, "command-output"));
    const content = await readFile(path.join(workspace, "command-output", logs.find((name) => name.endsWith(".log"))), "utf8");
    assert.doesNotMatch(content, /should-not-appear/);
    assert.match(content, /redacted/);
  } finally {
    await removeTestPath(root);
  }
});

test("translation approvals require exact immutable registered ID@VERSION digests", async () => {
  const { root, workspace } = await fixture();
  try {
    const proposal = path.join(root, "proposal.cypher");
    await writeFile(proposal, "MATCH (n) RETURN n\n");
    await registerProposal({
      workspace,
      id: "cypher-driver-001",
      version: 1,
      file: proposal,
      location: "src/queries/patient.cypher:1",
    });
    await assert.rejects(
      recordApproval({
        workspace,
        gate: "application-change",
        scope: "Apply reviewed translation",
        proposals: ["cypher-driver-001@2"],
      }),
      /not registered/,
    );
    await recordApproval({
      workspace,
      gate: "application-change",
      scope: "Apply reviewed translation",
      proposals: ["cypher-driver-001@1"],
    });
    await writeFile(proposal, "MATCH (n) RETURN count(n)\n");
    await assert.rejects(
      registerProposal({
        workspace,
        id: "cypher-driver-001",
        version: 1,
        file: proposal,
        location: "src/queries/patient.cypher:1",
      }),
      /immutable/,
    );
    const migration = await state(workspace);
    assert.equal(migration.proposals["cypher-driver-001@1"].status, "approved");
  } finally {
    await removeTestPath(root);
  }
});

test("reruns use unique immutable command receipts", async () => {
  const { root, workspace } = await fixture();
  try {
    await recordApproval({ workspace, gate: "access-scope", scope: "Assessment" });
    await assessMigration(workspace, { runner: successRunner });
    await assessMigration(workspace, { runner: successRunner });
    const logs = (await readdir(path.join(workspace, "command-output"))).filter((name) => name.endsWith(".log"));
    assert.equal(new Set(logs).size, logs.length);
    assert.ok(logs.length >= 10);
  } finally {
    await removeTestPath(root);
  }
});

test("atomic replacement retries Windows-like EPERM and EACCES contention", async () => {
  const { root } = await fixture({ initialize: false });
  try {
    const destination = path.join(root, "atomic.txt");
    let attempts = 0;
    await atomicWrite(destination, "safe\n", {
      renameImpl: async (source, target) => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("busy");
          error.code = attempts === 1 ? "EPERM" : "EACCES";
          throw error;
        }
        const { rename } = await import("node:fs/promises");
        await rename(source, target);
      },
      sleepImpl: async () => {},
    });
    assert.equal(attempts, 3);
    assert.equal(await readFile(destination, "utf8"), "safe\n");
  } finally {
    await removeTestPath(root);
  }
});

test("cutover and cleanup require GO, runbook, rollback, observation, window, and current approvals", async () => {
  const { root, workspace, job } = await fixture();
  try {
    await productionVerified(workspace, job);
    await recordCheck({ workspace, layer: "workload-acceptance", status: "pass", evidence: "Golden workload accepted" });
    await recordCheck({ workspace, layer: "production-hardening", status: "pass", evidence: "Security, restore, and performance passed" });
    assert.equal((await generateGoNoGo(workspace)).decision, "GO");
    await generateCutoverRunbook({
      workspace,
      rpo: "15 minutes",
      rto: "30 minutes",
      downtime: "20 minutes",
      strategy: "final write fence",
      trafficSwitch: "approved deployment",
      rollbackWindow: "24 hours",
    });
    await assert.rejects(
      recordCutover({ workspace, outcome: "completed", evidence: "Smoke tests passed" }),
      /rollback evidence/,
    );
    await recordRollbackEvidence({ workspace, evidence: "Restore and traffic rollback rehearsal passed" });
    await recordApproval({ workspace, gate: "cutover", scope: "Current GO, runbook, rollback, and traffic switch" });
    await recordCutover({ workspace, outcome: "completed", evidence: "Smoke tests and monitoring passed" });
    await assert.rejects(cleanupMigration(workspace, { runner: successRunner }), /observation/);
    await recordObservation({
      workspace,
      evidence: "24-hour observation and business acceptance complete",
      rollbackWindowSatisfied: true,
    });
    await recordApproval({ workspace, gate: "cleanup", scope: "Cleanup after accepted 24-hour observation" });
    await cleanupMigration(workspace, { runner: successRunner });
    assert.equal((await state(workspace)).phase, "completed");
  } finally {
    await removeTestPath(root);
  }
});

test.after(async () => {
  await removeTestPath(TEST_ROOT);
});
