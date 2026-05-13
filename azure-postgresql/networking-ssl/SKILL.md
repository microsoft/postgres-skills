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

1. **DigiCert CA, not Baltimore**: Azure Flexible Server uses DigiCert Global Root G2 CA since 2022. Old Baltimore CyberTrust Root is deprecated. Download: `https://dl.cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem`. Using old cert gives `SSL certificate verify failed`
2. **VNet disables firewall completely**: Once private access (VNet integration) is enabled, ALL firewall rules are ignored (including "Allow Azure services"). Access is VNet-only. Cannot have hybrid (some firewall + VNet)
3. **Private DNS zone requirement**: VNet-integrated servers require a Private DNS zone (e.g., `privatelink.postgres.database.azure.com`) linked to the VNet. Without it, hostname resolution fails even though network connectivity exists
4. **Private DNS zone naming**: Zone MUST be `<servername>.private.postgres.database.azure.com` or `privatelink.postgres.database.azure.com`. Custom zone names break Azure's automatic DNS record management
5. **"Allow Azure services" is wider than expected**: This checkbox allows traffic from ANY Azure subscription's public IPs, not just your resources. Use Private Endpoints or VNet rules for isolation. Only enable temporarily for Azure Data Factory/Functions without VNet integration
6. **Cross-VNet connectivity**: Two VNet-integrated servers in different VNets cannot connect by default. Requires VNet peering + DNS forwarding. For cross-region, use Global VNet peering (additional latency)
7. **`verify-full` connection string**: `sslmode=verify-full sslrootcert=/path/to/DigiCertGlobalRootG2.crt.pem` — the hostname in the cert matches `*.postgres.database.azure.com`. Custom server names via CNAME still validate against the Azure-issued cert's SAN
8. **TLS version enforcement**: Azure enforces TLS 1.2 minimum. Clients using TLS 1.0/1.1 get connection refused. Check client library TLS support. Python psycopg2 on older systems may need `ssl_context` configuration

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
