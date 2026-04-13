import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listGroups, createGroup, deleteGroup } from '../api/groups'
import type { CreateGroupRequest } from '../types'

export function useGroups(tenantId: string) {
  return useQuery({
    queryKey: ['groups', tenantId],
    queryFn: () => listGroups(tenantId),
    enabled: Boolean(tenantId),
  })
}

export function useCreateGroup(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateGroupRequest) => createGroup(tenantId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups', tenantId] })
    },
  })
}

export function useDeleteGroup(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (groupId: string) => deleteGroup(tenantId, groupId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups', tenantId] })
    },
  })
}
