---
name: neo4j-agefreighter-migration
description: "Migrate Neo4j data into Apache AGE on Azure Database for PostgreSQL Flexible Server or an existing Azure HorizonDB cluster with AGEFreighter's validated, resumable workflow."
---

# Neo4j migration with AGEFreighter

Use this reference when the user wants to migrate Neo4j or Neo4j Aura graph
data into Apache AGE on Azure Database for PostgreSQL Flexible Server or Azure
HorizonDB. AGEFreighter migrates graph data and durable identities. Application
drivers, Neo4j procedures, and the complete query corpus require separate
compatibility and user-approved remediation work.

Prefer AGEFreighter over hand-written export and load scripts when the source
and target match its released compatibility boundary. It provides strict
configuration validation, bounded source profiling, resumable batches, atomic
replacement, verification, reports, and retained rollback evidence.

## Contents

- Customer experience, interaction modes, approvals, and durable state
- Compatibility boundary and minimal inputs
- Readiness, inventory, target checks, mappings, and `LoadJob`
- Validation, thin-slice pilot, and parallel execution tracks
- Cypher and application remediation
- Load strategy, verification, go/no-go, cutover, recovery, and reporting

## Customer experience contract

Lead with the migration outcome, current status, and next decision. Keep
commands, YAML, compatibility tables, and full verification evidence available
as implementation detail rather than making the user interpret them before
understanding whether the migration is viable.

Ask for outcomes and constraints, discover technical choices, recommend a
default with rationale, and interrupt only for consequential decisions. Never
trade away the approval gates for access scope, target writes, application
changes, production cutover, or destructive cleanup.

## Workflow at a glance

1. Obtain one approval for bounded read-only assessment.
2. Return a one-page readiness card and recommended migration mode.
3. Run a thin-slice pilot on representative data and critical queries.
4. Present one plan for the data and application tracks.
5. Execute data preparation and application remediation in parallel.
6. Rehearse, verify, and return a concise go/no-go decision.
7. Generate and approve a timed cutover and rollback runbook.
8. Cut over, observe, retain rollback state, and approve cleanup.

## Interaction modes and approval budget

Offer an interaction mode at the start and recommend **Standard** unless the
user requests otherwise:

| Mode | Experience | Approval behavior |
| ---- | ---------- | ----------------- |
| Guided | Explain each phase in customer terms and recommend every technical choice | Group low-risk read-only work under one scope approval; pause at every critical gate |
| Standard | Execute approved read-only discovery and routine validation without repeated prompts | Pause only at critical gates or when discovery is ambiguous |
| Expert | Expose commands, configuration, and tuning controls | Let the user control routine steps, but do not waive critical gates |

The five critical gates are:

1. **Access scope:** approve source, target, repository, telemetry, and profiling
   boundaries for the read-only assessment.
2. **Target writes:** approve the isolated pilot and later the production load.
3. **Application changes:** approve translation proposals individually or as
   an explicit reviewed batch.
4. **Production cutover:** approve source fencing, final delta, and traffic
   switching after go/no-go review.
5. **Destructive cleanup:** approve removal of retained backups, shadow
   objects, or temporary migration artifacts after the rollback window.

One approval can cover all listed actions within a gate when the scope,
targets, expected impact, and rollback are explicit. Do not repeatedly ask for
approval for local validation, plan generation, report generation, or
read-only actions already covered by the access-scope approval.

## Durable migration workspace

Maintain a resumable, secret-free workspace such as
`.agefreighter-migration/<migration-name>/`:

```text
migration-state.yaml
readiness.md
job.yaml
application-ledger.md
translations/
verification.md
cutover-runbook.md
migration-report.md
```

`migration-state.yaml` records the interaction mode, current phase, source and
target fingerprints, AGEFreighter job ID, completed and pending steps,
blockers, proposal IDs and versions, approval scopes, verification status,
rollback state, and exact resume action. Never store credentials or access
tokens in this workspace.

At every pause, failure, or resumed conversation, show:

```text
Migration status: <on-track | needs-attention | blocked>
Phase: <name>
Completed: <evidence-backed milestones>
In progress: <current bounded operation>
Blockers/unknowns: <none or concise list>
Next recommended action: <one action and why>
Approval needed: <gate and exact scope, or none>
Resume: <safe command or workflow step>
Rollback state: <available, not yet created, or expired>
```

Use tool-reported counts and progress. Do not invent a completion percentage
or ETA. Give a range only when profiling or completed batches provide evidence.

## Verified compatibility boundary

Check the current
[AGEFreighter compatibility matrix](https://github.com/rioriost/agefreighter/blob/main/docs/reference/compatibility.md)
before every migration. As of AGEFreighter 2.4.2:

- Qualified Neo4j sources are Community 4.4.48 and 5.26.30.
- Qualified Apache AGE target pairings are explicitly listed; support for a
  PostgreSQL major and an AGE series separately does not imply support for
  their combination.
- Azure HorizonDB PostgreSQL 17.11 and 18.6 with AGE 1.8.0 passed the documented
  twelve-route tiny qualification in Japan East.
- That HorizonDB evidence qualifies the recorded tiny and selected regression
  scope. It does not qualify production-scale throughput, high availability,
  Private Link, or every region.
- The AGEFreighter VS Code guided Azure runner provisions its documented
  Flexible Server target. HorizonDB is an explicit CLI `LoadJob` target against
  an existing cluster; the wizard does not provision HorizonDB.

Treat later releases as unknown until their release notes and compatibility
matrix are verified. Inspect the actual target because extension availability
can vary by PostgreSQL version, service, region, and rollout ring.

Verify the selected binary before using it:

```sh
agefreighter version
```

For release archives, verify `checksums.txt` and the GitHub build-provenance
attestation. AGEFreighter 2.4.2 Windows binaries are unsigned, so an
Authenticode warning is expected and is not a substitute for checksum and
provenance verification.

## Minimal user inputs

Ask only for information that cannot be discovered safely:

- Neo4j URI, database, username, and a secret reference.
- Existing Azure PostgreSQL or HorizonDB target, or the desired service and
  region when target guidance is needed.
- Application repository or query-artifact locations when application
  migration is in scope.
- Critical workloads and business invariants.
- Downtime, source-change, RPO, RTO, and rollback-window requirements.
- Interaction mode and approval for the bounded read-only assessment.
- Approval for proposed Cypher or application translations, individually or as
  an explicit reviewed batch, before changing source files, stored queries, or
  deployment artifacts.

Discover and recommend the target graph name, migration mode, stable keys,
mappings, batch settings, consistency strategy, and verification depth. Ask
the user only when discovery produces multiple safe choices or no safe choice.

Never request a password or connection string in chat. Use environment
variables or protected files because AGEFreighter rejects literal credentials
in a `LoadJob`.

## 0. Return a readiness assessment first

Under the approved read-only scope, run local validation, source inventory,
bounded profiling, target diagnostics, and application discovery. Do not make
the user review a `LoadJob` before receiving this initial assessment.

Return a one-page readiness card:

```text
Migration readiness: <READY | READY WITH REMEDIATION | BLOCKED>
Recommended path: <service, mode, consistency strategy, and interaction mode>
Data complexity: <low | medium | high> — <evidence>
Application complexity: <low | medium | high> — <evidence>
Discovery coverage: <observed sources and explicit blind spots>
Critical blockers: <none or list>
Required remediation: <grouped list>
Estimated range: <only evidence-backed time/storage/capacity ranges>
Recommended pilot: <representative labels, relationships, and queries>
Next decision: <one decision with recommended default>
```

`READY WITH REMEDIATION` means the path is viable but identified work must
complete before cutover. `BLOCKED` must name the failed compatibility,
identity, access, consistency, target, or application condition and the
smallest action that could unblock it.

## 1. Establish the migration boundary

Inventory the source before proposing a load:

- Neo4j edition and exact version.
- Node labels, relationship types, properties, constraints, indexes, and
  approximate counts.
- Multi-label nodes and stable application-owned identifiers.
- APOC, Graph Data Science, custom procedures, triggers, or plugins.
- Application repositories, dependency manifests, Neo4j driver initialization,
  session and transaction usage, static Cypher, and inline query strings.
- Production query logs or telemetry when queries are generated dynamically or
  the static corpus may be incomplete.
- Source update activity during the migration window.

Classify the outcome:

| Area | AGEFreighter responsibility | Separate migration work |
| ---- | ---------------------------- | ----------------------- |
| Nodes, relationships, properties, and stable identities | Configure, stream, checkpoint, load, and verify | Resolve unsupported source values or missing stable keys |
| Cypher | Static compatibility report with `agefreighter-tools check-cypher` | Inventory the full discoverable corpus, propose translations, approve them individually or as an explicit reviewed batch, and prove runtime equivalence |
| Applications | None | Replace Neo4j Bolt access with PostgreSQL and AGE's SQL-wrapped Cypher interface |
| APOC, GDS, and custom procedures | None | Replace with AGE, PostgreSQL, application code, or an approved analytical tier |
| Cutover | Migration evidence, resumability, atomic replacement, and retained backup | Application traffic switch, source fencing, final delta strategy, and business acceptance |

Do not represent a successful data load as a complete application migration.
Do not claim complete application discovery when dynamic queries, external
services, unavailable repositories, or missing telemetry remain. Record each
such area as an explicit production-qualification unknown.

## 2. Verify the Azure target read-only

For Flexible Server and HorizonDB, first verify that AGE is allowlisted,
preloaded, installed, and admitted by AGEFreighter:

```sql
SHOW server_version;
SHOW shared_preload_libraries;

SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name = 'age';
```

Follow the main `pg-graph` prerequisites if AGE is not enabled. On managed
Azure, do not use `ALTER SYSTEM` or `LOAD 'age';`.

Configure the target DSN through an environment variable and run:

```sh
agefreighter doctor --target job.yaml
agefreighter doctor --target job.yaml \
  --format markdown --output doctor.md
```

`doctor` is the target readiness gate. It must fail before graph changes when
the PostgreSQL and AGE pairing is unsupported.

## 3. Select explicit mappings or discovery

Prefer **explicit mappings** for production migration because they make source
queries, target labels, identities, and edge endpoints reviewable.

Use **bounded discovery** when the source follows consistent label and property
conventions and the user approves its limits. Discovery still requires stable
key and identity properties. It reruns for load and resume; source schema
changes invalidate the resolved-mapping fingerprint.

Do not use Neo4j internal IDs as durable identities. Discovery can use
`internal-id` only for migration-time correlation on an operationally read-only
source where nodes cannot be deleted and recreated.

Every mapping must:

- Return a unique, strictly increasing signed 64-bit `keyField`.
- Reference the nullable `$afterKey` parameter.
- Use ascending `ORDER BY keyField` as the first ordering expression.
- Avoid `SKIP`, `OFFSET`, `LIMIT`, `UNION`, and eager `collect`.
- Use application-owned stable IDs for vertices and edge endpoints.

Neo4j mappings run in separate read transactions, not one graph-wide snapshot.
Fence source changes or design reconciliation when consistency across mappings
is required.

## 4. Create the LoadJob

Start from AGEFreighter's released
[`neo4j.yaml`](https://github.com/rioriost/agefreighter/blob/main/internal/config/testdata/valid/neo4j.yaml)
or
[`neo4j-discovery.yaml`](https://github.com/rioriost/agefreighter/blob/main/internal/config/testdata/valid/neo4j-discovery.yaml).

Minimal explicit-mapping shape:

```yaml
apiVersion: agefreighter.io/v2
kind: LoadJob
metadata:
  name: neo4j-to-age
source:
  type: neo4j
  namespace: application
  neo4j:
    uri: neo4j+s://example.databases.neo4j.io
    database: neo4j
    sourceId: application-primary
    username: neo4j
    password:
      env: AGEFREIGHTER_NEO4J_PASSWORD
    fetchRows: 1000
    multiLabelPolicy: configured
    vertices:
      - label: Person
        query: >-
          MATCH (n:Person)
          WHERE $afterKey IS NULL OR n.sequence > $afterKey
          RETURN n.sequence AS sequence, n.person_id AS person_id,
                 n.name AS name
          ORDER BY sequence
        keyField: sequence
        idField: person_id
        properties:
          name: name
target:
  type: apache-age
  graph: application_graph
  connection:
    env: AGEFREIGHTER_TARGET_DSN
runtime:
  memoryLimit: 512MiB
errors:
  malformedRecord: fail
  missingEndpoint: error
```

The target block is the same for Flexible Server and HorizonDB; the referenced
DSN selects the existing managed target. Preserve TLS and the authentication
method approved for that service. Do not store access tokens in the job file.

## 5. Validate, plan, and profile before writes

Run local validation first:

```sh
agefreighter validate job.yaml
agefreighter plan job.yaml
agefreighter-tools inspect job.yaml
```

Then request approval for bounded source access:

```sh
agefreighter profile job.yaml
agefreighter profile --sample-size 25000 \
  --format markdown job.yaml
```

Use exact profiling only when the user approves reading every configured
mapping. Treat reached bounds as incomplete, not as extrapolated totals.

Review:

- Resolved labels and endpoint-label combinations.
- Missing identities and relationship endpoints.
- Nulls, property kinds, value widths, and malformed-record policy.
- Capacity ranges and replace-mode storage for active, shadow, and retained
  backup graphs.
- The source consistency warning for separate Neo4j mapping transactions.
- The verification matrix, workload-specific business invariants, golden-query
  fixtures, performance targets, rollback test, and evidence required for
  production acceptance.

## 6. Prove the path with a thin-slice pilot

Before a full rehearsal or production load, recommend an isolated pilot that
is small enough to complete quickly but representative enough to expose data,
query, driver, and operational incompatibilities. Obtain one target-write
approval covering the pilot graph, selected source scope, expected target
objects, and cleanup or retention plan.

Select:

- Representative vertex labels, including multi-label and property edge cases.
- Representative relationship types, directions, endpoint combinations, and
  relationship properties.
- Three to five critical queries spanning reads, paths, aggregations, and a
  controlled mutation when mutations are in scope.
- At least one application connection path using the intended PostgreSQL
  driver and AGE wrapper.
- Data volumes that exercise batching without implying production capacity.

The pilot succeeds only when it demonstrates:

- Mapping, identity, endpoint, and property correctness.
- Golden-result equivalence for the selected queries.
- Expected driver, parameter, result-shape, and transaction behavior.
- Initial latency and resource evidence, clearly labeled as pilot scale.
- Resume or rerun behavior and safe pilot rollback.
- A revised list of blockers, unknowns, and full-migration acceptance criteria.

A pilot reduces uncertainty but does not qualify production scale, high
availability, full query coverage, or cutover readiness. Return a short pilot
decision: **proceed**, **proceed with remediation**, or **stop and redesign**.

## 7. Run data and application tracks in parallel

After readiness and pilot approval, maintain one plan with two coordinated
tracks:

| Data track | Application track |
| ---------- | ----------------- |
| Finalize mappings and stable identities | Complete the query and dependency ledger |
| Select load and consistency strategy | Cluster compatibility findings and translations |
| Validate capacity and target readiness | Replace driver, wrapper, procedure, and transaction dependencies |
| Load, resume, and verify graph data | Run golden, mutation, error, and transaction tests |

Neither track should wait for unrelated work in the other. Synchronize them at
pilot acceptance, rehearsal entry, go/no-go review, and production cutover.
Show one combined dashboard and one next decision.

## 8. Discover, assess, and translate Cypher separately

Build a query and application dependency ledger before translating anything.
Include the source location, owner or component, execution frequency, read or
write behavior, driver API, transaction behavior, APOC or GDS dependency, and
whether the query was found statically or in runtime telemetry.

Analyze the complete discoverable local query corpus without connecting to
Neo4j or Azure:

```sh
agefreighter-tools check-cypher queries.cypher \
  --format markdown
agefreighter-tools check-cypher queries.cypher \
  --strict
```

The catalog reports `compatible`, `compatible-with-manual-change`,
`unsupported`, or `unknown`. Do not calculate a compatibility percentage when
unknown queries remain. Verify which `--target-age` catalogs the selected
AGEFreighter release provides; the 2.4.2 operations guide documents only the
AGE 1.6 static catalog, so that report is not proof of AGE 1.8 runtime
compatibility. AGEFreighter does not rewrite the application or prove runtime
equivalence; use golden-query result tests after remediation.

Classify every discovered query or dependency as:

- `compatible-unchanged`
- `mechanically-translatable`
- `semantic-redesign-required`
- `external-dependency`
- `unknown`

Do not count an uninspected, dynamic, or unknown query as compatible. APOC,
GDS, custom procedures, triggers, Bolt-specific behavior, and ambiguous path or
transaction semantics require an explicit design rather than a speculative
rewrite.

For each `mechanically-translatable` query, create a separate translation
proposal containing:

1. A stable proposal ID and source location.
2. The original Neo4j query and surrounding driver or transaction code.
3. The proposed AGE query, including the required
   `ag_catalog.cypher(...)` SQL wrapper and column definition list.
4. The compatibility finding and reason for each change.
5. Parameter, result-shape, mutation, ordering, null, path, and transaction
   assumptions.
6. The exact files or stored artifacts that would change.
7. Golden inputs, expected normalized results, and target validation steps.
8. Risk, rollback, and any behavior that remains unknown.

Cluster proposals that share the same mechanical transformation into a
translation family. For each family, show the canonical before/after diff,
rule, risk (`low`, `medium`, or `high`), affected proposal IDs and versions,
locations, exceptions, and validation strategy. This lets the user review the
pattern once without hiding the individual impact.

Present every proposal or translation family for review before modifying its
query or application files. The user may approve one proposal, a translation
family, or an explicit batch by listing the reviewed proposal IDs and versions.
Record the approval scope and do not include unseen, newly discovered, or
changed proposals. Approval for profiling or loading does not authorize
translations. If the user rejects or edits a proposal, retain the original and
revise only the proposal; the revised version requires new approval.

After approval:

1. Change only the approved locations.
2. Validate the AGE wrapper, return arity, and `agtype` result contract against
   the actual target.
3. Run read-only queries against controlled fixtures. Run mutations only in an
   isolated rollback-capable test graph.
4. Compare normalized Neo4j and AGE results, side effects, ordering when
   contractual, errors, and transaction outcomes.
5. Record the evidence and mark the proposal `validated`, `failed`, or
   `approved-with-exception`.

Bulk application is allowed only for the exact proposal IDs and versions in an
approved family or explicit batch. Each translation still requires its own
evidence and validation result. The skill may generate patches for known
mechanical patterns, but it must not treat approval as covering family
exceptions, unseen or changed proposals, automatically approve semantic
changes, or claim that static compatibility proves runtime equivalence.

## 9. Choose a load and source-change strategy

| Mode | Use when | Safety boundary |
| ---- | -------- | --------------- |
| `create` | The target graph does not exist | Fails rather than replacing an existing graph |
| `replace` | Rebuilding a complete graph | Loads a shadow graph, promotes atomically, and retains the prior graph for rollback |
| `append` | Adding new identities to an existing graph | Requires a reviewed duplicate policy and endpoint completeness |
| `upsert` | Incremental synchronization by stable identity | Requires stable vertex and edge identities and explicit property behavior |

Use a bounded trial for a proof of concept. Trial jobs are intentionally not
resumable and do not qualify a production migration.

For changing sources, define how writes are fenced or how final deltas are
captured. AGEFreighter checkpoints resume an interrupted ordered migration;
they do not create a shared Neo4j snapshot across all mappings or automatically
capture application changes after the read boundary.

Recommend one of these source-change patterns:

| Pattern | Use when | Tradeoff |
| ------- | -------- | -------- |
| Planned downtime | The accepted downtime covers the final load and verification | Simplest consistency model, highest downtime |
| Repeated upsert or delta | Stable identities and a reliable changed-record boundary exist | Lower downtime, requires reconciliation and idempotent behavior |
| Temporary dual-write | The application can safely write to both systems and reconcile failures | Low cutover downtime, highest application complexity |
| Custom CDC | Business requirements justify a separately engineered change stream | Most flexible, outside AGEFreighter's built-in guarantees |

Base the recommendation on source write activity, RPO, RTO, accepted downtime,
identity stability, and application-change tolerance. Do not imply AGEFreighter
provides CDC or a graph-wide Neo4j snapshot.

## 10. Load, monitor, verify, and report

After the user approves the source and target impact:

```sh
agefreighter load job.yaml
agefreighter status --target job.yaml JOB_ID
agefreighter verify --target job.yaml JOB_ID
agefreighter verify --target job.yaml \
  --counts --integrity --limit 100 JOB_ID
agefreighter report --target job.yaml \
  --format markdown --output migration-report.md JOB_ID
```

Require:

- Successful committed batches with no unexplained rejects.
- Vertex and edge counts by resolved mapping.
- Identity and endpoint integrity.
- Canonical digest or approved golden-query comparisons.
- Application acceptance and workload-specific latency tests.
- Backup, restore, authentication, authorization, and observability evidence.

A clean truncated integrity sample is incomplete, not a pass.

Organize verification into three layers:

1. **Automated core:** compatibility, batch completion, rejects, counts,
   identities, endpoints, digests, schema, and resume fingerprints.
2. **Workload acceptance:** business invariants, critical queries, mutations,
   driver behavior, transactions, and agreed performance targets.
3. **Production hardening:** security, concurrency, capacity, observability,
   backup/restore, failure recovery, cutover, and rollback rehearsal.

Show the concise go/no-go summary first and keep the complete matrix as
drill-down evidence. Record each matrix check as `pass`, `fail`,
`approved-exception`, `not-run`, or `unknown`:

| Area | Required evidence |
| ---- | ----------------- |
| Schema | Labels, relationship types and direction, multi-label behavior, constraints, indexes, uniqueness, and target graph configuration |
| Properties | Types, nulls, arrays and maps, temporal and spatial values, Unicode, large values, precision, and relationship properties |
| Completeness | Counts by mapping, rejected-record reconciliation, stable identity uniqueness, endpoint integrity, and exhaustive digests where practical |
| Topology | Degree distributions, orphan checks, representative paths, disconnected components, and customer-defined graph invariants |
| Business semantics | User-approved workload invariants and normalized golden results for critical reads and mutations |
| Source consistency | Read boundary, source-write fencing or delta capture, reconciliation, and proof that resume inputs still match their fingerprints |
| Queries and application | Complete discoverable query ledger, approved translation records, result shapes, errors, retries, transactions, pooling, and concurrency |
| Performance and capacity | Representative data volume and concurrency, p50/p95/p99 latency, throughput, plans, indexes, resource use, and growth headroom |
| Security | TLS, network controls, secret references, target identities, least privilege, authentication, authorization, and audit evidence |
| Operations | Monitoring, alerts, runbooks, backup and restore drill, failure recovery, retained evidence, and support ownership |
| Cutover and rollback | Final-delta procedure, traffic switch, smoke tests, rollback rehearsal, rollback decision thresholds, and retained backup window |

Before loading, have the user approve workload-specific invariants, critical
queries, performance targets, acceptable exceptions, and the evidence required
for cutover. Standard AGEFreighter checks are necessary but do not replace
these workload-specific acceptance criteria.

Do not declare production readiness while any required check is `fail`,
`not-run`, or `unknown`. A user may explicitly accept a bounded exception, but
record its impact, owner, expiration or follow-up condition, and rollback
implication. Report exact and exhaustive checks separately from sampled checks.

Return this decision card before requesting cutover approval:

```text
Cutover recommendation: <GO | CONDITIONAL GO | NO-GO>
Automated core: <pass/fail summary>
Workload acceptance: <pass/fail summary>
Production hardening: <pass/fail summary>
Approved exceptions: <none or bounded list>
Open blockers/unknowns: <none or list>
Rollback readiness: <ready/not ready and retained state>
Recommended decision: <one action and rationale>
Approval needed: production cutover scope
```

`CONDITIONAL GO` is valid only when the user explicitly accepts every bounded
exception and none invalidates data integrity, recoverability, or an agreed
business invariant.

## 11. Generate the cutover and rollback runbook

Generate `cutover-runbook.md` from the selected source-change strategy, RPO,
RTO, accepted downtime, traffic-switch mechanism, smoke tests, rollback
window, and rollback thresholds. Do not leave the user to assemble operational
steps from the migration report.

The runbook must contain:

- Preconditions and evidence links.
- T-minus preparation, source-write fencing, and final-delta steps.
- Final verification and explicit go/no-go checkpoint.
- Application connection or traffic switch.
- Smoke tests and production monitoring.
- Quantitative or observable rollback triggers.
- Rollback commands and validation.
- Observation window and escalation path.
- Backup-retention and cleanup timing.

Use a relative timeline appropriate to the migration, for example `T-7 days`,
`T-1 day`, `T-30 minutes`, `T0`, `T+30 minutes`, and `T+1 day`. Mark which
steps are automated, which require the user or application team, and which
cannot be reversed.

Request one production-cutover approval covering the finalized runbook,
source-write impact, final delta, traffic switch, monitoring window, and
rollback thresholds. Any material runbook change after approval requires a new
cutover approval.

## 12. Recover or roll back

Inspect durable status before any recovery:

```sh
agefreighter status --target job.yaml JOB_ID
agefreighter resume --job job.yaml JOB_ID
agefreighter verify --target job.yaml JOB_ID
```

Resume only when the source and configuration still satisfy the recorded
fingerprint and ordering contract.

For a committed `replace`, keep the retained backup through the agreed rollback
window. Clean it up only after verification and business acceptance:

```sh
agefreighter cleanup --target job.yaml JOB_ID
```

Do not use manual `drop_graph`, metadata deletion, broad schema cleanup, or
renames of AGEFreighter shadow and backup objects as recovery shortcuts.

For every failure, update the durable state and return:

```text
Failure: <specific operation and error>
Preserved state: <committed batches, checkpoints, active graph, backup>
Resume safety: <safe | unsafe | requires decision> — <reason>
Recommended action: <retry | reconfigure | skip with exception | abort | roll back>
Impact: <data, application, downtime, and rollback implications>
Approval needed: <exact critical gate or none>
```

Do not collapse an error into a generic failure or silently choose a
success-shaped fallback.

## Required final report

Return:

1. Source and target inventory with exact versions and region.
2. AGEFreighter version and compatibility evidence.
3. Approved mappings, stable identities, and consistency limitations.
4. Complete discoverable application dependency ledger and remaining discovery
   blind spots.
5. Cypher translation proposals, individual or batch approval scope, changed
   locations, golden-test evidence, and unresolved APOC, GDS, driver, or
   application gaps.
6. Production verification matrix with exact versus sampled evidence,
   exceptions, profile, load, reject, and performance results.
7. Readiness, pilot, combined dashboard, and go/no-go decisions.
8. Approved cutover and rollback runbook, retained rollback state, observation
   outcome, and cleanup decision.
9. Unknowns that prevent production qualification.

## Sources

- [AGEFreighter repository](https://github.com/rioriost/agefreighter)
- [AGEFreighter 2.4.2 release notes](https://github.com/rioriost/agefreighter/blob/main/docs/releases/2.4.2.md)
- [AGEFreighter compatibility matrix](https://github.com/rioriost/agefreighter/blob/main/docs/reference/compatibility.md)
- [AGEFreighter configuration reference](https://github.com/rioriost/agefreighter/blob/main/docs/reference/configuration.md)
- [AGEFreighter operations guide](https://github.com/rioriost/agefreighter/blob/main/docs/reference/operations.md)
- [Apache AGE on Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/azure-ai/generative-ai-age-overview)
- [Apache AGE on Azure HorizonDB](https://learn.microsoft.com/en-us/azure/horizondb/graph/age-overview)
