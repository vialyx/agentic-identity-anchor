import apiClient from './client'
import type { DeploymentPolicy, CreateDeploymentRequest } from '../types'

export async function listDeployments(tenantId: string): Promise<DeploymentPolicy[]> {
  const { data } = await apiClient.get<DeploymentPolicy[]>(`/tenants/${tenantId}/deployments`)
  return data
}

export async function getDeployment(
  tenantId: string,
  deploymentId: string,
): Promise<DeploymentPolicy> {
  const { data } = await apiClient.get<DeploymentPolicy>(
    `/tenants/${tenantId}/deployments/${deploymentId}`,
  )
  return data
}

export async function createDeployment(
  tenantId: string,
  payload: CreateDeploymentRequest,
): Promise<DeploymentPolicy> {
  const { data } = await apiClient.post<DeploymentPolicy>(
    `/tenants/${tenantId}/deployments`,
    payload,
  )
  return data
}

export async function rollbackDeployment(
  tenantId: string,
  deploymentId: string,
): Promise<DeploymentPolicy> {
  const { data } = await apiClient.post<DeploymentPolicy>(
    `/tenants/${tenantId}/deployments/${deploymentId}/rollback`,
  )
  return data
}
