import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assessMigration,
  cleanupMigration,
  determineGoNoGo,
  generateCutoverRunbook,
  generateGoNoGo,
  initializeMigration,
  recordApproval,
  recordCheck,
  recordCutover,
  runPilot,
  runProductionLoad,
  verifyMigration,
} from "../skills/pg-graph/scripts/neo4j-migration-runner.mjs";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "neo4j-migration-runner-"));
  const workspace = path.join(root, "workspace");
  const job = path.join(root, "job.yaml");
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
  await initializeMigration({
    workspace,
    name: "test-migration",
    job,
    mode: "standard",
  });
  return { root, workspace, job };
}

async function state(workspace) {
  return JSON.parse(
    await readFile(path.join(workspace, "migration-state.yaml"), "utf8"),
  );
}

function successRunner(executable, args) {
  const output = executable === "agefreighter" && args[0] === "load"
    ? `Started AGEFreighter job ${JOB_ID}`
    : `${executable} ${args[0]} completed`;
  return { executable, args, status: 0, stdout: output, stderr: "" };
}

function failingRunner(executable, args) {
  return {
    executable,
    args,
    status: args[0] === "doctor" ? 1 : 0,
    stdout: "",
    stderr: args[0] === "doctor" ? "unsupported target pairing" : "",
  };
}

test("initialization creates a secret-free durable workspace", async () => {
  const { root, workspace } = await fixture();
  try {
    const migration = await state(workspace);
    assert.equal(migration.phase, "initialized");
    assert.equal(migration.interactionMode, "standard");
    assert.equal(migration.jobFile, "job.yaml");
    assert.equal(migration.checks["automated-core"].status, "not-run");
    assert.match(
      await readFile(path.join(workspace, "migration-status.md"), "utf8"),
      /Approval needed: access-scope/,
    );
    assert.match(
      await readFile(path.join(workspace, "target-diagnostics.sql"), "utf8"),
      /pg_available_extensions/,
    );
    assert.doesNotMatch(JSON.stringify(migration), /AGEFREIGHTER_NEO4J_PASSWORD/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assessment requires one access approval and produces readiness evidence", async () => {
  const { root, workspace } = await fixture();
  try {
    await assert.rejects(
      assessMigration(workspace, { runner: successRunner }),
      /access-scope/,
    );
    await recordApproval({
      workspace,
      gate: "access-scope",
      scope: "Bounded source profile, target doctor, and application inventory",
    });
    const result = await assessMigration(workspace, { runner: successRunner });
    assert.equal(result.readiness, "READY WITH REMEDIATION");
    assert.match(
      await readFile(path.join(workspace, "readiness.md"), "utf8"),
      /READY WITH REMEDIATION/,
    );
    assert.equal((await state(workspace)).phase, "readiness-reviewed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assessment failure persists a blocker and safe next action", async () => {
  const { root, workspace } = await fixture();
  try {
    await recordApproval({
      workspace,
      gate: "access-scope",
      scope: "Bounded readiness assessment",
    });
    await assert.rejects(
      assessMigration(workspace, { runner: failingRunner }),
      /Readiness assessment failed/,
    );
    const migration = await state(workspace);
    assert.equal(migration.status, "blocked");
    assert.match(migration.blockers[0], /doctor/);
    assert.match(migration.nextAction, /Resolve/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pilot and production loads enforce separate write approvals", async () => {
  const { root, workspace, job } = await fixture();
  try {
    await assert.rejects(
      runPilot(workspace, { pilotJob: job, runner: successRunner }),
      /pilot-write/,
    );
    await recordApproval({
      workspace,
      gate: "pilot-write",
      scope: "Isolated test_graph_pilot load and verification",
    });
    const pilot = await runPilot(workspace, {
      pilotJob: job,
      runner: successRunner,
    });
    assert.equal(pilot.jobId, JOB_ID);
    await assert.rejects(
      runProductionLoad(workspace, { runner: successRunner }),
      /production-write/,
    );
    await recordApproval({
      workspace,
      gate: "production-write",
      scope: "Production shadow graph load with retained rollback state",
    });
    const production = await runProductionLoad(workspace, {
      runner: successRunner,
    });
    assert.equal(production.jobId, JOB_ID);
    assert.equal((await state(workspace)).agefreighter.context, "production");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification and go-no-go remain fail closed until all layers have evidence", async () => {
  const { root, workspace } = await fixture();
  try {
    await recordApproval({
      workspace,
      gate: "production-write",
      scope: "Production shadow graph load",
    });
    await runProductionLoad(workspace, { runner: successRunner });
    await verifyMigration(workspace, { runner: successRunner });
    assert.equal((await generateGoNoGo(workspace)).decision, "NO-GO");
    await recordCheck({
      workspace,
      layer: "workload-acceptance",
      status: "pass",
      evidence: "Golden query suite and transaction tests passed",
    });
    await recordCheck({
      workspace,
      layer: "production-hardening",
      status: "approved-exception",
      evidence: "Bounded performance exception accepted for the pilot region",
    });
    assert.equal((await generateGoNoGo(workspace)).decision, "CONDITIONAL GO");
    await recordCheck({
      workspace,
      layer: "production-hardening",
      status: "pass",
      evidence: "Security, restore, performance, and rollback rehearsal passed",
    });
    assert.equal((await generateGoNoGo(workspace)).decision, "GO");
    assert.equal(determineGoNoGo({
      "automated-core": { status: "unknown" },
      "workload-acceptance": { status: "pass" },
      "production-hardening": { status: "pass" },
    }), "NO-GO");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cutover and cleanup artifacts preserve critical approval boundaries", async () => {
  const { root, workspace } = await fixture();
  try {
    await generateCutoverRunbook({
      workspace,
      rpo: "15 minutes",
      rto: "30 minutes",
      downtime: "20 minutes",
      strategy: "repeated upsert with final write fence",
      trafficSwitch: "deploy the approved PostgreSQL connection configuration",
      rollbackWindow: "24 hours",
    });
    const runbook = await readFile(
      path.join(workspace, "cutover-runbook.md"),
      "utf8",
    );
    assert.match(runbook, /T-30 minutes/);
    assert.match(runbook, /Rollback/);
    await assert.rejects(
      recordCutover({
        workspace,
        outcome: "completed",
        evidence: "Smoke tests and monitoring passed",
      }),
      /cutover/,
    );
    await recordApproval({
      workspace,
      gate: "cutover",
      scope: "Approved final delta, traffic switch, monitoring, and rollback thresholds",
    });
    await recordCutover({
      workspace,
      outcome: "completed",
      evidence: "Smoke tests and monitoring passed",
    });
    assert.equal((await state(workspace)).phase, "observation-window");
    await assert.rejects(
      cleanupMigration(workspace, { runner: successRunner, jobId: JOB_ID }),
      /cleanup/,
    );
    await recordApproval({
      workspace,
      gate: "cleanup",
      scope: "Remove retained AGEFreighter backup after the 24-hour window",
    });
    await cleanupMigration(workspace, { runner: successRunner, jobId: JOB_ID });
    assert.equal((await state(workspace)).phase, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("literal credentials are rejected before state is created", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neo4j-migration-secret-"));
  try {
    const job = path.join(root, "unsafe.yaml");
    await writeFile(job, "password: example-unsafe-value\n");
    await assert.rejects(
      initializeMigration({
        workspace: path.join(root, "workspace"),
        name: "unsafe",
        job,
      }),
      /credentials/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
