import { NavLink } from 'react-router-dom'
import {
  HomeIcon,
  ComputerDesktopIcon,
  RectangleGroupIcon,
  CubeIcon,
  RocketLaunchIcon,
  BuildingOfficeIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

const navItems = [
  { to: '/', label: 'Dashboard', icon: HomeIcon, end: true },
  { to: '/devices', label: 'Devices', icon: ComputerDesktopIcon },
  { to: '/groups', label: 'Groups', icon: RectangleGroupIcon },
  { to: '/agents', label: 'Agents', icon: CubeIcon },
  { to: '/deployments', label: 'Deployments', icon: RocketLaunchIcon },
  { to: '/tenants', label: 'Tenants', icon: BuildingOfficeIcon },
]

export default function Sidebar() {
  return (
    <aside className="flex h-full w-64 flex-col bg-slate-800">
      <div className="flex h-16 items-center px-6">
        <span className="text-lg font-semibold text-white">⚓ Anchor Admin</span>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white',
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-700 p-4 text-xs text-slate-500">
        Anchor v1.0
      </div>
    </aside>
  )
}
