import clsx from 'clsx'
import type { DeviceStatus, DeploymentStatus } from '../types'

type StatusValue = DeviceStatus | DeploymentStatus | string

const colorMap: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  healthy: 'bg-green-100 text-green-800',
  completed: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-700',
  quarantined: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
  rolled_back: 'bg-orange-100 text-orange-800',
}

interface StatusBadgeProps {
  status: StatusValue
  className?: string
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const color = colorMap[status] ?? 'bg-blue-100 text-blue-800'
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        color,
        className,
      )}
    >
      {status.replace('_', ' ')}
    </span>
  )
}
