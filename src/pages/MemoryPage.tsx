import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import type { MemoryChunk, MemoryStats, MemorySourceType } from '@shared/types'

type Tab = 'all' | MemorySourceType

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'chapter', label: '章节' },
  { key: 'character', label: '人物' },
  { key: 'location', label: '地点' },
  { key: 'lore', label: '世界观' },
  { key: 'foundation', label: '导入文档' }
]

const SOURCE_LABEL: Record<MemorySourceType, string> = {
  chapter: '章节',
  character: '人物',
  location: '地点',
  lore: '世界观',
  foundation: '导入文档'
}

const SOURCE_BADGE: Record<MemorySourceType, string> = {
  chapter: 'bg-blue-500/15 text-blue-300',
  character: 'bg-purple-500/15 text-purple-300',
  location: 'bg-orange-500/15 text-orange-300',
  lore: 'bg-emerald-500/15 text-emerald-300',
  foundation: 'bg-amber-500/15 text-amber-300'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function preview(content: string): string {
  const text = content.replace(/\s+/g, ' ').trim()
  return text.length > 100 ? text.slice(0, 100) + '…' : text
}

export function MemoryPage({ projectId }: { projectId: string }): JSX.Element {
  const [chunks, setChunks] = useState<MemoryChunk[]>([])
  const [stats, setStats] = useState<MemoryStats>({ totalChunks: 0, totalTokens: 0 })
  const [tab, setTab] = useState<Tab>('all')
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const refresh = async (): Promise<void> => {
    const filter = tab === 'all' ? undefined : { source_type: tab }
    const [list, s] = await Promise.all([
      api.memory.listChunks(projectId, filter),
      api.memory.getStats(projectId)
    ])
    setChunks(list)
    setStats(s)
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [projectId, tab])

  useEffect(() => {
    const off = api.on('memoryProgress', (payload) => {
      const p = payload as { done: number; total: number }
      setProgress({ done: p.done, total: p.total })
    })
    return off
  }, [])

  const handleRebuild = async (): Promise<void> => {
    if (rebuilding) return
    setRebuilding(true)
    setProgress({ done: 0, total: 0 })
    try {
      await api.memory.rebuildAll(projectId)
      await refresh()
    } finally {
      setRebuilding(false)
      setProgress(null)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('删除该记忆分块？')) return
    await api.memory.deleteChunk(id)
    await refresh()
  }

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line bg-bg-soft px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            <StatCard label="总块数" value={stats.totalChunks} />
            <StatCard label="总 Token" value={stats.totalTokens} />
          </div>
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {rebuilding ? '重建中…' : '重建记忆库'}
          </button>
        </div>
        {rebuilding && progress ? (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-ink-faint">
              <span>进度</span>
              <span>
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-softer">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1 text-sm transition-colors ${
              tab === t.key ? 'bg-bg-softer text-ink' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="py-10 text-center text-sm text-ink-faint">加载中…</div>
        ) : chunks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-ink-faint">
            暂无记忆分块
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-2">
            {chunks.map((c) => (
              <div
                key={c.id}
                className="group rounded-lg border border-line bg-bg-soft p-3 hover:bg-bg-softer"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${SOURCE_BADGE[c.source_type]}`}
                    >
                      {SOURCE_LABEL[c.source_type]}
                    </span>
                    <span className="text-xs text-ink-faint">#{c.chunk_index}</span>
                    <span className="text-xs text-ink-faint">{c.token_count} tokens</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-faint">
                      {formatTime(c.updated_at)}
                    </span>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="hidden rounded px-1.5 py-0.5 text-xs text-rose-400 hover:bg-rose-500/10 group-hover:block"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-ink-soft">{preview(c.content)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-bg px-4 py-2">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="text-lg font-semibold text-ink">{value.toLocaleString()}</div>
    </div>
  )
}
