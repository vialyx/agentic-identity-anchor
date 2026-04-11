# Anchor — DynamoDB Data Model

All tables use on-demand (pay-per-request) billing mode. Point-in-time recovery (PITR) is enabled on every table. Server-side encryption uses the tenant's KMS CMK where applicable, or the AWS-owned key for cross-tenant tables.

---

## 1. Tenants Table

**Table name:** `anchor-tenants`  
**Billing:** On-demand  
**Encryption:** AWS-owned KMS key (no tenant key yet at creation time)

### Primary Key

| Attribute | Type | Role |
|-----------|------|------|
| `tenantId` | String (UUID) | Partition key |

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `tenantId` | S | UUID v4 |
| `name` | S | Human-readable tenant name (unique, enforced by GSI) |
| `status` | S | `active` \| `suspended` |
| `createdAt` | S | ISO 8601 timestamp |
| `updatedAt` | S | ISO 8601 timestamp |
| `kmsKeyId` | S | ARN of tenant CMK in KMS |
| `defaultGroupId` | S | UUID of the automatically created default group |
| `settings` | M | Map: `{ maxDevices: N, retentionDays: N }` |
| `deviceCount` | N | Approximate count, maintained via atomic increment |

### Global Secondary Indexes

| Index name | PK | SK | Projection | Access pattern |
|------------|----|----|------------|----------------|
| `NameIndex` | `name` (S) | — | ALL | Look up tenant by name (uniqueness check + admin search) |
| `StatusIndex` | `status` (S) | `createdAt` (S) | ALL | List all active/suspended tenants sorted by creation time |

---

## 2. Devices Table

**Table name:** `anchor-devices`  
**Billing:** On-demand  
**Encryption:** Tenant KMS CMK (via `aws:kms` SSE with per-item key context)

### Primary Key

| Attribute | Type | Role |
|-----------|------|------|
| `tenantId` | String (UUID) | Partition key |
| `deviceId` | String (UUID) | Sort key |

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `tenantId` | S | Owning tenant UUID |
| `deviceId` | S | Device UUID (matches CN in client cert) |
| `hostname` | S | Reported hostname at registration |
| `os` | S | `linux` \| `macos` \| `windows` |
| `arch` | S | `amd64` \| `arm64` |
| `status` | S | `active` \| `suspended` \| `decommissioned` |
| `createdAt` | S | ISO 8601 — first registration time |
| `lastSeen` | S | ISO 8601 — last successful heartbeat |
| `certThumbprint` | S | Hex SHA-256 of the device's mTLS client certificate |
| `groupId` | S | UUID of assigned group (FK to Groups table) |
| `agentVersions` | M | Map of `{ "<agentId>": "<semver>" }` — last reported versions |
| `systemInfo` | M | Last reported `{ uptimeSeconds, memoryMB, cpuPercent }` |
| `nonceHistory` | SS | String set of recent nonces for replay detection (TTL-pruned) |
| `ttl` | N | Unix epoch — set to `lastSeen + retentionDays` for auto-expiry |

### Global Secondary Indexes

| Index name | PK | SK | Projection | Access pattern |
|------------|----|----|------------|----------------|
| `GroupIndex` | `groupId` (S) | `tenantId` (S) | ALL | List all devices in a group (for policy dispatch) |
| `StatusIndex` | `tenantId` (S) | `status` (S) | KEYS_ONLY | Count/list devices by status per tenant |
| `LastSeenIndex` | `tenantId` (S) | `lastSeen` (S) | KEYS_ONLY | Find stale devices (no heartbeat > N minutes) |

### Access Patterns

| Operation | Key condition | Notes |
|-----------|---------------|-------|
| Get device | PK=tenantId, SK=deviceId | Exact fetch |
| List all devices for tenant | PK=tenantId | Paginated scan over partition |
| List devices in group | GSI GroupIndex: PK=groupId, SK begins_with tenantId | Used by canary targeting |
| Find stale devices | GSI LastSeenIndex: PK=tenantId, SK < threshold | Alerting/cleanup |

---

## 3. Groups Table

**Table name:** `anchor-groups`  
**Billing:** On-demand  
**Encryption:** Tenant KMS CMK

### Primary Key

| Attribute | Type | Role |
|-----------|------|------|
| `tenantId` | String (UUID) | Partition key |
| `groupId` | String (UUID) | Sort key |

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `tenantId` | S | Owning tenant UUID |
| `groupId` | S | Group UUID |
| `name` | S | Human-readable name (unique within tenant) |
| `description` | S | Optional free-text description |
| `createdAt` | S | ISO 8601 |
| `updatedAt` | S | ISO 8601 |
| `isDefault` | BOOL | True for the auto-created default group |
| `policy` | M | `{ updateWindow: "cron(...)", maxConcurrent: N }` |
| `deviceCount` | N | Approximate count, maintained atomically |

### Global Secondary Indexes

| Index name | PK | SK | Projection | Access pattern |
|------------|----|----|------------|----------------|
| `NameIndex` | `tenantId` (S) | `name` (S) | ALL | Look up group by name within tenant |

---

## 4. AgentVersions Table

**Table name:** `anchor-agent-versions`  
**Billing:** On-demand  
**Encryption:** AWS-owned KMS key (version metadata is not tenant-scoped)

### Primary Key

| Attribute | Type | Role |
|-----------|------|------|
| `agentId` | String | Partition key (e.g. `anchor`, `monitor-agent`) |
| `version` | String (semver) | Sort key (e.g. `1.4.2`) |

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `agentId` | S | Logical agent identifier |
| `version` | S | Semantic version string |
| `platform` | S | `linux` \| `macos` \| `windows` |
| `arch` | S | `amd64` \| `arm64` |
| `s3Key` | S | S3 object key for the binary (e.g. `agents/anchor/1.4.2/linux/amd64/anchor`) |
| `sha256` | S | Hex SHA-256 of the binary |
| `signatureS3Key` | S | S3 object key for the cosign bundle |
| `releaseNotes` | S | Markdown release notes |
| `stable` | BOOL | Whether this version is production-stable |
| `publishedAt` | S | ISO 8601 |
| `publishedBy` | S | Cognito username of publisher |
| `uploadUrl` | S | Transient presigned S3 upload URL (cleared after upload confirmed) |

### Global Secondary Indexes

| Index name | PK | SK | Projection | Access pattern |
|------------|----|----|------------|----------------|
| `StableIndex` | `agentId` (S) | `publishedAt` (S) | ALL | List stable versions of an agent sorted by date |
| `PlatformArchIndex` | `agentId` (S) | `platform#arch` (S) composite | ALL | Find versions for a specific platform/arch combo |

### Notes

- The sort key `version` sorts lexicographically; for proper semver ordering, callers should fetch the full list and sort client-side, or use `publishedAt`.
- Multiple items may share the same `agentId+version` for different `platform/arch` combos; the true composite key is `agentId + version + platform + arch` but DynamoDB requires uniqueness on PK+SK. In practice, separate items are stored with `version` encoded as `<semver>#<platform>#<arch>` in the SK.

---

## 5. DeploymentPolicies Table

**Table name:** `anchor-deployment-policies`  
**Billing:** On-demand  
**Encryption:** Tenant KMS CMK

### Primary Key

| Attribute | Type | Role |
|-----------|------|------|
| `tenantId` | String (UUID) | Partition key |
| `policyId` | String (UUID) | Sort key |

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `tenantId` | S | Owning tenant UUID |
| `policyId` | S | Policy UUID |
| `groupId` | S | Target group UUID |
| `agentId` | S | Agent to deploy |
| `targetVersion` | S | Semver target version |
| `previousVersion` | S | Version that was active before this policy (for rollback) |
| `strategy` | S | `immediate` \| `canary` \| `scheduled` |
| `canaryPercent` | N | 0–100; only set when strategy=canary |
| `scheduledAt` | S | ISO 8601; only set when strategy=scheduled |
| `status` | S | `active` \| `completed` \| `rolling_back` \| `rolled_back` \| `failed` |
| `createdAt` | S | ISO 8601 |
| `updatedAt` | S | ISO 8601 |
| `createdBy` | S | Cognito username of admin who created the policy |
| `rollbackReason` | S | Optional reason string when status=rolling_back |
| `rollbackPolicyId` | S | UUID of the rollback policy created during rollback |

### Global Secondary Indexes

| Index name | PK | SK | Projection | Access pattern |
|------------|----|----|------------|----------------|
| `GroupIndex` | `groupId` (S) | `status` (S) | ALL | Find active deployment policy for a group (used during policy fetch) |
| `StatusIndex` | `tenantId` (S) | `status` (S) | ALL | List all active/rolling_back policies for a tenant |
| `AgentIndex` | `agentId` (S) | `tenantId` (S) | KEYS_ONLY | Find all tenants deploying a given agent version |

### Access Patterns

| Operation | Key condition | Notes |
|-----------|---------------|-------|
| Get policy | PK=tenantId, SK=policyId | Exact fetch |
| List policies for tenant | PK=tenantId | Paginated scan |
| Find active policy for group | GSI GroupIndex: PK=groupId, SK=active | Returns current deployment for a group |
| List active policies for tenant | GSI StatusIndex: PK=tenantId, SK=active | Dashboard view |
| Rollback lookup | GSI GroupIndex: PK=groupId | Find latest completed policy for previous version |

---

## TTL Strategy

| Table | TTL attribute | Expiry rule |
|-------|---------------|-------------|
| Devices | `ttl` | `lastSeen + retentionDays * 86400` (per tenant settings) |
| DeploymentPolicies | `ttl` (optional) | `updatedAt + 365 days` for `completed` / `rolled_back` policies |

Nonces in `Devices.nonceHistory` are pruned at application level (keep last 100 per device; heartbeat window is 5 minutes).
