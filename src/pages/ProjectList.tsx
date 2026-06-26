import { useState } from 'react'
import { api } from '../lib/ipc'
import type { Project } from '@shared/types'

export function ProjectList({
  projects,
  onChange,
  onOpen
}: {
  projects: Project[]
  onChange: () => void
  onOpen: (project: Project) => void
}): JSX.Element {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async (): Promise<void> => {
    if (!title.trim()) return
    setCreating(true)
    try {
      await api.project.create({ title: title.trim(), summary: summary.trim() })
      setTitle('')
      setSummary('')
      onChange()
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    await api.project.delete(id)
    onChange()
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-xl font-semibold">项目</h1>
      <p className="mb-6 text-sm text-ink-soft">
        创建你的小说项目，进入后可管理卷、章节并开始写作。
      </p>

      <div className="mb-8 rounded-lg border border-line bg-bg-soft p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-soft">新建项目</h2>
        <div className="flex flex-col gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="小说标题"
            className="rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-emerald-600"
          />
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="一句话简介（可选）"
            rows={2}
            className="resize-none rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-emerald-600"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            className="self-start rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            创建
          </button>
        </div>
      </div>

      <h2 className="mb-3 text-sm font-medium text-ink-soft">
        全部项目（{projects.length}）
      </h2>
      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-ink-faint">
          还没有项目，先创建一个吧
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-line bg-bg-soft px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.title}</div>
                {p.summary ? (
                  <div className="truncate text-xs text-ink-faint">{p.summary}</div>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-faint">
                  {new Date(p.updated_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => onOpen(p)}
                  className="rounded px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10"
                >
                  打开
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="rounded px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
