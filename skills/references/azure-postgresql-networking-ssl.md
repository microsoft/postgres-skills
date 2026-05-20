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
  adjacent_skills:
    - "`azure-postgresql/entra-id-auth/`"
    - "`azure-postgresql/provisioning/`"
---

# Networking and SSL

> **Response focus:** Prioritize VNet-is-permanent, DigiCert G2 (not Baltimore), and "Allow Azure services" scope. Avoid explaining basic TLS concepts or generic firewall rules.

> **Shell execution:** Firewall and private endpoint commands are az CLI. Execute directly via shell if available. No confirmation needed (these are additive, not destructive).

## Key Facts (what models get wrong)

| Fact | Detail |
|------|--------|
| VNet choice is permanent | Set at server creation. Cannot switch public/private later (requires recreation) |
| SSL always enforced | `require_secure_transport = off` is blocked on Azure |
| Root CA | DigiCert Global Root G2 (since Oct 2022). Baltimore CyberTrust Root is EXPIRED |
| Min TLS | 1.2 enforced. TLS 1.0/1.1 = connection refused |
| "Allow Azure services" | Opens to ANY Azure public IP (all subscriptions), not just yours |
| VNet = no firewall | VNet-integrated servers ignore all firewall rules |
| Private DNS required | VNet servers need `privatelink.postgres.database.azure.com` zone linked to client VNet |
| Max firewall rules | 128 per server |

## Decision Matrix

| Factor | Public + Firewall | VNet Integration | Private Endpoint |
|--------|------------------|-----------------|-----------------|
| Setup | Low | Medium | High |
| Security | IP-based | Network-level | Network-level + DNS |
| Best for | Dev/test | Production (single VNet) | Multi-VNet, hub-spoke |
| Add after creation? | Yes | No (creation only) | Yes |
| Cost | Free | Free | ~$7.30/month |

## Common Mistakes

1. **[CRITICAL] Baltimore cert expired**: Use `DigiCertGlobalRootG2.crt.pem` (download from `dl.cacerts.digicert.com`). Baltimore CyberTrust Root expired 2022

   ❌ Wrong:
   ```
   sslrootcert=BaltimoreCyberTrustRoot.crt.pem
   ```

   ✅ Right:
   ```
   sslmode=verify-full sslrootcert=DigiCertGlobalRootG2.crt.pem
   ```

2. **[HIGH] sslmode=require vs verify-full**: `require` encrypts but does NOT verify server identity. Use `verify-full` in production

   ❌ Wrong:
   ```
   psql "host=myserver.postgres.database.azure.com dbname=mydb sslmode=require"
   ```

   ✅ Right:
   ```
   psql "host=myserver.postgres.database.azure.com dbname=mydb sslmode=verify-full sslrootcert=DigiCertGlobalRootG2.crt.pem"
   ```

3. **[HIGH] VNet kills firewall rules**: Once VNet-integrated, firewall rules are never evaluated even if they exist

4. **[HIGH] Private DNS zone setup for Private Endpoint**:

   ```bash
   # Create Private DNS zone
   az network private-dns zone create --resource-group myRG \
       --name privatelink.postgres.database.azure.com

   # Link DNS zone to client VNet
   az network private-dns zone vnet-link create --resource-group myRG \
       --zone-name privatelink.postgres.database.azure.com \
       --name myDNSLink --virtual-network myClientVNet --registration-enabled false

   # Create private endpoint
   az network private-endpoint create --resource-group myRG \
       --name myPE --vnet-name myVNet --subnet mySubnet \
       --private-connection-resource-id "/subscriptions/.../flexibleServers/myserver" \
       --group-id postgresqlServer --connection-name myConn
   ```

5. **[MEDIUM] Cross-VNet connectivity**: Requires VNet peering + DNS forwarding. Cross-region adds 2-10ms latency

6. **[MEDIUM] "no pg_hba.conf entry" on Azure**: On public access = add IP to firewall. On private = check DNS resolution (likely `privatelink.postgres.database.azure.com` zone not linked)

   ```bash
   # Add firewall rule for public access
   az postgres flexible-server firewall-rule create --resource-group myRG \
       --name myserver --rule-name allowMyIP --start-ip-address 1.2.3.4 --end-ip-address 1.2.3.4

   # Verify DNS resolution for private access
   nslookup myserver.postgres.database.azure.com
   # Should resolve to private IP (10.x.x.x), not public IP
   ```

7. **[HIGH] Exact error recognition**: `FATAL: no pg_hba.conf entry for host "X.X.X.X"` = IP is missing from firewall rules (public access) or DNS is still resolving to a public address instead of the private IP (private access). `SSL connection is required` = client is using `sslmode=disable` or `prefer`; set `sslmode=require` at minimum

8. **[HIGH] Cannot switch public/private after creation**:

   ❌ Wrong:
   ```bash
   # DOES NOT WORK — network access type is immutable
   az postgres flexible-server update --name myserver --public-access Disabled
   ```

   ✅ Right:
   ```bash
   # Must create a new server with desired network access
   az postgres flexible-server create --name myserver-new --vnet myVNet --subnet mySubnet ...
   # Then migrate data from old server
   ```

9. **[HIGH] Client CA bundle location varies by OS/container**: Alpine uses `/etc/ssl/certs/ca-certificates.crt`, Debian uses `/etc/ssl/certs/`, and Windows uses the cert store. Give the `sslrootcert` path for the actual runtime
10. **[MEDIUM] Hostname mismatch with private endpoints**: Keep `sslmode=verify-full` but connect with the original server FQDN, not the `privatelink` hostname. The cert is issued for `*.postgres.database.azure.com`
11. **[MEDIUM] Corporate proxy/firewall blocks port 5432**: Many enterprise networks only allow 443 outbound. Test with `openssl s_client -connect server:5432` and recommend Private Link or VPN if blocked

## Anti-Hallucination Rules

- Cannot switch public/private access after creation
- Cannot disable SSL on Azure Flexible Server
- Baltimore CyberTrust Root cert does NOT work (expired)
- "Allow Azure services" is NOT scoped to your subscription

## References
- [Networking overview](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking)
- [TLS and SSL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking-ssl-tls)