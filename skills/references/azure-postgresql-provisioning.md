---
name: provisioning
description: "Provision Azure Database for PostgreSQL Flexible Server: SKU selection, storage configuration, Terraform/Bicep templates"
tags: [azure, postgresql, provisioning, terraform, bicep, sku, storage]
platform_scope: azure-postgresql
activation:
  user_intent:
    - create a new Azure PostgreSQL server
    - choose between Burstable, General Purpose, or Memory Optimized SKUs
    - deploy PostgreSQL with Terraform or Bicep
    - configure storage, IOPS, or scaling for Flexible Server
    - provision a new Flexible Server
  technical_keywords:
    - az postgres flexible-server create
    - azurerm_postgresql_flexible_server
    - Standard_D4ds_v5
    - GP_Standard_D4ds_v5
    - storage-size
    - sku-name
    - --tier
  exclusion_conditions:
    - "when user has an existing server needing configuration changes, use `azure-postgresql/intelligent-tuning/` instead"
    - "when user needs networking/VNet setup, use `azure-postgresql/networking-ssl/` instead"
    - "when user asks about Single Server (deprecated), recommend migration to Flexible Server"
  adjacent_skills:
    - "`azure-postgresql/networking-ssl/`"
    - "`azure-postgresql/ha-disaster-recovery/`"
---

## Key Facts (what models get wrong)

> **Response focus:** Prioritize storage-can't-shrink, VNet-is-permanent, SKU-format-varies-by-tool, and tier change restrictions. Avoid explaining basic Azure resource creation or generic cloud provisioning.

> **Shell execution:** All commands in this reference are az CLI. Execute directly via shell if available. No confirmation needed (server creation is not destructive).

| Fact | Detail |
|------|--------|
| Storage cannot shrink | Once provisioned or auto-grown, storage only scales UP; never decreases |
| IOPS scale with storage | Base = 3 IOPS/GB (min 100, max 20K premium); additional provisioned IOPS on GP/MO only |
| VNet chosen at creation | Network connectivity (public vs VNet) is set at creation; cannot change later |
| Auto-grow behavior | Grows by greater of 5 GB or 10% when free space < 10%; growth is permanent |
| Tier change restrictions | Cannot switch between Burstable and GP/MO in-place; requires new server + migration |
| SKU format differs per tool | CLI: `Standard_D4ds_v5`, Terraform: `GP_Standard_D4ds_v5` (tier prefix), ARM: different again |
| Terraform resource | `azurerm_postgresql_flexible_server`; `storage_mb` is in MB (131072 = 128 GB) |
| Burstable limitations | Fixed IOPS cap, no DiskANN, no HA pairing with GP/MO |
| Zone lock-in | Server pinned to its AZ; moving zones requires new server + migration |

## Decision Matrix

| Factor | Burstable (B) | General Purpose (D) | Memory Optimized (E) |
|--------|---------------|--------------------|-----------------------|
| vCores | 1-20 | 2-96 | 2-96 |
| Use case | Dev/test, low traffic | Production OLTP | Analytics, caching, large working sets |
| Max storage | 32 TB | 32 TB | 32 TB |
| HA support | Same-zone only | Zone-redundant | Zone-redundant |
| DiskANN | No | Yes | Yes |
| IOPS | Fixed cap | Scalable + provisioned | Scalable + provisioned |
| Tier switching | Cannot switch to GP/MO | Can switch to MO | Can switch to GP |

## Critical Gotchas

1. **Storage is permanent**: Start conservative with auto-grow enabled; you can never reduce storage size
2. **SKU format varies by tool**: CLI omits tier prefix; Terraform requires `GP_`/`B_`/`MO_` prefix; always check provider docs
3. **Burstable to GP requires migration**: Cannot update in-place; must create new server and pg_dump/pg_restore
4. **Auto-grow is irreversible per increment**: Each growth event is permanent; monitor `storage_percent` metric
5. **HA adds 2x compute cost**: Budget from day one if HA is required; zone-redundant HA can be enabled post-creation with downtime
6. **Region + AZ are fixed**: Changing availability zone means creating a new server
7. **Backup storage free tier**: Up to 1x provisioned storage is free; beyond that billed per-GB/month
8. **IOPS on Burstable**: Fixed cap with no option to provision additional IOPS

## Anti-Hallucination Rules

- Do NOT claim storage can be reduced after provisioning
- Do NOT use CLI SKU format (`Standard_D4ds_v5`) in Terraform; must use tier-prefixed format
- Do NOT claim Burstable tier supports DiskANN or provisioned IOPS
- Do NOT claim tier changes between Burstable and GP/MO can be done in-place
- Do NOT claim VNet configuration can be changed after server creation
- Do NOT claim Terraform uses `storage_gb`; the attribute is `storage_mb`
- Do NOT invent exact max_connections values without referencing SKU-specific documentation. Values vary by compute tier and vCore count.
- Do NOT invent SKU names. Valid prefixes: `Standard_B` (Burstable), `Standard_D` (GP), `Standard_E` (MO). Always verify against Azure documentation.
- Do NOT assume Single Server (deprecated) and Flexible Server share the same behavior — they are different products with different APIs, limits, and features.
- Do NOT claim exact IOPS limits without verification — they vary by storage size and tier.
- When uncertain about SKU-specific limits, say "check Azure documentation for your specific SKU" rather than guessing values.

## References
- [Quickstart: Create an Azure Database for PostgreSQL Flexible Server](https://learn.microsoft.com/azure/postgresql/flexible-server/quickstart-create-server-portal)
- [Compute and storage options](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-compute-storage)
