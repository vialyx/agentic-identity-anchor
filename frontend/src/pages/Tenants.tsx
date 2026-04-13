import { Fragment, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { PlusIcon } from '@heroicons/react/20/solid'
import { format } from 'date-fns'
import { useTenants, useCreateTenant, useDeleteTenant } from '../hooks/useTenants'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import ConfirmModal from '../components/ConfirmModal'

export default function Tenants() {
  const { data: tenants, isLoading, error } = useTenants()
  const createTenant = useCreateTenant()
  const deleteTenant = useDeleteTenant()

  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim()) {
      setFormError('Name is required.')
      return
    }
    setFormError(null)
    try {
      await createTenant.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      setShowCreate(false)
      setName('')
      setDescription('')
    } catch {
      setFormError('Failed to create tenant.')
    }
  }

  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />
  if (error) return <ErrorMessage message="Failed to load tenants." />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Tenants</h1>
        <button
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => setShowCreate(true)}
        >
          <PlusIcon className="h-4 w-4" /> New Tenant
        </button>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {['Name', 'Description', 'ID', 'Created', 'Actions'].map((h) => (
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
            {(tenants ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                  No tenants found.
                </td>
              </tr>
            ) : (
              (tenants ?? []).map((t) => (
                <tr key={t.tenantId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">{t.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{t.description ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{t.tenantId}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {format(new Date(t.createdAt), 'PP')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="text-sm font-medium text-red-500 hover:text-red-700"
                      onClick={() => setDeleteTarget(t.tenantId)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Tenant Modal */}
      <Transition.Root show={showCreate} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowCreate(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/50" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                  <Dialog.Title className="mb-4 text-base font-semibold text-slate-800">
                    Create Tenant
                  </Dialog.Title>
                  {formError && <ErrorMessage message={formError} className="mb-3" />}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Name *</label>
                      <input
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Description</label>
                      <textarea
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-3">
                    <button
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => setShowCreate(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      onClick={() => void handleCreate()}
                      disabled={createTenant.isPending}
                    >
                      {createTenant.isPending ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteTenant.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) })
          }
        }}
        title="Delete Tenant"
        message="Are you sure you want to delete this tenant? All associated data will be removed."
        confirmLabel="Delete"
        danger
        loading={deleteTenant.isPending}
      />
    </div>
  )
}
