/**
 * Core domain types for the Anchor root-of-trust runtime system.
 */

// ─── Enumerations ────────────────────────────────────────────────────────────

export type TenantStatus = 'active' | 'suspended';
export type DeviceStatus = 'active' | 'suspended' | 'decommissioned';
export type DeviceOs = 'linux' | 'macos' | 'windows';
export type DeviceArch = 'amd64' | 'arm64';
export type DeploymentStrategy = 'immediate' | 'canary' | 'scheduled';
export type DeploymentStatus =
  | 'active'
  | 'completed'
  | 'rolling_back'
  | 'rolled_back'
  | 'failed';

// ─── Domain models ───────────────────────────────────────────────────────────

/** Tenant account owning one or more managed devices. */
export interface Tenant {
  tenantId: string;
  name: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
  kmsKeyId: string;
  defaultGroupId: string;
  settings: TenantSettings;
  deviceCount: number;
}

export interface TenantSettings {
  maxDevices: number;
  retentionDays: number;
}

/** A managed device registered under a tenant. */
export interface Device {
  tenantId: string;
  deviceId: string;
  hostname: string;
  os: DeviceOs;
  arch: DeviceArch;
  status: DeviceStatus;
  createdAt: string;
  updatedAt: string;
  lastSeen: string;
  certThumbprint: string;
  groupId: string;
  /** Map of agentId → semver string of currently installed version. */
  agentVersions: Record<string, string>;
  systemInfo?: SystemInfo;
  ttl?: number;
}

export interface SystemInfo {
  uptimeSeconds: number;
  memoryMB: number;
  cpuPercent: number;
}

/** A logical grouping of devices that share a deployment policy. */
export interface Group {
  tenantId: string;
  groupId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  policy: GroupPolicy;
  deviceCount: number;
}

export interface GroupPolicy {
  /** Cron expression describing when updates may be applied. */
  updateWindow?: string;
  /** Maximum number of concurrent device updates. */
  maxConcurrent: number;
}

/** A specific build of an agent binary. */
export interface AgentVersion {
  agentId: string;
  /** Composite sort key: "<semver>#<platform>#<arch>" in DynamoDB. */
  version: string;
  platform: DeviceOs;
  arch: DeviceArch;
  s3Key: string;
  sha256: string;
  signatureS3Key: string;
  releaseNotes?: string;
  stable: boolean;
  publishedAt: string;
  publishedBy: string;
  sizeBytes?: number;
}

/** A deployment policy targeting a group with a specific agent version. */
export interface DeploymentPolicy {
  tenantId: string;
  policyId: string;
  groupId: string;
  agentId: string;
  targetVersion: string;
  previousVersion?: string;
  strategy: DeploymentStrategy;
  canaryPercent?: number;
  scheduledAt?: string;
  status: DeploymentStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  rollbackReason?: string;
  rollbackPolicyId?: string;
}

// ─── Request / Response shapes ───────────────────────────────────────────────

export interface RegistrationRequest {
  tenantId: string;
  deviceId: string;
  hostname: string;
  os: DeviceOs;
  arch: DeviceArch;
  certThumbprint: string;
}

export interface RegistrationResponse {
  deviceId: string;
  groupId: string;
  status: DeviceStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface HeartbeatRequest {
  tenantId: string;
  agentVersions: Record<string, string>;
  systemInfo?: SystemInfo;
  nonce: string;
  timestamp: string;
}

export interface HeartbeatResponse {
  serverTimestamp: string;
  status: 'ok';
}

export interface PolicyAgentEntry {
  agentId: string;
  targetVersion: string;
  platform: string;
  arch: string;
  downloadUrl: string;
  sha256: string;
  signatureUrl: string;
  sizeBytes?: number;
}

export interface PolicyResponse {
  deviceId: string;
  groupId: string;
  policyId: string | null;
  agents: PolicyAgentEntry[];
  strategy?: DeploymentStrategy;
  canaryPercent?: number;
  scheduledAt?: string;
  evaluatedAt: string;
}

export interface CreateTenantRequest {
  name: string;
  settings?: Partial<TenantSettings>;
}

export interface CreateGroupRequest {
  tenantId: string;
  name: string;
  description?: string;
  policy?: Partial<GroupPolicy>;
}

export interface CreateDeploymentRequest {
  tenantId: string;
  groupId: string;
  agentId: string;
  targetVersion: string;
  strategy: DeploymentStrategy;
  canaryPercent?: number;
  scheduledAt?: string;
}

export interface RollbackRequest {
  tenantId: string;
  reason?: string;
}

export interface RollbackResponse {
  rollbackPolicyId: string;
  previousVersion: string;
  targetVersion: string;
  status: DeploymentStatus;
  initiatedAt: string;
}

export interface PublishAgentVersionRequest {
  agentId: string;
  version: string;
  platform: DeviceOs;
  arch: DeviceArch;
  sha256: string;
  releaseNotes?: string;
  stable?: boolean;
}

// ─── API error envelope ──────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}

export interface ApiErrorResponse {
  error: ApiError;
}

// ─── SQS event shapes ────────────────────────────────────────────────────────

export interface HeartbeatEvent {
  tenantId: string;
  deviceId: string;
  agentVersions: Record<string, string>;
  systemInfo?: SystemInfo;
  timestamp: string;
  receivedAt: string;
}
