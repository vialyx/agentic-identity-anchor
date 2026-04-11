import { Fragment, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { PlusIcon } from '@heroicons/react/20/solid'
import { format } from 'date-fns'
import { useAgents, usePublishAgent } from '../hooks/useAgents'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { AgentPlatform } from '../types'

export default function Agents() {
  const [platformFilter, setPlatformFilter] = useState<AgentPlatform | ''>('')
  const [stableFilter, setStableFilter] = useState<'all' | 'stable' | 'unstable'>('all')
  const [showPublish, setShowPublish] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const filters = {
    platform: platformFilter || undefined,
    stable: stableFilter === 'all' ? undefined : stableFilter === 'stable',
  }
  const { data: agents, isLoading, error } = useAgents(filters)
  const publishAgent = usePublishAgent()

  const [form, setForm] = useState({
    agentId: '',
    version: '',
    platform: AgentPlatform.Linux,
    arch: 'amd64',
    stable: false,
    downloadUrl: '',
    checksum: '',
  })

  function updateForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handlePublish() {
    if (!form.agentId || !form.version || !form.downloadUrl || !form.checksum) {
      setFormError('All fields are required.')
      return
    }
    setFormError(null)
    try {
      await publishAgent.mutateAsync(form)
      setShowPublish(false)
      setForm({ agentId: '', version: '', platform: AgentPlatform.Linux, arch: 'amd64', stable: false, downloadUrl: '', checksum: '' })
    } catch {
      setFormError('Failed to publish agent version.')
    }
  }

  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />
  if (error) return <ErrorMessage message="Failed to load agent versions." />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Agent Versions</h1>
        <button
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => setShowPublish(true)}
        >
          <PlusIcon className="h-4 w-4" /> Publish Version
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 rounded-xl bg-white p-4 shadow-sm">
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value as AgentPlatform | '')}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All platforms</option>
          {Object.values(AgentPlatform).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={stableFilter}
          onChange={(e) => setStableFilter(e.target.value as typeof stableFilter)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All channels</option>
          <option value="stable">Stable only</option>
          <option value="unstable">Unstable only</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {['Agent ID', 'Version', 'Platform', 'Arch', 'Channel', 'Published'].map((h) => (
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
            {(agents ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                  No agent versions found.
                </td>
              </tr>
            ) : (
              (agents ?? []).map((a) => (
                <tr key={`${a.agentId}-${a.version}-${a.platform}-${a.arch}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">{a.agentId}</td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-700">{a.version}</td>
                  <td className="px-4 py-3 text-sm capitalize text-slate-600">{a.platform}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{a.arch}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.stable
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {a.stable ? 'stable' : 'unstable'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {format(new Date(a.publishedAt), 'PP')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Publish Modal */}
      <Transition.Root show={showPublish} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowPublish(false)}>
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
                    Publish Agent Version
                  </Dialog.Title>
                  {formError && <ErrorMessage message={formError} className="mb-3" />}
                  <div className="space-y-3">
                    {[
                      { label: 'Agent ID *', key: 'agentId' as const, type: 'text' },
                      { label: 'Version *', key: 'version' as const, type: 'text' },
                      { label: 'Architecture *', key: 'arch' as const, type: 'text' },
                      { label: 'Download URL *', key: 'downloadUrl' as const, type: 'url' },
                      { label: 'Checksum (SHA256) *', key: 'checksum' as const, type: 'text' },
                    ].map(({ label, key, type }) => (
                      <div key={key}>
                        <label className="block text-sm font-medium text-slate-700">{label}</label>
                        <input
                          type={type}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={form[key] as string}
                          onChange={(e) => updateForm(key, e.target.value)}
                        />
                      </div>
                    ))}
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Platform *</label>
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={form.platform}
                        onChange={(e) => updateForm('platform', e.target.value as AgentPlatform)}
                      >
                        {Object.values(AgentPlatform).map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="stable-toggle"
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        checked={form.stable}
                        onChange={(e) => updateForm('stable', e.target.checked)}
                      />
                      <label htmlFor="stable-toggle" className="text-sm text-slate-700">
                        Mark as stable
                      </label>
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-3">
                    <button
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => setShowPublish(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      onClick={() => void handlePublish()}
                      disabled={publishAgent.isPending}
                    >
                      {publishAgent.isPending ? 'Publishing…' : 'Publish'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>
    </div>
  )
}
