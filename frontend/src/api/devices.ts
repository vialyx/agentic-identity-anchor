import apiClient from './client'
import type { Device, DeviceFilters } from '../types'

export async function listDevices(tenantId: string, filters?: DeviceFilters): Promise<Device[]> {
  const params: Record<string, string> = {}
  if (filters?.status) params.status = filters.status
  if (filters?.groupId) params.groupId = filters.groupId
  if (filters?.search) params.search = filters.search

  const { data } = await apiClient.get<Device[]>(`/tenants/${tenantId}/devices`, { params })
  return data
}

export async function getDevice(tenantId: string, deviceId: string): Promise<Device> {
  const { data } = await apiClient.get<Device>(`/tenants/${tenantId}/devices/${deviceId}`)
  return data
}
