import { useEffect, useState } from 'react'
import { useEditorStore } from '../stores/editor.store'
import { ChapterTree } from '../components/ChapterTree'
import { Editor } from '../components/Editor'
import { OrchestratorPanel } from '../components/OrchestratorPanel'
import { IntegrityPanel } from '../components/IntegrityPanel'
import type { Project } from '@shared/types'
import { api } from '../lib/ipc'

export function EditorPage({ project }: { project: Project }): JSX.Element {
  const {
    volumes,
    chapters,
    activeChapterId,
    activeChapter,
    saving,
    lastSavedAt,
    loadProject,
    selectChapter,
    saveChapterContent
  } = useEditorStore()
  const [showOrchestrator, setShowOrchestrator] = useState(false)
  const [showIntegrity, setShowIntegrity] = useState(true)
  const [integrityStatusMap, setIntegrityStatusMap] = useState<Record<string, { verdict: string; committed: boolean }>>({})

  useEffect(() => {
    void loadProject(project.id)
  }, [project.id, loadProject])

  useEffect(() => {
    let cancelled = false
    const loadIntegrity = async (): Promise<void> => {
      const entries = await Promise.all(
        chapters.map(async (chapter) => {
          const [committed, verdicts] = await Promise.all([
            api.draft.isCommitted(chapter.id),
            api.gate.getVerdictsByChapter(chapter.id)
          ])
          return [chapter.id, { committed, verdict: verdicts[0]?.verdict ?? 'draft' }] as const
        })
      )
      if (!cancelled) {
        setIntegrityStatusMap(Object.fromEntries(entries))
      }
    }
    if (chapters.length > 0) {
      void loadIntegrity()
    } else {
      setIntegrityStatusMap({})
    }
    return () => {
      cancelled = true
    }
  }, [chapters])

  return (
    <div className="flex h-full relative">
      <aside className="w-64 shrink-0 border-r border-line bg-bg-soft">
        <ChapterTree
          volumes={volumes}
          chapters={chapters}
          activeChapterId={activeChapterId}
          integrityStatusMap={integrityStatusMap}
        />
      </aside>
      <section className="min-w-0 flex-1">
        <Editor
          chapter={activeChapter}
          onSave={(content) => {
            if (activeChapterId) void saveChapterContent(activeChapterId, content)
          }}
          saving={saving}
          lastSavedAt={lastSavedAt}
        />
      </section>

      {showOrchestrator && (
        <aside className="w-80 shrink-0 border-l border-line">
          <OrchestratorPanel projectId={project.id} />
        </aside>
      )}

      {showIntegrity && (
        <aside className="w-[360px] shrink-0 border-l border-line">
          <IntegrityPanel projectId={project.id} chapterId={activeChapterId} />
        </aside>
      )}

      <button
        onClick={() => setShowOrchestrator(!showOrchestrator)}
        className={`absolute right-0 top-12 z-10 rounded-l-md border border-line bg-bg-soft px-2 py-1 text-[10px] text-ink-soft hover:text-ink ${
          showOrchestrator ? (showIntegrity ? 'mr-[440px]' : 'mr-80') : showIntegrity ? 'mr-[360px]' : 'mr-0'
        } transition-all`}
        title={showOrchestrator ? '隐藏编排器' : '显示编排器'}
      >
        {showOrchestrator ? '▶' : '◀'}
      </button>
      <button
        onClick={() => setShowIntegrity(!showIntegrity)}
        className={`absolute right-0 top-24 z-10 rounded-l-md border border-line bg-bg-soft px-2 py-1 text-[10px] text-ink-soft hover:text-ink ${
          showIntegrity ? 'mr-[360px]' : 'mr-0'
        } transition-all`}
        title={showIntegrity ? '隐藏完整性面板' : '显示完整性面板'}
      >
        {showIntegrity ? '完整性 ▶' : '◀ 完整性'}
      </button>
    </div>
  )
}
