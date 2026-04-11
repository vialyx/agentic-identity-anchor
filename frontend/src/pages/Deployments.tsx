import { Fragment, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { PlusIcon } from '@heroicons/react/20/solid'
import { formatDistanceToNow } from 'date-fns'
import { useDeployments, useCreateDeployment, useRollbackDeployment } from '../hooks/useDeployments'
import { useGroups } from '../hooks/useGroups'
import { useAgents } from '../hooks/useAgents'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import StatusBadge from '../components/StatusBadge'
import ConfirmModal from '../components/ConfirmModal'
import { DeploymentStrategy } from '../types'

interface DeploymentsProps {
  tenantId: string
}

export default function Deployments({ tenantId }: DeploymentsProps) {
  const { data: deployments, isLoading, error } = useDeployments(tenantId)
  const { data: groups } = useGroups(tenantId)
  const { data: agents } = useAgents()
  const createDeployment = useCreateDeployment(tenantId)
  const rollbackDeployment = useRollbackDeployment(tenantId)

  const [showCreate, setShowCreate] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [form, setForm] = useState({
    groupId: '',
    agentId: '',
    targetVersion: '',
    strategy: DeploymentStrategy.Immediate,
    canaryPercent: 10,
  })

  function updateForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // Unique agent IDs from available agent versions
  const agentIds = [...new Set((agents ?? []).map((a) => a.agentId))]
  // Versions for selected agent
  const versionsForAgent = (agents ?? [])
    .filter((a) => a.agentId === form.agentId)
    .map((a) => a.version)

  async function handleCreate() {
    if (!form.groupId || !form.agentId || !form.targetVersion) {
      setFormError('Group, agent, and version are required.')
      return
    }
    setFormError(null)
    try {
      await createDeployment.mutateAsync({
        ...form,
        canaryPercent:
          form.strategy === DeploymentStrategy.Canary ? form.canaryPercent : undefined,
      })
      setShowCreate(false)
      setForm({ groupId: '', agentId: '', targetVersion: '', strategy: DeploymentStrategy.Immediate, canaryPercent: 10 })
    } catch {
      setFormError('Failed to create deployment.')
    }
  }

  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />
  if (error) return <ErrorMessage message="Failed to load deployments." />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Deployments</h1>
        <button
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => setShowCreate(true)}
        >
          <PlusIcon className="h-4 w-4" /> New Deployment
        </button>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {['Group', 'Agent', 'Version', 'Strategy', 'Status', 'Progress', 'Updated', 'Actions'].map((h) => (
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
            {(deployments ?? []).length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">
                  No deployments found.
                </td>
              </tr>
            ) : (
              (deployments ?? []).map((d) => (
                <tr key={d.deploymentId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-700">{d.groupName ?? d.groupId}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{d.agentId}</td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-600">{d.targetVersion}</td>
                  <td className="px-4 py-3 text-sm capitalize text-slate-600">{d.strategy}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${d.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500">{d.progress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="text-sm font-medium text-orange-600 hover:text-orange-800"
                      onClick={() => setRollbackTarget(d.deploymentId)}
                    >
                      Rollback
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Deployment Modal */}
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
                    Create Deployment
                  </Dialog.Title>
                  {formError && <ErrorMessage message={formError} className="mb-3" />}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Group *</label>
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={form.groupId}
                        onChange={(e) => updateForm('groupId', e.target.value)}
                      >
                        <option value="">Select group…</option>
                        {(groups ?? []).map((g) => (
                          <option key={g.groupId} value={g.groupId}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Agent *</label>
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={form.agentId}
                        onChange={(e) => {
                          updateForm('agentId', e.target.value)
                          updateForm('targetVersion', '')
                        }}
                      >
                        <option value="">Select agent…</option>
                        {agentIds.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Version *</label>
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={form.targetVersion}
                        onChange={(e) => updateForm('targetVersion', e.target.value)}
                        disabled={!form.agentId}
                      >
                        <option value="">Select version…</option>
                        {versionsForAgent.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Strategy *</label>
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={form.strategy}
                        onChange={(e) => updateForm('strategy', e.target.value as DeploymentStrategy)}
                      >
                        {Object.values(DeploymentStrategy).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    {form.strategy === DeploymentStrategy.Canary && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700">
                          Canary % (1–99)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={99}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={form.canaryPercent}
                          onChange={(e) => updateForm('canaryPercent', Number(e.target.value))}
                        />
                      </div>
                    )}
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
                      disabled={createDeployment.isPending}
                    >
                      {createDeployment.isPending ? 'Creating…' : 'Deploy'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      <ConfirmModal
        open={Boolean(rollbackTarget)}
        onClose={() => setRollbackTarget(null)}
        onConfirm={() => {
          if (rollbackTarget) {
            rollbackDeployment.mutate(rollbackTarget, {
              onSuccess: () => setRollbackTarget(null),
            })
          }
        }}
        title="Rollback Deployment"
        message="Are you sure you want to roll back this deployment? Affected devices will be reverted."
        confirmLabel="Rollback"
        danger
        loading={rollbackDeployment.isPending}
      />
    </div>
  )
}
