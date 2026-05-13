---
name: provisioning
description: "Provision Azure Database for PostgreSQL Flexible Server: SKU selection, storage configuration, Terraform/Bicep templates"
version: "1.0.0"
tags: [azure, postgresql, provisioning, terraform, bicep, sku, storage]
execution_mode: control-plane
requires_confirmation: true
platform_scope: azure-postgresql
---

# Provisioning

## When to Use

**Trigger when:**
- User asks to create a new Azure PostgreSQL server
- User needs to choose between Burstable/General Purpose/Memory Optimized SKUs
- User asks about Terraform or Bicep for PostgreSQL deployment
- User asks about storage configuration, IOPS, or scaling
- User mentions "Flexible Server" provisioning

**Do NOT use when:**
- User has an existing server and needs configuration changes (use `azure-postgresql/intelligent-tuning/`)
- User needs networking/VNet setup (use `azure-postgresql/networking-ssl/`)
- User asks about Single Server (deprecated; recommend migration to Flexible Server)

**Overlaps with:**
- `azure-postgresql/networking-ssl/` (networking is part of provisioning but has its own skill)
- `azure-postgresql/ha-disaster-recovery/` (HA is enabled at provisioning time)

## Prerequisites

- Azure subscription with Contributor role
- `az CLI` installed and authenticated
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

## Common Mistakes

1. **Storage immutability**: Storage only scales UP. Once you provision 256 GB, you cannot shrink to 128 GB. Overprovision storage leads to permanent cost. Start conservative and scale up as needed (auto-grow handles this if enabled)
2. **SKU format divergence**: CLI uses `Standard_D4ds_v5`. Terraform uses `GP_Standard_D4ds_v5` (tier prefix: B_ for Burstable, GP_ for General Purpose, MO_ for Memory Optimized). ARM templates use yet another format. Always check provider docs
3. **IOPS tiers and provisioning**: Base IOPS = 3 IOPS/GB (min 100, max 20K for premium). Additional provisioned IOPS available on General Purpose and Memory Optimized. Use `az postgres flexible-server update --iops 5000`. Burstable tier has fixed IOPS cap
4. **HA must be planned at creation**: Zone-redundant HA can be enabled post-creation but requires downtime (server restart). Same-zone HA can be added anytime. Budget for 2x compute cost from day one if HA is required
5. **Auto-grow behavior**: When enabled, storage auto-grows by the greater of 5GB or 10% of current storage when free space drops below 10%. Growth is permanent (cannot shrink). Monitor `storage_percent` metric to avoid surprise growth
6. **Compute tier restrictions**: Cannot change between Burstable and General Purpose/Memory Optimized in-place. Must create new server and migrate. Plan tier choice at provisioning time
7. **Region + availability zone lock-in**: Server is pinned to its availability zone. Moving to another zone requires new server + migration. Choose zone strategically if using zone-redundant HA (standby goes to a different zone automatically)
8. **Backup storage billing**: Backup storage up to 1x provisioned storage is free. Beyond that, billed per-GB/month. With 35-day retention and high churn, backup storage can exceed provisioned storage significantly

## Verification

```bash
# Confirm server is ready
az postgres flexible-server show --resource-group myRG --name myserver \
    --query "{state:state, version:version, sku:sku.name, storage:storage.storageSizeGb}"
```

## Failure Recovery

- **Provisioning failed**: Check `az monitor activity-log list` for the resource group
- **Wrong SKU**: Scale with `az postgres flexible-server update --sku-name <new_sku>` (some changes require restart)
- **Forgot HA**: Enable later with `az postgres flexible-server update --high-availability ZoneRedundant`
