import { Fragment, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { PlusIcon } from '@heroicons/react/20/solid'
import { useGroups, useCreateGroup, useDeleteGroup } from '../hooks/useGroups'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import ConfirmModal from '../components/ConfirmModal'

interface GroupsProps {
  tenantId: string
}

export default function Groups({ tenantId }: GroupsProps) {
  const { data: groups, isLoading, error } = useGroups(tenantId)
  const createGroup = useCreateGroup(tenantId)
  const deleteGroup = useDeleteGroup(tenantId)

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
      await createGroup.mutateAsync({ name: name.trim(), description: description.trim() || undefined })
      setShowCreate(false)
      setName('')
      setDescription('')
    } catch {
      setFormError('Failed to create group.')
    }
  }

  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />
  if (error) return <ErrorMessage message="Failed to load groups." />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Groups</h1>
        <button
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => setShowCreate(true)}
        >
          <PlusIcon className="h-4 w-4" /> New Group
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {(groups ?? []).length === 0 ? (
          <p className="col-span-3 py-12 text-center text-sm text-slate-400">No groups yet.</p>
        ) : (
          (groups ?? []).map((group) => (
            <div key={group.groupId} className="rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-slate-800">{group.name}</h3>
                  {group.description && (
                    <p className="mt-1 text-sm text-slate-500">{group.description}</p>
                  )}
                </div>
                <button
                  className="text-xs text-red-500 hover:text-red-700"
                  onClick={() => setDeleteTarget(group.groupId)}
                >
                  Delete
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-500">
                <span className="font-medium text-slate-700">{group.deviceCount}</span> devices
              </p>
            </div>
          ))
        )}
      </div>

      {/* Create Group Modal */}
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
                    Create Group
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
                      disabled={createGroup.isPending}
                    >
                      {createGroup.isPending ? 'Creating…' : 'Create'}
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
            deleteGroup.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) })
          }
        }}
        title="Delete Group"
        message="Are you sure you want to delete this group? This action cannot be undone."
        confirmLabel="Delete"
        danger
        loading={deleteGroup.isPending}
      />
    </div>
  )
}
