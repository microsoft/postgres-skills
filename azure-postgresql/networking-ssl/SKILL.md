---
name: networking-ssl
description: "Configure SSL/TLS, private endpoints, VNet integration, and firewall rules for Azure Database for PostgreSQL Flexible Server"
tags: [azure, postgresql, ssl, tls, private-endpoint, vnet, firewall, networking]
platform_scope: azure-postgresql
activation:
  user_intent:
    - "configure SSL certificate or sslmode for Azure PostgreSQL"
    - "set up private endpoint or VNet integration"
    - "add firewall rules or IP allowlisting"
    - "fix SSL connection is required error or certificate verification failures"
    - "restrict network access to PostgreSQL server"
  technical_keywords:
    - sslmode
    - verify-full
    - require_secure_transport
    - DigiCertGlobalRootCA
    - DigiCertGlobalRootG2
    - private-endpoint
    - firewall-rule
    - vnet
    - privatelink.postgres.database.azure.com
    - "SSL connection is required"
    - "SSL certificate verify failed"
    - TLS 1.2
  exclusion_conditions:
    - "when user needs authentication/identity setup, use `azure-postgresql/entra-id-auth/` instead"
    - "when user asks about connection pooling, use `azure-postgresql/connection-pooling/` instead"
    - "when user needs general connection troubleshooting, use `postgresql/connection-management/` instead"
  adjacent_skills:
    - "`azure-postgresql/entra-id-auth/`"
    - "`azure-postgresql/provisioning/`"
---

# Networking and SSL

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
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

### Verify

```bash
# Test SSL connection
psql "host=myserver.postgres.database.azure.com sslmode=verify-full \
    sslrootcert=DigiCertGlobalRootCA.crt.pem user=myadmin dbname=postgres" \
    -c "SELECT ssl_is_used();"

# List firewall rules
az postgres flexible-server firewall-rule list \
    --resource-group myRG --name myserver -o table
```

## Common Mistakes

1. **[CRITICAL] DigiCert CA, not Baltimore**: Azure Flexible Server uses DigiCert Global Root G2 CA since 2022. Old Baltimore CyberTrust Root is deprecated. Download: `https://dl.cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem`. Using old cert gives `SSL certificate verify failed`

   ❌ Wrong:
   ```bash
   psql "sslmode=verify-full sslrootcert=BaltimoreCyberTrustRoot.crt.pem ..."
   # ERROR: SSL certificate verify failed — cert expired/deprecated
   ```

   ✅ Right:
   ```bash
   curl -o DigiCertGlobalRootG2.crt.pem https://dl.cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem
   psql "sslmode=verify-full sslrootcert=DigiCertGlobalRootG2.crt.pem ..."
   ```

2. **[CRITICAL] VNet disables firewall completely**: Once private access (VNet integration) is enabled, ALL firewall rules are ignored (including "Allow Azure services"). Access is VNet-only. Cannot have hybrid (some firewall + VNet)

   ❌ Wrong:
   ```bash
   # VNet-integrated server — adding firewall rules has NO effect
   az postgres flexible-server firewall-rule create --name myserver \
       --rule-name AllowMyIP --start-ip-address 203.0.113.10 --end-ip-address 203.0.113.10
   # Rule is created but NEVER evaluated — VNet-only access enforced
   ```

   ✅ Right:
   ```bash
   # For VNet-integrated servers, connect FROM within the VNet
   # Or use VNet peering / VPN for external access
   ```

3. **[HIGH] Private DNS zone requirement**: VNet-integrated servers require a Private DNS zone (e.g., `privatelink.postgres.database.azure.com`) linked to the VNet. Without it, hostname resolution fails even though network connectivity exists
4. **[HIGH] Private DNS zone naming**: Zone MUST be `<servername>.private.postgres.database.azure.com` or `privatelink.postgres.database.azure.com`. Custom zone names break Azure's automatic DNS record management
5. **[CRITICAL] "Allow Azure services" is wider than expected**: This checkbox allows traffic from ANY Azure subscription's public IPs, not just your resources. Use Private Endpoints or VNet rules for isolation. Only enable temporarily for Azure Data Factory/Functions without VNet integration
6. **[HIGH] Cross-VNet connectivity**: Two VNet-integrated servers in different VNets cannot connect by default. Requires VNet peering + DNS forwarding. For cross-region, use Global VNet peering (additional latency)
7. **[HIGH] `verify-full` connection string**: `sslmode=verify-full sslrootcert=/path/to/DigiCertGlobalRootG2.crt.pem` — the hostname in the cert matches `*.postgres.database.azure.com`. Custom server names via CNAME still validate against the Azure-issued cert's SAN

   ❌ Wrong:
   ```bash
   psql "sslmode=require ..."  # Encrypts but does NOT verify server identity
   ```

   ✅ Right:
   ```bash
   psql "sslmode=verify-full sslrootcert=DigiCertGlobalRootG2.crt.pem ..."
   # Encrypts AND verifies server certificate — prevents MITM
   ```

8. **[HIGH] TLS version enforcement**: Azure enforces TLS 1.2 minimum. Clients using TLS 1.0/1.1 get connection refused. Check client library TLS support. Python psycopg2 on older systems may need `ssl_context` configuration
9. **[HIGH] Certificate error after migration**: Download fresh DigiCert root CA. The old Baltimore CyberTrust Root cert was retired in 2022. Update `sslrootcert` path in all connection strings
10. **[HIGH] Cannot connect after VNet integration**: Ensure client is in the same VNet or has peering/VPN configured. VNet integration removes all public access
11. **[MEDIUM] "no pg_hba.conf entry" error**: Add client IP to firewall rules (for public access) or verify private endpoint DNS resolution is working correctly (for private access)

## References
- [Networking overview for Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking)
- [TLS and SSL in Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking-ssl-tls)
