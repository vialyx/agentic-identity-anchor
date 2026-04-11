import { useParams, useNavigate } from 'react-router-dom'
import { formatDistanceToNow, format } from 'date-fns'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useDevice } from '../hooks/useDevices'
import StatusBadge from '../components/StatusBadge'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'

interface DeviceDetailProps {
  tenantId: string
}

interface MetricBarProps {
  label: string
  value: number
}

function MetricBar({ label, value }: MetricBarProps) {
  const color =
    value > 90 ? 'bg-red-500' : value > 70 ? 'bg-yellow-400' : 'bg-green-500'
  return (
    <div>
      <div className="flex justify-between text-sm text-slate-600">
        <span>{label}</span>
        <span className="font-medium">{value.toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

// Mock events for the timeline
const mockEvents = [
  { id: '1', type: 'registered', message: 'Device registered', time: '2024-01-10T09:00:00Z' },
  { id: '2', type: 'agent_installed', message: 'Agent core-agent v1.2.0 installed', time: '2024-01-10T09:05:00Z' },
  { id: '3', type: 'heartbeat', message: 'Heartbeat received', time: '2024-01-10T10:00:00Z' },
]

export default function DeviceDetail({ tenantId }: DeviceDetailProps) {
  const { deviceId } = useParams<{ deviceId: string }>()
  const navigate = useNavigate()
  const { data: device, isLoading, error } = useDevice(tenantId, deviceId ?? '')

  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />
  if (error || !device) return <ErrorMessage message="Failed to load device." />

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/devices')}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        <h1 className="text-2xl font-bold text-slate-800">{device.hostname}</h1>
        <StatusBadge status={device.status} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Device info */}
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-700">Device Information</h2>
          <dl className="space-y-3">
            {[
              { label: 'Device ID', value: device.deviceId },
              { label: 'Hostname', value: device.hostname },
              { label: 'OS', value: device.os },
              { label: 'Architecture', value: device.arch },
              { label: 'Cert Thumbprint', value: device.certThumbprint },
              { label: 'Registered', value: format(new Date(device.registeredAt), 'PPpp') },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-sm text-slate-500">{label}</dt>
                <dd className="max-w-[240px] truncate text-right text-sm font-medium text-slate-800">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Health metrics */}
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-700">Health Metrics</h2>
          {device.heartbeat ? (
            <div className="space-y-4">
              <MetricBar label="CPU" value={device.heartbeat.cpuPercent} />
              <MetricBar label="Memory" value={device.heartbeat.memoryPercent} />
              <MetricBar label="Disk" value={device.heartbeat.diskPercent} />
              <p className="mt-2 text-xs text-slate-400">
                Last seen:{' '}
                {formatDistanceToNow(new Date(device.heartbeat.lastSeen), { addSuffix: true })}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No heartbeat data available.</p>
          )}
        </div>
      </div>

      {/* Installed agents */}
      <div className="rounded-xl bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-700">Installed Agents</h2>
        </div>
        <table className="min-w-full">
          <thead className="bg-slate-50">
            <tr>
              {['Agent ID', 'Version', 'Status', 'Installed At'].map((h) => (
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
            {device.installedAgents.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                  No agents installed.
                </td>
              </tr>
            ) : (
              device.installedAgents.map((agent) => (
                <tr key={`${agent.agentId}-${agent.version}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">{agent.agentId}</td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-600">{agent.version}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={agent.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {format(new Date(agent.installedAt), 'PP')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Events timeline */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-700">Event Timeline</h2>
        <ol className="relative border-l border-slate-200">
          {mockEvents.map((event) => (
            <li key={event.id} className="mb-6 ml-4">
              <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-blue-500" />
              <time className="text-xs text-slate-400">
                {format(new Date(event.time), 'PPpp')}
              </time>
              <p className="mt-1 text-sm text-slate-700">{event.message}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
