import { useQuery } from '@tanstack/react-query'
import { listDevices, getDevice } from '../api/devices'
import type { DeviceFilters } from '../types'

export function useDevices(tenantId: string, filters?: DeviceFilters) {
  return useQuery({
    queryKey: ['devices', tenantId, filters],
    queryFn: () => listDevices(tenantId, filters),
    enabled: Boolean(tenantId),
    refetchInterval: 30_000,
  })
}

export function useDevice(tenantId: string, deviceId: string) {
  return useQuery({
    queryKey: ['device', tenantId, deviceId],
    queryFn: () => getDevice(tenantId, deviceId),
    enabled: Boolean(tenantId) && Boolean(deviceId),
    refetchInterval: 30_000,
  })
}
