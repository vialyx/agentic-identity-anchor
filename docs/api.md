# Anchor Control Plane — REST API Specification

Base URL: `https://api.anchor.internal/v1`

## Authentication

| Route prefix | Mechanism |
|---|---|
| `/v1/devices/*` | mTLS (client certificate). The cert thumbprint is bound to the device record in DynamoDB. |
| `/v1/agents/*/download` | mTLS (same as devices). |
| `/v1/tenants`, `/v1/groups`, `/v1/agents`, `/v1/deployments` (admin) | JWT bearer token issued by Amazon Cognito. Include as `Authorization: Bearer <token>`. |

All requests and responses use `Content-Type: application/json` unless noted.

---

## Device Endpoints

### POST /v1/devices/register

Registers a new device or re-registers an existing one (idempotent on `deviceId`). Called on first boot after the device has been provisioned with a client certificate.

**Auth:** mTLS (device client certificate)

**Request Body**

```json
{
  "tenantId":      "string (UUID, required)",
  "deviceId":      "string (UUID, required)",
  "hostname":      "string (required)",
  "os":            "string (enum: linux | macos | windows, required)",
  "arch":          "string (enum: amd64 | arm64, required)",
  "certThumbprint":"string (hex SHA-256, required)"
}
```

**Response 201 Created**

```json
{
  "deviceId":  "string",
  "groupId":   "string (UUID of assigned group)",
  "status":    "active",
  "createdAt": "string (ISO 8601)"
}
```

**Response 200 OK** (re-registration of existing device)

```json
{
  "deviceId":  "string",
  "groupId":   "string",
  "status":    "active",
  "updatedAt": "string (ISO 8601)"
}
```

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Request body failed schema validation. |
| 403 | `TENANT_NOT_FOUND` | `tenantId` does not exist or is suspended. |
| 403 | `CERT_MISMATCH` | Certificate thumbprint does not match stored value for this device. |
| 500 | `INTERNAL_ERROR` | Unexpected server error. |

---

### POST /v1/devices/{deviceId}/heartbeat

Reports liveness and current state of a registered device. Called periodically (default every 60 s).

**Auth:** mTLS

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `deviceId` | UUID | The device identifier. |

**Request Body**

```json
{
  "tenantId":      "string (UUID, required)",
  "agentVersions": {
    "<agentId>": "<semver>"
  },
  "systemInfo": {
    "uptimeSeconds": "number",
    "memoryMB":      "number",
    "cpuPercent":    "number"
  },
  "nonce":         "string (UUID v4, required — replay prevention)",
  "timestamp":     "string (ISO 8601, required — must be within ±5 min of server time)"
}
```

**Response 200 OK**

```json
{
  "serverTimestamp": "string (ISO 8601)",
  "status":          "ok"
}
```

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Schema validation failed. |
| 400 | `TIMESTAMP_SKEW` | Request timestamp outside ±5-minute window. |
| 400 | `REPLAY_DETECTED` | Nonce has already been seen. |
| 403 | `DEVICE_NOT_FOUND` | Device record does not exist. |
| 403 | `DEVICE_SUSPENDED` | Device has been administratively suspended. |
| 500 | `INTERNAL_ERROR` | Unexpected server error. |

---

### GET /v1/devices/{deviceId}/policy

Returns the effective deployment policy for the device, including presigned S3 download URLs for any agent binaries that need updating.

**Auth:** mTLS

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `deviceId` | UUID | The device identifier. |

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tenantId` | UUID | Yes | Tenant context. |

**Response 200 OK**

```json
{
  "deviceId":   "string",
  "groupId":    "string",
  "policyId":   "string",
  "agents": [
    {
      "agentId":        "string",
      "targetVersion":  "string (semver)",
      "platform":       "string",
      "arch":           "string",
      "downloadUrl":    "string (presigned S3 URL, 1h expiry)",
      "sha256":         "string (hex)",
      "signatureUrl":   "string (presigned S3 URL for cosign bundle, 1h expiry)"
    }
  ],
  "strategy":        "string (immediate | canary | scheduled)",
  "canaryPercent":   "number (0–100, present when strategy=canary)",
  "scheduledAt":     "string (ISO 8601, present when strategy=scheduled)",
  "evaluatedAt":     "string (ISO 8601)"
}
```

When no deployment policy targets this device's group, `agents` will be an empty array and `policyId` will be `null`.

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 403 | `DEVICE_NOT_FOUND` | Device does not exist or belongs to a different tenant. |
| 403 | `DEVICE_SUSPENDED` | Device is suspended. |
| 500 | `INTERNAL_ERROR` | Unexpected server error. |

---

### GET /v1/agents/{agentId}/download

Returns a presigned download URL for a specific agent binary. Enforces that the requesting device is entitled to receive this version.

**Auth:** mTLS

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `agentId` | string | Agent identifier (e.g. `anchor`, `monitor-agent`). |

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tenantId` | UUID | Yes | Tenant context. |
| `deviceId` | UUID | Yes | Requesting device. |
| `version` | semver | Yes | Target version to download. |
| `platform` | string | Yes | `linux`, `macos`, `windows`. |
| `arch` | string | Yes | `amd64`, `arm64`. |

**Response 200 OK**

```json
{
  "downloadUrl":  "string (presigned S3 URL, 1h expiry)",
  "sha256":       "string",
  "signatureUrl": "string (presigned S3 URL)",
  "size":         "number (bytes)"
}
```

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 403 | `NOT_ENTITLED` | Policy does not authorize this version for this device. |
| 404 | `VERSION_NOT_FOUND` | Requested agentId/version/platform/arch not found. |
| 500 | `INTERNAL_ERROR` | Unexpected server error. |

---

## Admin Endpoints

All admin endpoints require a valid Cognito JWT with the `admin` scope.

### GET /v1/tenants

Lists all tenants. Paginated.

**Auth:** JWT (admin)

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `limit` | number | No | Page size, default 50, max 100. |
| `nextToken` | string | No | Pagination cursor from previous response. |
| `status` | string | No | Filter by status: `active` \| `suspended`. |

**Response 200 OK**

```json
{
  "tenants": [
    {
      "tenantId":   "string",
      "name":       "string",
      "status":     "string",
      "createdAt":  "string (ISO 8601)",
      "deviceCount":"number",
      "settings":   { "maxDevices": "number", "retentionDays": "number" }
    }
  ],
  "nextToken": "string | null"
}
```

---

### POST /v1/tenants

Creates a new tenant, provisions a dedicated KMS key, and creates the default device group.

**Auth:** JWT (admin)

**Request Body**

```json
{
  "name":     "string (required, 3–128 chars)",
  "settings": {
    "maxDevices":     "number (optional, default 1000)",
    "retentionDays":  "number (optional, default 90)"
  }
}
```

**Response 201 Created**

```json
{
  "tenantId":      "string (UUID)",
  "name":          "string",
  "status":        "active",
  "kmsKeyId":      "string (ARN)",
  "defaultGroupId":"string (UUID)",
  "createdAt":     "string (ISO 8601)"
}
```

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Schema validation failed. |
| 409 | `TENANT_EXISTS` | A tenant with this name already exists. |
| 500 | `INTERNAL_ERROR` | KMS provisioning or DynamoDB write failed. |

---

### GET /v1/groups

Lists device groups for a tenant.

**Auth:** JWT (admin)

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tenantId` | UUID | Yes | Target tenant. |
| `limit` | number | No | Page size, default 50. |
| `nextToken` | string | No | Pagination cursor. |

**Response 200 OK**

```json
{
  "groups": [
    {
      "groupId":     "string",
      "tenantId":    "string",
      "name":        "string",
      "description": "string",
      "deviceCount": "number",
      "policy":      { "updateWindow": "string", "maxConcurrent": "number" },
      "createdAt":   "string (ISO 8601)"
    }
  ],
  "nextToken": "string | null"
}
```

---

### POST /v1/groups

Creates a new device group within a tenant.

**Auth:** JWT (admin)

**Request Body**

```json
{
  "tenantId":    "string (UUID, required)",
  "name":        "string (required, 3–64 chars)",
  "description": "string (optional)",
  "policy": {
    "updateWindow":   "string (optional, cron expression)",
    "maxConcurrent":  "number (optional, default 10)"
  }
}
```

**Response 201 Created**

```json
{
  "groupId":    "string (UUID)",
  "tenantId":   "string",
  "name":       "string",
  "createdAt":  "string (ISO 8601)"
}
```

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Schema validation failed. |
| 403 | `TENANT_NOT_FOUND` | Tenant does not exist. |
| 409 | `GROUP_EXISTS` | A group with this name already exists in the tenant. |

---

### GET /v1/deployments

Lists deployment policies for a tenant.

**Auth:** JWT (admin)

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tenantId` | UUID | Yes | Target tenant. |
| `status` | string | No | Filter: `active` \| `completed` \| `rolling_back`. |
| `limit` | number | No | Page size, default 50. |
| `nextToken` | string | No | Pagination cursor. |

**Response 200 OK**

```json
{
  "deployments": [
    {
      "policyId":      "string",
      "tenantId":      "string",
      "groupId":       "string",
      "agentId":       "string",
      "targetVersion": "string",
      "strategy":      "immediate | canary | scheduled",
      "canaryPercent": "number",
      "scheduledAt":   "string | null",
      "status":        "active | completed | rolling_back | rolled_back",
      "createdAt":     "string (ISO 8601)",
      "updatedAt":     "string (ISO 8601)"
    }
  ],
  "nextToken": "string | null"
}
```

---

### POST /v1/deployments

Creates a new deployment policy targeting a group.

**Auth:** JWT (admin)

**Request Body**

```json
{
  "tenantId":      "string (UUID, required)",
  "groupId":       "string (UUID, required)",
  "agentId":       "string (required)",
  "targetVersion": "string (semver, required)",
  "strategy":      "string (immediate | canary | scheduled, required)",
  "canaryPercent": "number (0–100, required when strategy=canary)",
  "scheduledAt":   "string (ISO 8601, required when strategy=scheduled)"
}
```

**Response 201 Created**

```json
{
  "policyId":      "string (UUID)",
  "tenantId":      "string",
  "groupId":       "string",
  "agentId":       "string",
  "targetVersion": "string",
  "strategy":      "string",
  "status":        "active",
  "createdAt":     "string (ISO 8601)"
}
```

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Schema validation failed. |
| 403 | `TENANT_NOT_FOUND` | Tenant does not exist. |
| 404 | `GROUP_NOT_FOUND` | Group does not exist. |
| 404 | `VERSION_NOT_FOUND` | AgentId/version combination not registered. |
| 409 | `POLICY_CONFLICT` | An active policy already targets this group+agent. |

---

### POST /v1/deployments/{id}/rollback

Rolls back a deployment to the previously deployed version. Creates a new deployment policy with the previous version and sets the current policy to `rolling_back`.

**Auth:** JWT (admin)

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `id` | UUID | Deployment policy ID to roll back. |

**Request Body**

```json
{
  "tenantId": "string (UUID, required)",
  "reason":   "string (optional, audit log)"
}
```

**Response 200 OK**

```json
{
  "rollbackPolicyId":  "string (UUID, new policy for rollback)",
  "previousVersion":   "string (semver)",
  "targetVersion":     "string (semver)",
  "status":            "rolling_back",
  "initiatedAt":       "string (ISO 8601)"
}
```

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `NO_PREVIOUS_VERSION` | No previous stable version available for rollback. |
| 404 | `POLICY_NOT_FOUND` | Deployment policy ID does not exist. |
| 409 | `ALREADY_ROLLING_BACK` | A rollback is already in progress for this group+agent. |
| 500 | `INTERNAL_ERROR` | Unexpected server error. |

---

## Common Error Response Schema

All error responses follow this envelope:

```json
{
  "error": {
    "code":    "string (machine-readable)",
    "message": "string (human-readable)",
    "requestId": "string (X-Amzn-RequestId for tracing)"
  }
}
```
