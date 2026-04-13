import { Fragment, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu, Transition } from '@headlessui/react'
import { ChevronDownIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import { signOut } from 'aws-amplify/auth'
import Sidebar from './Sidebar'
import { useTenants } from '../hooks/useTenants'

interface LayoutProps {
  selectedTenantId: string
  onTenantChange: (id: string) => void
  userEmail: string
}

export default function Layout({ selectedTenantId, onTenantChange, userEmail }: LayoutProps) {
  const { data: tenants } = useTenants()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  const selectedTenant = tenants?.find((t) => t.tenantId === selectedTenantId)

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-500">Tenant:</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedTenantId}
              onChange={(e) => onTenantChange(e.target.value)}
            >
              <option value="">All tenants</option>
              {tenants?.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTenant && (
              <span className="text-xs text-slate-400">{selectedTenant.tenantId}</span>
            )}
          </div>

          <Menu as="div" className="relative">
            <Menu.Button className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
              <UserCircleIcon className="h-5 w-5 text-slate-500" />
              <span className="max-w-[160px] truncate">{userEmail}</span>
              <ChevronDownIcon className="h-4 w-4 text-slate-400" />
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Menu.Items className="absolute right-0 mt-2 w-48 rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
                <Menu.Item>
                  {({ active }) => (
                    <button
                      className={`${active ? 'bg-slate-50' : ''} flex w-full items-center px-4 py-2 text-sm text-slate-700`}
                      onClick={() => void handleSignOut()}
                      disabled={signingOut}
                    >
                      {signingOut ? 'Signing out…' : 'Sign out'}
                    </button>
                  )}
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </Menu>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
