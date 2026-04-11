import apiClient from './client'
import type { Group, CreateGroupRequest } from '../types'

export async function listGroups(tenantId: string): Promise<Group[]> {
  const { data } = await apiClient.get<Group[]>(`/tenants/${tenantId}/groups`)
  return data
}

export async function getGroup(tenantId: string, groupId: string): Promise<Group> {
  const { data } = await apiClient.get<Group>(`/tenants/${tenantId}/groups/${groupId}`)
  return data
}

export async function createGroup(tenantId: string, payload: CreateGroupRequest): Promise<Group> {
  const { data } = await apiClient.post<Group>(`/tenants/${tenantId}/groups`, payload)
  return data
}

export async function deleteGroup(tenantId: string, groupId: string): Promise<void> {
  await apiClient.delete(`/tenants/${tenantId}/groups/${groupId}`)
}
