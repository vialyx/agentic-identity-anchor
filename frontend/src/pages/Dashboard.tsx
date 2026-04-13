import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { subHours, format } from 'date-fns'
import { useDevices } from '../hooks/useDevices'
import { useDeployments } from '../hooks/useDeployments'
import StatusBadge from '../components/StatusBadge'
import LoadingSpinner from '../components/LoadingSpinner'
import { DeviceStatus } from '../types'

interface DashboardProps {
  tenantId: string
}

function generateCheckinData() {
  return Array.from({ length: 24 }, (_, i) => ({
    time: format(subHours(new Date(), 23 - i), 'HH:mm'),
    checkins: Math.floor(Math.random() * 80 + 20),
  }))
}

export default function Dashboard({ tenantId }: DashboardProps) {
  const navigate = useNavigate()
  const { data: devices, isLoading: devLoading } = useDevices(tenantId)
  const { data: deployments, isLoading: depLoading } = useDeployments(tenantId)
  const checkinData = useMemo(() => generateCheckinData(), [])

  const stats = useMemo(() => {
    const all = devices ?? []
    return {
      total: all.length,
      active: all.filter((d) => d.status === DeviceStatus.Active).length,
      inactive: all.filter((d) => d.status === DeviceStatus.Inactive).length,
      quarantined: all.filter((d) => d.status === DeviceStatus.Quarantined).length,
    }
  }, [devices])

  const recentDeployments = useMemo(
    () => (deployments ?? []).slice(0, 5),
    [deployments],
  )

  if (devLoading || depLoading) {
    return <LoadingSpinner size="lg" className="mt-20" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <div className="flex gap-3">
          <button
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => navigate('/deployments')}
          >
            New Deployment
          </button>
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => navigate('/devices')}
          >
            View All Devices
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Devices', value: stats.total, color: 'text-slate-800' },
          { label: 'Active', value: stats.active, color: 'text-green-600' },
          { label: 'Inactive', value: stats.inactive, color: 'text-gray-500' },
          { label: 'Quarantined', value: stats.quarantined, color: 'text-red-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{label}</p>
            <p className={`mt-1 text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Check-in chart */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-700">
          Device Check-ins (Last 24h)
        </h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={checkinData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="checkins"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Recent deployments */}
      <div className="rounded-xl bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-700">Recent Deployments</h2>
        </div>
        <table className="min-w-full">
          <thead className="bg-slate-50">
            <tr>
              {['Group', 'Agent', 'Version', 'Strategy', 'Status'].map((h) => (
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
            {recentDeployments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                  No deployments yet.
                </td>
              </tr>
            ) : (
              recentDeployments.map((d) => (
                <tr key={d.deploymentId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-700">{d.groupName ?? d.groupId}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{d.agentId}</td>
                  <td className="px-4 py-3 text-sm font-mono text-slate-600">{d.targetVersion}</td>
                  <td className="px-4 py-3 text-sm capitalize text-slate-600">{d.strategy}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
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
