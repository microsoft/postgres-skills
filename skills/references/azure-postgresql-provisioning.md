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

> **âš ï¸ AZURE GATE:** This reference contains Azure Database for PostgreSQL-specific guidance. Before applying any operational steps, confirm the target is Azure by calling `pgsql_get_server_capabilities` and verifying `isAzure: true`. If the connection is NOT Azure, use the corresponding generic postgresql-* reference instead.

# Provisioning

## Prerequisites

- Azure subscription with Contributor role
- Decision on: region, SKU tier, storage size, HA requirement

## Instructions

**Step 1: Choose SKU tier**

| Tier | vCores | Use Case | Max Storage |
|------|--------|----------|-------------|
| Burstable (B) | 1-20 | Dev/test, low traffic | 32 TB |
| General Purpose (D) | 2-96 | Production OLTP | 32 TB |
| Memory Optimized (E) | 2-96 | Analytics, caching | 32 TB |

**Step 2: Provision with az CLI**

```bash
az postgres flexible-server create \
    --resource-group myRG \
    --name myserver \
    --location eastus \
    --sku-name Standard_D4ds_v5 \
    --storage-size 128 \
    --version 16 \
    --admin-user myadmin \
    --admin-password '<SECURE_PASSWORD>' \
    --tier GeneralPurpose
```

**Step 3: Terraform example**

```hcl
resource "azurerm_postgresql_flexible_server" "main" {
  name                = "myserver"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  version             = "16"
  sku_name            = "GP_Standard_D4ds_v5"
  storage_mb          = 131072  # 128 GB
  
  administrator_login    = "myadmin"
  administrator_password = var.admin_password
  
  zone = "1"
}
```

> WARNING: Storage size can only be increased, never decreased. Choose initial size carefully.

### Verify

```bash
# Confirm server is ready
az postgres flexible-server show --resource-group myRG --name myserver \
    --query "{state:state, version:version, sku:sku.name, storage:storage.storageSizeGb}"
```

## Common Mistakes

1. **[CRITICAL] Storage immutability**: Storage only scales UP. Once you provision 256 GB, you cannot shrink to 128 GB. Overprovision storage leads to permanent cost. Start conservative and scale up as needed (auto-grow handles this if enabled)

   Ã¢ÂÅ’ Wrong:
   ```bash
   # Provisioned 512 GB "just in case" Ã¢â‚¬â€ cannot ever reduce
   az postgres flexible-server create --storage-size 512
   # Later: az postgres flexible-server update --storage-size 128
   # ERROR: storage size can only be increased
   ```

   Ã¢Å“â€¦ Right:
   ```bash
   # Start conservative, enable auto-grow
   az postgres flexible-server create --storage-size 64 --storage-auto-grow Enabled
   # Storage grows automatically when needed Ã¢â‚¬â€ but never shrinks
   ```

2. **[HIGH] SKU format divergence**: CLI uses `Standard_D4ds_v5`. Terraform uses `GP_Standard_D4ds_v5` (tier prefix: B_ for Burstable, GP_ for General Purpose, MO_ for Memory Optimized). ARM templates use yet another format. Always check provider docs

   Ã¢ÂÅ’ Wrong:
   ```hcl
   # Terraform with CLI format Ã¢â‚¬â€ fails validation
   sku_name = "Standard_D4ds_v5"
   ```

   Ã¢Å“â€¦ Right:
   ```hcl
   # Terraform requires tier prefix
   sku_name = "GP_Standard_D4ds_v5"  # GP_ = General Purpose
   ```

3. **[HIGH] IOPS tiers and provisioning**: Base IOPS = 3 IOPS/GB (min 100, max 20K for premium). Additional provisioned IOPS available on General Purpose and Memory Optimized. Use `az postgres flexible-server update --iops 5000`. Burstable tier has fixed IOPS cap
4. **[HIGH] HA must be planned at creation**: Zone-redundant HA can be enabled post-creation but requires downtime (server restart). Same-zone HA can be added anytime. Budget for 2x compute cost from day one if HA is required
5. **[HIGH] Auto-grow behavior**: When enabled, storage auto-grows by the greater of 5GB or 10% of current storage when free space drops below 10%. Growth is permanent (cannot shrink). Monitor `storage_percent` metric to avoid surprise growth
6. **[CRITICAL] Compute tier restrictions**: Cannot change between Burstable and General Purpose/Memory Optimized in-place. Must create new server and migrate. Plan tier choice at provisioning time

   Ã¢ÂÅ’ Wrong:
   ```bash
   # Cannot switch from Burstable to General Purpose in-place
   az postgres flexible-server update --name myserver --sku-name Standard_D4ds_v5
   # ERROR: cannot change compute tier from Burstable to GeneralPurpose
   ```

   Ã¢Å“â€¦ Right:
   ```bash
   # Create new GP server and migrate data
   az postgres flexible-server create --name myserver-gp --sku-name Standard_D4ds_v5
   # Then use pg_dump/pg_restore to migrate
   ```

7. **[HIGH] Region + availability zone lock-in**: Server is pinned to its availability zone. Moving to another zone requires new server + migration. Choose zone strategically if using zone-redundant HA (standby goes to a different zone automatically)
8. **[MEDIUM] Backup storage billing**: Backup storage up to 1x provisioned storage is free. Beyond that, billed per-GB/month. With 35-day retention and high churn, backup storage can exceed provisioned storage significantly
9. **[MEDIUM] Provisioning failed**: Check `az monitor activity-log list` for the resource group to identify root cause
10. **[MEDIUM] Wrong SKU selected**: Scale with `az postgres flexible-server update --sku-name <new_sku>` (some changes require restart)
11. **[MEDIUM] Forgot HA at creation**: Enable later with `az postgres flexible-server update --high-availability ZoneRedundant`

## References
- [Quickstart: Create an Azure Database for PostgreSQL Flexible Server](https://learn.microsoft.com/azure/postgresql/flexible-server/quickstart-create-server-portal)
- [Compute and storage options](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-compute-storage)