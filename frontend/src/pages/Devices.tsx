import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { useDevices } from '../hooks/useDevices'
import { useGroups } from '../hooks/useGroups'
import StatusBadge from '../components/StatusBadge'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { DeviceStatus } from '../types'

interface DevicesProps {
  tenantId: string
}

export default function Devices({ tenantId }: DevicesProps) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | ''>('')
  const [groupFilter, setGroupFilter] = useState('')

  const { data: devices, isLoading, error } = useDevices(tenantId)
  const { data: groups } = useGroups(tenantId)

  const filtered = useMemo(() => {
    let list = devices ?? []
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((d) => d.hostname.toLowerCase().includes(q) || d.deviceId.includes(q))
    }
    if (statusFilter) list = list.filter((d) => d.status === statusFilter)
    if (groupFilter) list = list.filter((d) => d.groupId === groupFilter)
    return list
  }, [devices, search, statusFilter, groupFilter])

  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />
  if (error) return <ErrorMessage message="Failed to load devices." />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Devices</h1>
        <span className="text-sm text-slate-500">Auto-refreshes every 30s</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search hostname…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DeviceStatus | '')}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          {Object.values(DeviceStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All groups</option>
          {groups?.map((g) => (
            <option key={g.groupId} value={g.groupId}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {['Hostname', 'OS', 'Status', 'Last Seen', 'Group', 'Agents', 'Actions'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                  No devices found.
                </td>
              </tr>
            ) : (
              filtered.map((device) => (
                <tr key={device.deviceId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">
                    {device.hostname}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{device.os}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={device.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {device.heartbeat
                      ? formatDistanceToNow(new Date(device.heartbeat.lastSeen), {
                          addSuffix: true,
                        })
                      : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {device.groupName ?? device.groupId ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {device.installedAgents.length}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="text-sm font-medium text-blue-600 hover:text-blue-800"
                      onClick={() => navigate(`/devices/${device.deviceId}`)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
