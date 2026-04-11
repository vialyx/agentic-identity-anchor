import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listTenants, createTenant, deleteTenant } from '../api/tenants'
import type { CreateTenantRequest } from '../types'

export function useTenants() {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: listTenants,
  })
}

export function useCreateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateTenantRequest) => createTenant(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
    },
  })
}

export function useDeleteTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tenantId: string) => deleteTenant(tenantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
    },
  })
}
