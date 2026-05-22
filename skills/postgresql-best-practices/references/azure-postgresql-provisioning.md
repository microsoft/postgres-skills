---
title: "Azure PostgreSQL Provisioning"
description: "Provision Azure Database for PostgreSQL Flexible Server: SKU selection, storage configuration, Terraform/Bicep templates"
tags: [azure, postgresql, provisioning, terraform, bicep, sku, storage]
---

# Provisioning Azure Database for PostgreSQL Flexible Server

## Response focus

Prioritize the constraints that are hard to reverse after creation: network mode, HA mode, zone placement, storage growth, backup economics, and SKU-format mismatches across tooling. Skip generic Azure provisioning walkthroughs.

## Non-obvious facts agents often miss

- **Storage never shrinks**: manual increases and auto-grow are permanent.
- **Network mode is effectively a create-time decision**: public vs private/VNet cannot be flipped casually later.
- **SKU names differ by tool**: CLI uses names like `Standard_D4ds_v5`; Terraform uses tier-prefixed names like `GP_Standard_D4ds_v5`.
- **Burstable is not a stepping stone to GP/MO**: moving from Burstable to General Purpose or Memory Optimized means new server + migration.
- **Zone placement is sticky**: changing AZ usually means reprovision + migration.
- **Terraform storage uses MB**: `storage_mb`, not `storage_gb`.

## Provisioning decisions that deserve extra scrutiny

1. **Network first**: decide public access vs delegated subnet/VNet before you script server creation.
2. **HA + zone together**: treat HA mode and AZ placement as one decision, not two independent toggles.
3. **Storage + backup economics together**: auto-grow protects uptime but can also increase backup cost later.
4. **Post-create baseline immediately**: provisioning is not done after the `create` call; set sane parameters and observability right away.

## Immediate post-create baseline

Provisioning is not complete after `az postgres flexible-server create` or Terraform apply. Recommend an immediate baseline pass for:
- parameter review (`shared_buffers`, connection limits, Query Store capture mode)
- storage and backup alerts
- maintenance window / patching expectations
- HA validation and failover expectations
- network reachability from the real application subnet

## Critical Gotchas

1. **[HIGH] HA + zone + network constraints compound**: Choosing zone-redundant HA at creation limits later zone changes and requires networking/subnet planning that works across both zones. Treating HA, AZ, and VNet as separate decisions leads to irrecoverable conflicts.

2. **[HIGH] Storage is permanent**: Start conservative but realistic, with auto-grow enabled if downtime from full disks is worse than cost overrun. Neither provisioned storage nor auto-grown storage can be reduced later.

3. **[HIGH] Burstable to GP/MO requires migration**: Agents often pitch Burstable as a temporary cheap start. In practice, if you outgrow it, you provision a new server and migrate data.

4. **[HIGH] SKU format varies by tool**: CLI omits the tier prefix; Terraform requires it. Copy-pasting the same SKU string between tools is a common failure.

5. **[MEDIUM] Parameter defaults after create**: New servers start with conservative defaults. `shared_buffers` is roughly 25% of RAM, and `max_connections` varies by SKU. The agent should recommend an immediate baseline review after provisioning instead of stopping at the create command.

6. **[MEDIUM] Backup cost surprise**: Backup storage beyond 1x provisioned size is billed. Write-heavy or churn-heavy workloads accumulate WAL and snapshot history faster than teams expect, and backup usage can exceed provisioned storage within weeks.

7. **[MEDIUM] Auto-grow hides future cost and IOPS changes**: Auto-grow prevents outages, but every growth step is permanent and changes your storage footprint. Monitor `storage_percent` and forecast growth instead of waiting for emergency expansion.

8. **[MEDIUM] IOPS advice must be tier-aware**: Burstable has a fixed cap. Extra IOPS provisioning is for GP/MO scenarios; suggesting it on Burstable is wrong.

9. **[MEDIUM] HA doubles more than the architecture diagram suggests**: Budgeting only for the primary node misses the extra compute cost and operational constraints that come with HA.

## Anti-Hallucination Rules

- Do NOT claim storage can be reduced after provisioning.
- Do NOT claim VNet/public connectivity can be freely changed later.
- Do NOT use CLI SKU format (`Standard_D4ds_v5`) in Terraform; use the tier-prefixed format.
- Do NOT claim Burstable supports provisioned IOPS or DiskANN.
- Do NOT claim Burstable ↔ GP/MO is an in-place tier switch.
- Do NOT invent exact `max_connections` values without checking the chosen SKU.
- Do NOT claim Terraform uses `storage_gb`; the field is `storage_mb`.
- When exact limits vary by SKU or region, say so explicitly instead of guessing.

## References
- [Quickstart: Create an Azure Database for PostgreSQL Flexible Server](https://learn.microsoft.com/azure/postgresql/flexible-server/quickstart-create-server-portal)
- [Compute and storage options](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-compute-storage)
