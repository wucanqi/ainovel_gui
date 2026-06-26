import { create } from 'zustand'
import type { Project, Volume, Chapter } from '@shared/types'
import { api } from '../lib/ipc'

interface EditorState {
  project: Project | null
  volumes: Volume[]
  chapters: Chapter[]
  activeChapterId: string | null
  activeChapter: Chapter | null
  saving: boolean
  lastSavedAt: number | null

  loadProject: (projectId: string) => Promise<void>
  selectChapter: (chapterId: string) => Promise<void>
  refreshTree: () => Promise<void>
  createVolume: (title: string) => Promise<void>
  createChapter: (volumeId: string, title: string) => Promise<void>
  renameVolume: (id: string, title: string) => Promise<void>
  renameChapter: (id: string, title: string) => Promise<void>
  deleteVolume: (id: string) => Promise<void>
  deleteChapter: (id: string) => Promise<void>
  reorderVolumes: (orders: Array<{ id: string; sort_order: number }>) => Promise<void>
  reorderChapters: (
    volumeId: string,
    orders: Array<{ id: string; sort_order: number }>
  ) => Promise<void>
  moveChapter: (id: string, volumeId: string) => Promise<void>
  saveChapterContent: (id: string, content: string) => Promise<void>
  setSaving: (v: boolean) => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: null,
  volumes: [],
  chapters: [],
  activeChapterId: null,
  activeChapter: null,
  saving: false,
  lastSavedAt: null,

  loadProject: async (projectId: string) => {
    const project = await api.project.get(projectId)
    const volumes = await api.volume.list(projectId)
    const allChapters: Chapter[] = []
    for (const v of volumes) {
      const chs = await api.chapter.list(v.id)
      allChapters.push(...chs)
    }
    set({
      project,
      volumes,
      chapters: allChapters,
      activeChapterId: null,
      activeChapter: null
    })
  },

  selectChapter: async (chapterId: string) => {
    const ch = await api.chapter.get(chapterId)
    set({ activeChapterId: chapterId, activeChapter: ch })
  },

  refreshTree: async () => {
    const { project } = get()
    if (!project) return
    const volumes = await api.volume.list(project.id)
    const allChapters: Chapter[] = []
    for (const v of volumes) {
      const chs = await api.chapter.list(v.id)
      allChapters.push(...chs)
    }
    set({ volumes, chapters: allChapters })
  },

  createVolume: async (title: string) => {
    const { project, refreshTree } = get()
    if (!project) return
    await api.volume.create({ project_id: project.id, title })
    await refreshTree()
  },

  createChapter: async (volumeId: string, title: string) => {
    const { project, refreshTree } = get()
    if (!project) return
    await api.chapter.create({ project_id: project.id, volume_id: volumeId, title })
    await refreshTree()
  },

  renameVolume: async (id: string, title: string) => {
    await api.volume.update(id, { title })
    await get().refreshTree()
  },

  renameChapter: async (id: string, title: string) => {
    await api.chapter.update(id, { title })
    await get().refreshTree()
  },

  deleteVolume: async (id: string) => {
    const { activeChapterId, chapters } = get()
    const affected = chapters.filter((c) => c.volume_id === id)
    await api.volume.delete(id)
    await get().refreshTree()
    if (activeChapterId && affected.some((c) => c.id === activeChapterId)) {
      set({ activeChapterId: null, activeChapter: null })
    }
  },

  deleteChapter: async (id: string) => {
    const { activeChapterId } = get()
    await api.chapter.delete(id)
    await get().refreshTree()
    if (activeChapterId === id) {
      set({ activeChapterId: null, activeChapter: null })
    }
  },

  reorderVolumes: async (orders) => {
    await api.volume.reorder(orders)
    await get().refreshTree()
  },

  reorderChapters: async (_volumeId, orders) => {
    await api.chapter.reorder(orders)
    await get().refreshTree()
  },

  moveChapter: async (id: string, volumeId: string) => {
    await api.chapter.move(id, volumeId)
    await get().refreshTree()
  },

  saveChapterContent: async (id: string, content: string) => {
    set({ saving: true })
    try {
      await api.chapter.update(id, { content })
      const ch = await api.chapter.get(id)
      set({ activeChapter: ch, lastSavedAt: Date.now() })
    } finally {
      set({ saving: false })
    }
  },

  setSaving: (v: boolean) => set({ saving: v })
}))
