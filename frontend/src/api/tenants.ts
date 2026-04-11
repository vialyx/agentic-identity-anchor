import apiClient from './client'
import type { Tenant, CreateTenantRequest } from '../types'

export async function listTenants(): Promise<Tenant[]> {
  const { data } = await apiClient.get<Tenant[]>('/tenants')
  return data
}

export async function getTenant(tenantId: string): Promise<Tenant> {
  const { data } = await apiClient.get<Tenant>(`/tenants/${tenantId}`)
  return data
}

export async function createTenant(payload: CreateTenantRequest): Promise<Tenant> {
  const { data } = await apiClient.post<Tenant>('/tenants', payload)
  return data
}

export async function deleteTenant(tenantId: string): Promise<void> {
  await apiClient.delete(`/tenants/${tenantId}`)
}
