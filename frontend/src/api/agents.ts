import apiClient from './client'
import type { AgentVersion, AgentVersionFilters, PublishAgentVersionRequest } from '../types'

export async function listAgentVersions(filters?: AgentVersionFilters): Promise<AgentVersion[]> {
  const params: Record<string, string> = {}
  if (filters?.platform) params.platform = filters.platform
  if (filters?.stable !== undefined) params.stable = String(filters.stable)

  const { data } = await apiClient.get<AgentVersion[]>('/agents', { params })
  return data
}

export async function getAgentVersion(agentId: string, version: string): Promise<AgentVersion> {
  const { data } = await apiClient.get<AgentVersion>(`/agents/${agentId}/versions/${version}`)
  return data
}

export async function publishAgentVersion(
  payload: PublishAgentVersionRequest,
): Promise<AgentVersion> {
  const { data } = await apiClient.post<AgentVersion>('/agents', payload)
  return data
}
