---
name: networking-ssl
description: "Configure SSL/TLS, private endpoints, VNet integration, and firewall rules for Azure Database for PostgreSQL Flexible Server"
version: "1.0.0"
tags: [azure, postgresql, ssl, tls, private-endpoint, vnet, firewall, networking]
execution_mode: control-plane
requires_confirmation: true
platform_scope: azure-postgresql
---

# Networking and SSL

## When to Use

**Trigger when:**
- User asks about SSL certificate configuration or sslmode
- User needs private endpoint or VNet integration
- User asks about firewall rules or IP allowlisting
- Error: "SSL connection is required" or certificate verification failures
- User wants to restrict network access to their PostgreSQL server

**Do NOT use when:**
- User needs authentication/identity setup (use `azure-postgresql/entra-id-auth/`)
- User asks about connection pooling (use `azure-postgresql/connection-pooling/`)
- User needs general connection troubleshooting (use `postgresql/connection-management/`)

**Overlaps with:**
- `azure-postgresql/entra-id-auth/` (both are security-related)
- `azure-postgresql/provisioning/` (networking chosen at provisioning)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- `az CLI` authenticated with Contributor role
- Network planning decisions (public vs private access)

## Instructions

**Step 1: Choose network access mode**

| Mode | Use Case | Connectivity |
|------|----------|-------------|
| Public access + firewall | Dev/test, simple apps | Internet with IP rules |
| Private access (VNet) | Production | VNet-injected, no public IP |
| Private endpoint | Hybrid | Private IP in your VNet |

**Step 2: Configure SSL (always required)**

```bash
# SSL is enforced by default. Verify:
az postgres flexible-server parameter show \
    --resource-group myRG --server-name myserver \
    --name require_secure_transport

# Connection string with SSL
psql "host=myserver.postgres.database.azure.com dbname=mydb \
    user=myadmin sslmode=verify-full \
    sslrootcert=DigiCertGlobalRootCA.crt.pem"
```

**Step 3: Download Azure root CA certificate**

```bash
# Required for sslmode=verify-full
curl -o DigiCertGlobalRootCA.crt.pem \
    https://dl.cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem
```

**Step 4: Add firewall rule (public access)**

```bash
az postgres flexible-server firewall-rule create \
    --resource-group myRG --name myserver \
    --rule-name AllowMyIP \
    --start-ip-address 203.0.113.10 \
    --end-ip-address 203.0.113.10
```

**Step 5: Create private endpoint (private access)**

```bash
az network private-endpoint create \
    --resource-group myRG --name myserver-pe \
    --vnet-name myVNet --subnet mySubnet \
    --private-connection-resource-id $(az postgres flexible-server show \
        --resource-group myRG --name myserver --query id -o tsv) \
    --group-ids postgresqlServer \
    --connection-name myserver-connection
```

## Common Mistakes

1. **sslmode=disable**: Never disable SSL. Azure enforces it by default. Use `sslmode=require` minimum, `verify-full` for production
2. **Wrong CA certificate**: Azure uses DigiCert Global Root CA, not the old Baltimore root
3. **Firewall blocks after VNet**: Once VNet-integrated, firewall rules do not apply. Access is VNet-only
4. **403/PermissionDenied**: Network operations need Contributor role. Private endpoints also need Network Contributor on the VNet
5. **Allow Azure services**: The "Allow access from Azure services" checkbox opens access to ALL Azure IPs, not just yours

## Verification

```bash
# Test SSL connection
psql "host=myserver.postgres.database.azure.com sslmode=verify-full \
    sslrootcert=DigiCertGlobalRootCA.crt.pem user=myadmin dbname=postgres" \
    -c "SELECT ssl_is_used();"

# List firewall rules
az postgres flexible-server firewall-rule list \
    --resource-group myRG --name myserver -o table
```

## Failure Recovery

- **Certificate error**: Download fresh DigiCert root CA. Old Baltimore cert was retired
- **Cannot connect after VNet**: Ensure client is in the same VNet or has peering/VPN configured
- **"no pg_hba.conf entry"**: Add client IP to firewall rules or verify private endpoint DNS resolution
