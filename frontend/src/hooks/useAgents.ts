import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listAgentVersions, publishAgentVersion } from '../api/agents'
import type { AgentVersionFilters, PublishAgentVersionRequest } from '../types'

export function useAgents(filters?: AgentVersionFilters) {
  return useQuery({
    queryKey: ['agents', filters],
    queryFn: () => listAgentVersions(filters),
  })
}

export function usePublishAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: PublishAgentVersionRequest) => publishAgentVersion(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}
