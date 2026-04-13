import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listDeployments, createDeployment, rollbackDeployment } from '../api/deployments'
import type { CreateDeploymentRequest } from '../types'

export function useDeployments(tenantId: string) {
  return useQuery({
    queryKey: ['deployments', tenantId],
    queryFn: () => listDeployments(tenantId),
    enabled: Boolean(tenantId),
    refetchInterval: 15_000,
  })
}

export function useCreateDeployment(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateDeploymentRequest) => createDeployment(tenantId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deployments', tenantId] })
    },
  })
}

export function useRollbackDeployment(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (deploymentId: string) => rollbackDeployment(tenantId, deploymentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deployments', tenantId] })
    },
  })
}
