import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Volume, Chapter } from '@shared/types'
import { useEditorStore } from '../stores/editor.store'

interface ChapterTreeProps {
  volumes: Volume[]
  chapters: Chapter[]
  activeChapterId: string | null
  integrityStatusMap?: Record<string, { verdict: string; committed: boolean }>
}

export function ChapterTree({
  volumes,
  chapters,
  activeChapterId,
  integrityStatusMap = {}
}: ChapterTreeProps): JSX.Element {
  const { createVolume, createChapter, renameVolume, renameChapter, deleteVolume, deleteChapter } =
    useEditorStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ type: 'volume' | 'chapter'; id: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState<{ type: 'volume' | 'chapter'; volumeId?: string } | null>(
    null
  )
  const [addValue, setAddValue] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const toggleExpand = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startEdit = (type: 'volume' | 'chapter', id: string, title: string): void => {
    setEditing({ type, id })
    setEditValue(title)
  }

  const commitEdit = async (): Promise<void> => {
    if (!editing) return
    const val = editValue.trim()
    if (val) {
      if (editing.type === 'volume') await renameVolume(editing.id, val)
      else await renameChapter(editing.id, val)
    }
    setEditing(null)
  }

  const commitAdd = async (): Promise<void> => {
    if (!adding) return
    const val = addValue.trim()
    if (val) {
      if (adding.type === 'volume') await createVolume(val)
      else if (adding.volumeId) await createChapter(adding.volumeId, val)
    }
    setAdding(null)
    setAddValue('')
  }

  const handleDragEnd = (volumeId: string, event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const volChapters = chapters.filter((c) => c.volume_id === volumeId)
    const oldIndex = volChapters.findIndex((c) => c.id === active.id)
    const newIndex = volChapters.findIndex((c) => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = [...volChapters]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    const orders = reordered.map((c, i) => ({ id: c.id, sort_order: i }))
    void useEditorStore.getState().reorderChapters(volumeId, orders)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-xs font-medium text-ink-soft">章节</span>
        <button
          onClick={() => {
            setAdding({ type: 'volume' })
            setAddValue('')
          }}
          className="rounded px-1.5 py-0.5 text-xs text-ink-faint hover:bg-bg-softer hover:text-ink"
          title="新建卷"
        >
          + 卷
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {adding?.type === 'volume' ? (
          <div className="px-2 py-1">
            <input
              autoFocus
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              onBlur={commitAdd}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitAdd()
                if (e.key === 'Escape') setAdding(null)
              }}
              placeholder="卷名"
              className="w-full rounded border border-emerald-700 bg-bg px-2 py-1 text-sm outline-none"
            />
          </div>
        ) : null}

        {volumes.length === 0 && !adding ? (
          <div className="px-3 py-4 text-center text-xs text-ink-faint">
            还没有卷，点击右上角创建
          </div>
        ) : null}

        {volumes.map((vol) => {
          const volChapters = chapters.filter((c) => c.volume_id === vol.id)
          const isOpen = expanded.has(vol.id)
          return (
            <div key={vol.id} className="select-none">
              <div className="group flex items-center gap-1 px-2 py-1 hover:bg-bg-soft">
                <button
                  onClick={() => toggleExpand(vol.id)}
                  className="w-4 text-xs text-ink-faint"
                >
                  {isOpen ? '▾' : '▸'}
                </button>
                {editing?.type === 'volume' && editing.id === vol.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitEdit()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    className="flex-1 rounded border border-emerald-700 bg-bg px-1.5 py-0.5 text-sm outline-none"
                  />
                ) : (
                  <span
                    className="flex-1 truncate text-sm font-medium"
                    onDoubleClick={() => startEdit('volume', vol.id, vol.title)}
                  >
                    {vol.title}
                  </span>
                )}
                <div className="hidden gap-1 group-hover:flex">
                  <button
                    onClick={() => {
                      setExpanded((p) => new Set(p).add(vol.id))
                      setAdding({ type: 'chapter', volumeId: vol.id })
                      setAddValue('')
                    }}
                    className="rounded px-1 text-xs text-ink-faint hover:text-ink"
                    title="新建章节"
                  >
                    +
                  </button>
                  <button
                    onClick={() => startEdit('volume', vol.id, vol.title)}
                    className="rounded px-1 text-xs text-ink-faint hover:text-ink"
                    title="重命名"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`删除卷「${vol.title}」及其所有章节？`)) void deleteVolume(vol.id)
                    }}
                    className="rounded px-1 text-xs text-rose-400 hover:text-rose-300"
                    title="删除"
                  >
                    ×
                  </button>
                </div>
              </div>

              {isOpen ? (
                <div className="ml-3 border-l border-line">
                  {adding?.type === 'chapter' && adding.volumeId === vol.id ? (
                    <div className="px-2 py-1">
                      <input
                        autoFocus
                        value={addValue}
                        onChange={(e) => setAddValue(e.target.value)}
                        onBlur={commitAdd}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitAdd()
                          if (e.key === 'Escape') setAdding(null)
                        }}
                        placeholder="章节名"
                        className="w-full rounded border border-emerald-700 bg-bg px-2 py-1 text-sm outline-none"
                      />
                    </div>
                  ) : null}

                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleDragEnd(vol.id, e)}
                  >
                    <SortableContext
                      items={volChapters.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {volChapters.map((ch) => (
                        <SortableChapter
                          key={ch.id}
                          chapter={ch}
                          integrity={integrityStatusMap[ch.id]}
                          active={ch.id === activeChapterId}
                          editing={editing?.type === 'chapter' && editing.id === ch.id}
                          editValue={editValue}
                          onSelect={() => void useEditorStore.getState().selectChapter(ch.id)}
                          onEdit={() => startEdit('chapter', ch.id, ch.title)}
                          onEditChange={setEditValue}
                          onEditCommit={commitEdit}
                          onEditCancel={() => setEditing(null)}
                          onDelete={() => {
                            if (confirm(`删除章节「${ch.title}」？`)) void deleteChapter(ch.id)
                          }}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>

                  {volChapters.length === 0 && !adding ? (
                    <div className="px-3 py-2 text-xs text-ink-faint">暂无章节</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface SortableChapterProps {
  chapter: Chapter
  integrity?: { verdict: string; committed: boolean }
  active: boolean
  editing: boolean
  editValue: string
  onSelect: () => void
  onEdit: () => void
  onEditChange: (v: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
  onDelete: () => void
}

function SortableChapter(props: SortableChapterProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.chapter.id
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 px-2 py-1 ${
        props.active ? 'bg-bg-softer' : 'hover:bg-bg-soft'
      }`}
      {...attributes}
      {...listeners}
    >
      {props.editing ? (
        <input
          autoFocus
          value={props.editValue}
          onChange={(e) => props.onEditChange(e.target.value)}
          onBlur={props.onEditCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onEditCommit()
            if (e.key === 'Escape') props.onEditCancel()
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 rounded border border-emerald-700 bg-bg px-1.5 py-0.5 text-sm outline-none"
        />
      ) : (
        <span
          className={`flex-1 truncate text-sm ${props.active ? 'text-emerald-400' : 'text-ink-soft'}`}
          onClick={props.onSelect}
          onDoubleClick={(e) => {
            e.stopPropagation()
            props.onEdit()
          }}
        >
          <span className="mr-1 inline-block w-4 text-center text-xs">
            {props.integrity?.committed
              ? '✓'
              : props.integrity?.verdict === 'rewrite' ||
                  props.integrity?.verdict === 'replan' ||
                  props.integrity?.verdict === 'escalate'
                ? '⚠'
                : props.integrity?.verdict === 'polish'
                  ? '◐'
                  : '○'}
          </span>
          {props.chapter.title}
        </span>
      )}
      <div className="hidden gap-1 group-hover:flex">
        <button
          onClick={(e) => {
            e.stopPropagation()
            props.onEdit()
          }}
          className="rounded px-1 text-xs text-ink-faint hover:text-ink"
        >
          ✎
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            props.onDelete()
          }}
          className="rounded px-1 text-xs text-rose-400 hover:text-rose-300"
        >
          ×
        </button>
      </div>
    </div>
  )
}
