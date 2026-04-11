# Anchor — Operational Flows

## 1. Device Registration (First Boot)

**Pre-condition:** The device has been provisioned with:
- A one-time bootstrap token (24h expiry)
- The Anchor binary (signature verified by OS)
- Tenant ID (embedded in config file)

```
Device                Bootstrap EP       Private CA       Lambda:register     DynamoDB
  │                        │                  │                  │               │
  │ 1. Generate EC keypair │                  │                  │               │
  │    on device           │                  │                  │               │
  │                        │                  │                  │               │
  │ 2. Build CSR           │                  │                  │               │
  │    CN=<deviceId>       │                  │                  │               │
  │    O=<tenantId>        │                  │                  │               │
  │                        │                  │                  │               │
  │──POST /bootstrap/csr──►│                  │                  │               │
  │  {bootstrapToken,      │                  │                  │               │
  │   csr (PEM)}           │                  │                  │               │
  │                        │ Validate token   │                  │               │
  │                        │ (one-time use)   │                  │               │
  │                        │──IssueCert──────►│                  │               │
  │                        │  (CSR, 90d TTL)  │                  │               │
  │                        │◄─────────────────│                  │               │
  │                        │  signedCert.pem  │                  │               │
  │◄───────────────────────│                  │                  │               │
  │  {certificate: PEM}    │                  │                  │               │
  │                        │                  │                  │               │
  │ 3. Store cert in       │                  │                  │               │
  │    platform keystore   │                  │                  │               │
  │                        │                  │                  │               │
  │──POST /v1/devices/register (mTLS)────────►│                  │               │
  │  {tenantId, deviceId,  │                  │                  │               │
  │   hostname, os, arch,  │                  │                  │               │
  │   certThumbprint}      │                  │                  │               │
  │                        │                  │──GetItem────────────────────────►│
  │                        │                  │  Tenants table   │               │
  │                        │                  │◄─────────────────────────────────│
  │                        │                  │  (tenant exists, active)         │
  │                        │                  │──PutItem────────────────────────►│
  │                        │                  │  Devices table   │               │
  │                        │                  │  status=active   │               │
  │                        │                  │◄─────────────────────────────────│
  │◄──────────────────────────────────────────│                  │               │
  │  201 {deviceId,        │                  │                  │               │
  │       groupId}         │                  │                  │               │
  │                        │                  │                  │               │
  │ 4. Persist groupId     │                  │                  │               │
  │    in local config     │                  │                  │               │
  │                        │                  │                  │               │
  │ 5. Begin heartbeat loop│                  │                  │               │
```

**Error paths:**
- Bootstrap token expired or already used → 403, device must be reprovisioned
- Tenant not found → 403, check config
- DynamoDB write conflict (race) → retry with exponential backoff

---

## 2. Agent Update Flow

**Trigger:** Policy endpoint returns a `targetVersion` that differs from the device's currently running version.

```
Device (Anchor)      Lambda:policy       DynamoDB         S3              KMS
  │                       │                  │             │               │
  │──GET /v1/devices/     │                  │             │               │
  │  {id}/policy (mTLS)──►│                  │             │               │
  │                       │──GetItem────────►│             │               │
  │                       │  Devices table   │             │               │
  │                       │◄─────────────────│             │               │
  │                       │──GetItem────────►│             │               │
  │                       │  Groups table    │             │               │
  │                       │◄─────────────────│             │               │
  │                       │──Query GSI──────►│             │               │
  │                       │  GroupIndex      │             │               │
  │                       │◄─────────────────│             │               │
  │                       │  (active policy) │             │               │
  │                       │──GetItem────────►│             │               │
  │                       │  AgentVersions   │             │               │
  │                       │◄─────────────────│             │               │
  │                       │──PresignURL──────────────────────────────────►│
  │                       │  (s3Key, 1h TTL) │             │  (via SDK)    │
  │                       │◄──────────────────────────────────────────────│
  │◄──────────────────────│                  │             │               │
  │  200 {agents:[        │                  │             │               │
  │    {agentId,          │                  │             │               │
  │     targetVersion,    │                  │             │               │
  │     downloadUrl,      │                  │             │               │
  │     sha256,           │                  │             │               │
  │     signatureUrl}]}   │                  │             │               │
  │                       │                  │             │               │
  │ Compare targetVersion │                  │             │               │
  │ vs currentVersion     │                  │             │               │
  │ → update needed       │                  │             │               │
  │                       │                  │             │               │
  │──GET downloadUrl─────────────────────────────────────►│               │
  │◄─────────────────────────────────────────────────────-│               │
  │  binary bytes         │                  │             │               │
  │                       │                  │             │               │
  │──GET signatureUrl────────────────────────────────────►│               │
  │◄──────────────────────────────────────────────────────│               │
  │  cosign bundle        │                  │             │               │
  │                       │                  │             │               │
  │ Verify:               │                  │             │               │
  │  sha256(binary)==sha256│                  │             │               │
  │  KMS signature valid  │                  │             │               │
  │  cosign bundle valid  │                  │             │               │
  │                       │                  │             │               │
  │ Write new binary to   │                  │             │               │
  │ staging path          │                  │             │               │
  │                       │                  │             │               │
  │ Send heartbeat with   │                  │             │               │
  │ updated agentVersions │                  │             │               │
```

---

## 3. Self-Update Flow (Anchor Updating Itself)

The Anchor agent treats itself as a managed agent. The `anchor` agentId in the policy response triggers this flow. Because Anchor cannot replace its own running executable on most platforms, it uses a staged handoff.

```
Anchor (current)            OS              Anchor (new)
  │                          │                   │
  │ 1. Detect self-update    │                   │
  │    (agentId=anchor,      │                   │
  │     targetVersion != me) │                   │
  │                          │                   │
  │ 2. Download + verify     │                   │
  │    new binary to         │                   │
  │    /opt/anchor/anchor.new│                   │
  │    (chmod 0500)          │                   │
  │                          │                   │
  │ 3. Write updater script  │                   │
  │    (systemd oneshot, or  │                   │
  │     launchd plist, or    │                   │
  │     Windows scheduled    │                   │
  │     task) that will:     │                   │
  │     a. Stop anchor.service│                  │
  │     b. mv anchor.new → anchor                │
  │     c. Verify hash again │                   │
  │     d. Start anchor.service                  │
  │                          │                   │
  │ 4. Register the oneshot  │                   │
  │    with init system      │                   │
  │──Trigger oneshot────────►│                   │
  │                          │──Stop anchor──────│ (SIGTERM)
  │ [anchor exits]           │                   │
  │                          │──mv .new → .bin───│
  │                          │──Verify hash──────│
  │                          │──Start anchor─────│
  │                          │                   │──Start up
  │                          │                   │──Self-verify
  │                          │                   │──Register heartbeat
  │                          │                   │  (new version)
```

**Rollback (automatic):** If the new binary fails to start within 60 seconds (monitored by the init system), the updater script restores the previous binary from a backup copy (retained for 24h at `/opt/anchor/anchor.prev`).

---

## 4. Health Reporting

**Steady state:** Every 60 seconds (configurable in local config, minimum 30s).

```
Device              API Gateway       Lambda:heartbeat      SQS         Lambda:health-proc   DynamoDB  CloudWatch
  │                      │                   │               │                  │               │          │
  │ Every 60s:           │                   │               │                  │               │          │
  │──POST /v1/devices/   │                   │               │                  │               │          │
  │  {id}/heartbeat      │                   │               │                  │               │          │
  │  (mTLS)              │                   │               │                  │               │          │
  │  {tenantId,          │                   │               │                  │               │          │
  │   agentVersions,     │                   │               │                  │               │          │
  │   systemInfo,        │                   │               │                  │               │          │
  │   nonce,             │                   │               │                  │               │          │
  │   timestamp}         │                   │               │                  │               │          │
  │                      │──invoke──────────►│               │                  │               │          │
  │                      │                  │               │                  │               │          │
  │                      │                  │ Validate ts   │                  │               │          │
  │                      │                  │ Check nonce   │                  │               │          │
  │                      │                  │──UpdateItem──────────────────────────────────────►│          │
  │                      │                  │  Devices.lastSeen                │               │          │
  │                      │                  │  + nonceHistory                  │               │          │
  │                      │                  │──SendMessage─►│                  │               │          │
  │                      │                  │  (heartbeat   │                  │               │          │
  │                      │                  │   payload)    │                  │               │          │
  │◄─────────────────────│◄─────────────────│               │                  │               │          │
  │  200 {serverTs, ok}  │                   │               │                  │               │          │
  │                      │                   │               │──invoke─────────►│               │          │
  │                      │                   │               │  (async)        │               │          │
  │                      │                   │               │                 │──UpdateItem───►│          │
  │                      │                   │               │                 │  (metrics)    │          │
  │                      │                   │               │                 │──PutMetricData────────────►│
  │                      │                   │               │                 │  (fleet health│          │
  │                      │                   │               │                 │   dashboard)  │          │
```

**Stale device detection:** A CloudWatch EventBridge rule runs every 5 minutes and queries the `LastSeenIndex` GSI for devices where `lastSeen < now - 10 minutes`. An alarm fires if stale device count exceeds a threshold.

---

## 5. Rollback Flow

**Trigger:** Admin observes deployment issue (high error rate, health check failures) and initiates rollback via Admin Panel or CLI.

```
Admin              Admin Panel       Lambda:deployments    DynamoDB         SQS / EventBridge
  │                     │                   │                  │                   │
  │──POST /v1/          │                   │                  │                   │
  │  deployments/       │                   │                  │                   │
  │  {id}/rollback      │                   │                  │                   │
  │  {tenantId, reason} │                   │                  │                   │
  │────────────────────►│                   │                  │                   │
  │                     │──invoke──────────►│                  │                   │
  │                     │                  │──GetItem────────►│                   │
  │                     │                  │  Policies table  │                   │
  │                     │                  │◄─────────────────│                   │
  │                     │                  │  (current policy,│                   │
  │                     │                  │   previousVersion│                   │
  │                     │                  │   present)       │                   │
  │                     │                  │──UpdateItem─────►│                   │
  │                     │                  │  current policy  │                   │
  │                     │                  │  status=rolling_back                 │
  │                     │                  │──PutItem────────►│                   │
  │                     │                  │  new rollback    │                   │
  │                     │                  │  policy          │                   │
  │                     │                  │  targetVersion=  │                   │
  │                     │                  │  previousVersion │                   │
  │                     │                  │  strategy=immediate                  │
  │                     │                  │──PublishEvent────────────────────────►│
  │                     │                  │  (rollback.initiated)│               │
  │◄────────────────────│◄─────────────────│                  │                   │
  │  200 {rollbackPolicyId,                │                  │                   │
  │       previousVersion,                 │                  │                   │
  │       status: rolling_back}            │                  │                   │
  │                     │                  │                  │                   │
  │                     │                  │                  │                   │
  │ ~~ Devices poll policy endpoint ~~     │                  │                   │
  │                     │                  │                  │                   │
  │                     Device             Lambda:policy      │                   │
  │                       │──GET policy──►│                   │                   │
  │                       │◄──────────────│ (returns rollback │                   │
  │                       │  targetVersion │  version)        │                   │
  │                       │  = prev ver   │                   │                   │
  │                       │               │                   │                   │
  │                       │ Downloads      │                   │                   │
  │                       │ and installs   │                   │                   │
  │                       │ previous ver   │                   │                   │
  │                       │               │                   │                   │
  │                       │──heartbeat──────────────────────────────────────────►│
  │                       │ agentVersions  │                   │                   │
  │                       │ = prev ver    │                   │                   │
  │                     │                  │                  │                   │
  │                     │ When all devices │                  │                   │
  │                     │ report prev ver  │                  │                   │
  │                     │ (or timeout):    │                  │                   │
  │                     │                 │──UpdateItem─────►│                   │
  │                     │                 │  rollback policy │                   │
  │                     │                 │  status=completed│                   │
  │                     │                 │──UpdateItem─────►│                   │
  │                     │                 │  original policy │                   │
  │                     │                 │  status=rolled_back                  │
  │◄────────────────────│ Notify admin    │                  │                   │
  │  (email / dashboard  │                 │                  │                   │
  │   alert)            │                 │                  │                   │
```

**Automatic rollback trigger (future):** A CloudWatch alarm on `AgentUpdateErrorRate > 10%` over 5 minutes can invoke the rollback Lambda directly via EventBridge rule, without admin intervention. Requires a pre-configured "auto-rollback" flag on the deployment policy.
