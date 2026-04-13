// Enums
export enum DeviceStatus {
  Active = 'active',
  Inactive = 'inactive',
  Quarantined = 'quarantined',
}

export enum DeploymentStrategy {
  Immediate = 'immediate',
  Canary = 'canary',
  Staged = 'staged',
}

export enum DeploymentStatus {
  Pending = 'pending',
  Active = 'active',
  Completed = 'completed',
  Failed = 'failed',
  RolledBack = 'rolled_back',
}

export enum AgentPlatform {
  Linux = 'linux',
  Windows = 'windows',
  MacOS = 'macos',
}

// Core entities
export interface Tenant {
  tenantId: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface HeartbeatInfo {
  lastSeen: string
  cpuPercent: number
  memoryPercent: number
  diskPercent: number
  uptime: number
}

export interface InstalledAgent {
  agentId: string
  version: string
  status: string
  installedAt: string
}

export interface Device {
  deviceId: string
  tenantId: string
  hostname: string
  os: string
  arch: string
  certThumbprint: string
  status: DeviceStatus
  groupId?: string
  groupName?: string
  heartbeat?: HeartbeatInfo
  installedAgents: InstalledAgent[]
  registeredAt: string
  updatedAt: string
}

export interface Group {
  groupId: string
  tenantId: string
  name: string
  description?: string
  deviceCount: number
  policyId?: string
  createdAt: string
  updatedAt: string
}

export interface AgentVersion {
  agentId: string
  version: string
  platform: AgentPlatform
  arch: string
  stable: boolean
  downloadUrl: string
  checksum: string
  publishedAt: string
  publishedBy: string
}

export interface DeploymentPolicy {
  deploymentId: string
  tenantId: string
  groupId: string
  groupName?: string
  agentId: string
  targetVersion: string
  strategy: DeploymentStrategy
  canaryPercent?: number
  status: DeploymentStatus
  progress: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}

// Request/response DTOs
export interface CreateTenantRequest {
  name: string
  description?: string
}

export interface CreateGroupRequest {
  name: string
  description?: string
}

export interface PublishAgentVersionRequest {
  agentId: string
  version: string
  platform: AgentPlatform
  arch: string
  stable: boolean
  downloadUrl: string
  checksum: string
}

export interface CreateDeploymentRequest {
  groupId: string
  agentId: string
  targetVersion: string
  strategy: DeploymentStrategy
  canaryPercent?: number
}

export interface DeviceFilters {
  status?: DeviceStatus
  groupId?: string
  search?: string
}

export interface AgentVersionFilters {
  platform?: AgentPlatform
  stable?: boolean
}

// Pagination wrapper
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
