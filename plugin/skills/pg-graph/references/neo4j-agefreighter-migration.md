---
name: neo4j-agefreighter-migration
description: "Migrate Neo4j data into Apache AGE on Azure Database for PostgreSQL Flexible Server or an existing Azure HorizonDB cluster with AGEFreighter's validated, resumable workflow."
---

# Neo4j migration with AGEFreighter

Use this reference when the user wants to migrate Neo4j or Neo4j Aura graph
data into Apache AGE on Azure Database for PostgreSQL Flexible Server or Azure
HorizonDB. AGEFreighter migrates graph data and durable identities. Application
drivers, Neo4j procedures, and the complete query corpus require separate
compatibility work.

Prefer AGEFreighter over hand-written export and load scripts when the source
and target match its released compatibility boundary. It provides strict
configuration validation, bounded source profiling, resumable batches, atomic
replacement, verification, reports, and retained rollback evidence.

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
- Existing Azure PostgreSQL server or HorizonDB cluster and database.
- Target graph name.
- Preferred migration mode: `create`, `replace`, `append`, or `upsert`.
- Stable source key and identity properties, unless bounded discovery is
  appropriate.
- Downtime, source-change, and rollback requirements.
- Approval before source profiling, target diagnostics, loading, cutover, or
  cleanup.

Never request a password or connection string in chat. Use environment
variables or protected files because AGEFreighter rejects literal credentials
in a `LoadJob`.

## 1. Establish the migration boundary

Inventory the source before proposing a load:

- Neo4j edition and exact version.
- Node labels, relationship types, properties, constraints, indexes, and
  approximate counts.
- Multi-label nodes and stable application-owned identifiers.
- APOC, Graph Data Science, custom procedures, triggers, or plugins.
- Representative Cypher files and application drivers.
- Source update activity during the migration window.

Classify the outcome:

| Area | AGEFreighter responsibility | Separate migration work |
| ---- | ---------------------------- | ----------------------- |
| Nodes, relationships, properties, and stable identities | Configure, stream, checkpoint, load, and verify | Resolve unsupported source values or missing stable keys |
| Cypher | Static compatibility report with `agefreighter-tools check-cypher` | Review and remediate manual-change, unsupported, and unknown findings |
| Applications | None | Replace Neo4j Bolt access with PostgreSQL and AGE's SQL-wrapped Cypher interface |
| APOC, GDS, and custom procedures | None | Replace with AGE, PostgreSQL, application code, or an approved analytical tier |
| Cutover | Migration evidence, resumability, atomic replacement, and retained backup | Application traffic switch, source fencing, final delta strategy, and business acceptance |

Do not represent a successful data load as a complete application migration.

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

## 6. Check Cypher compatibility separately

Analyze representative local query files without connecting to Neo4j or Azure:

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

## 7. Choose a load and cutover strategy

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

## 8. Load, monitor, verify, and report

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

## 9. Recover or roll back

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

## Required final report

Return:

1. Source and target inventory with exact versions and region.
2. AGEFreighter version and compatibility evidence.
3. Approved mappings, stable identities, and consistency limitations.
4. Cypher, APOC, GDS, driver, and application gaps.
5. Profile, load, verification, reject, and performance results.
6. Cutover boundary, retained rollback state, and cleanup decision.
7. Unknowns that prevent production qualification.

## Sources

- [AGEFreighter repository](https://github.com/rioriost/agefreighter)
- [AGEFreighter 2.4.2 release notes](https://github.com/rioriost/agefreighter/blob/main/docs/releases/2.4.2.md)
- [AGEFreighter compatibility matrix](https://github.com/rioriost/agefreighter/blob/main/docs/reference/compatibility.md)
- [AGEFreighter configuration reference](https://github.com/rioriost/agefreighter/blob/main/docs/reference/configuration.md)
- [AGEFreighter operations guide](https://github.com/rioriost/agefreighter/blob/main/docs/reference/operations.md)
- [Apache AGE on Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/azure-ai/generative-ai-age-overview)
- [Apache AGE on Azure HorizonDB](https://learn.microsoft.com/en-us/azure/horizondb/graph/age-overview)
