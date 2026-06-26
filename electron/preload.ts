import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '@shared/ipc-api'
import type {
  Character,
  Location,
  Worldbuilding,
  ContinueParams,
  PolishParams,
  RewriteParams,
  ChatParams,
  RagParams,
  IpcEvent,
  BibleSectionType,
  BibleFieldStatus,
  AiCoCreateMode,
  FactLockLevel,
  ExecutionMode,
  ModelTier
} from '@shared/types'

const api: Api = {
  system: {
    status: () => ipcRenderer.invoke('system:status')
  },
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    get: (id: string) => ipcRenderer.invoke('project:get', id),
    create: (input: { title: string; summary?: string }) =>
      ipcRenderer.invoke('project:create', input),
    update: (id: string, input: { title?: string; summary?: string }) =>
      ipcRenderer.invoke('project:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('project:delete', id)
  },
  volume: {
    list: (projectId: string) => ipcRenderer.invoke('volume:list', projectId),
    create: (input: { project_id: string; title: string }) =>
      ipcRenderer.invoke('volume:create', input),
    update: (id: string, input: { title?: string }) =>
      ipcRenderer.invoke('volume:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('volume:delete', id),
    reorder: (orders: Array<{ id: string; sort_order: number }>) =>
      ipcRenderer.invoke('volume:reorder', orders)
  },
  chapter: {
    list: (volumeId: string) => ipcRenderer.invoke('chapter:list', volumeId),
    get: (id: string) => ipcRenderer.invoke('chapter:get', id),
    create: (input: { project_id: string; volume_id: string; title: string }) =>
      ipcRenderer.invoke('chapter:create', input),
    update: (
      id: string,
      input: { title?: string; content?: string; status?: string }
    ) => ipcRenderer.invoke('chapter:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('chapter:delete', id),
    reorder: (orders: Array<{ id: string; sort_order: number }>) =>
      ipcRenderer.invoke('chapter:reorder', orders),
    move: (id: string, volumeId: string) =>
      ipcRenderer.invoke('chapter:move', id, volumeId)
  },
  character: {
    list: (projectId: string) => ipcRenderer.invoke('character:list', projectId),
    create: (input: { project_id: string; name: string }) =>
      ipcRenderer.invoke('character:create', input),
    update: (
      id: string,
      input: Partial<Omit<Character, 'id' | 'project_id' | 'updated_at'>>
    ) => ipcRenderer.invoke('character:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('character:delete', id)
  },
  location: {
    list: (projectId: string) => ipcRenderer.invoke('location:list', projectId),
    create: (input: { project_id: string; name: string }) =>
      ipcRenderer.invoke('location:create', input),
    update: (
      id: string,
      input: Partial<Omit<Location, 'id' | 'project_id'>>
    ) => ipcRenderer.invoke('location:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('location:delete', id)
  },
  worldbuilding: {
    list: (projectId: string) => ipcRenderer.invoke('worldbuilding:list', projectId),
    create: (input: { project_id: string; category: string; key: string; value: string }) =>
      ipcRenderer.invoke('worldbuilding:create', input),
    update: (
      id: string,
      input: Partial<Omit<Worldbuilding, 'id' | 'project_id'>>
    ) => ipcRenderer.invoke('worldbuilding:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('worldbuilding:delete', id)
  },
  memory: {
    listChunks: (projectId: string, filter?: { source_type?: string }) =>
      ipcRenderer.invoke('memory:listChunks', projectId, filter),
    getStats: (projectId: string) => ipcRenderer.invoke('memory:getStats', projectId),
    deleteChunk: (id: string) => ipcRenderer.invoke('memory:deleteChunk', id),
    insertChunk: (input: {
      project_id: string
      source_type: string
      source_id: string
      chunk_index: number
      content: string
    }) => ipcRenderer.invoke('memory:insertChunk', input),
    rebuildChapter: (projectId: string, chapterId: string) =>
      ipcRenderer.invoke('memory:rebuildChapter', projectId, chapterId),
    rebuildLore: (projectId: string, sourceType: string, sourceId: string) =>
      ipcRenderer.invoke('memory:rebuildLore', projectId, sourceType, sourceId),
    rebuildAll: (projectId: string) => ipcRenderer.invoke('memory:rebuildAll', projectId),
    search: (projectId: string, query: string, topK?: number) =>
      ipcRenderer.invoke('memory:search', projectId, query, topK),
    buildContext: (projectId: string, query: string, currentChapterId?: string) =>
      ipcRenderer.invoke('memory:buildContext', projectId, query, currentChapterId)
  },
  ai: {
    continue: (params: ContinueParams) => ipcRenderer.invoke('ai:continue', params),
    polish: (params: PolishParams) => ipcRenderer.invoke('ai:polish', params),
    rewrite: (params: RewriteParams) => ipcRenderer.invoke('ai:rewrite', params),
    chat: (params: ChatParams) => ipcRenderer.invoke('ai:chat', params),
    stop: () => ipcRenderer.invoke('ai:stop'),
    listSessions: (projectId: string) => ipcRenderer.invoke('ai:listSessions', projectId),
    getMessages: (sessionId: string) => ipcRenderer.invoke('ai:getMessages', sessionId),
    deleteSession: (id: string) => ipcRenderer.invoke('ai:deleteSession', id)
  },
  settings: {
    getRagParams: () => ipcRenderer.invoke('settings:getRagParams'),
    setRagParams: (params: RagParams) => ipcRenderer.invoke('settings:setRagParams', params)
  },
  config: {
    listProviders: () => ipcRenderer.invoke('config:listProviders'),
    saveProvider: (input: {
      provider: string
      base_url: string
      api_key: string
      llm_model: string
      embedding_model: string
      model_tier?: ModelTier | null
      is_active?: number
      is_embedding_active?: number
    }) => ipcRenderer.invoke('config:saveProvider', input),
    setActiveProvider: (id: string) => ipcRenderer.invoke('config:setActiveProvider', id),
    setActiveEmbedding: (id: string) => ipcRenderer.invoke('config:setActiveEmbedding', id),
    deleteProvider: (id: string) => ipcRenderer.invoke('config:deleteProvider', id),
    encryptionAvailable: () => ipcRenderer.invoke('config:encryptionAvailable'),
    testEmbedding: () => ipcRenderer.invoke('config:testEmbedding')
  },
  orchestrator: {
    start: (projectId: string) => ipcRenderer.invoke('orchestrator:start', projectId),
    resume: (projectId: string) => ipcRenderer.invoke('orchestrator:resume', projectId),
    pause: (projectId: string) => ipcRenderer.invoke('orchestrator:pause', projectId),
    reset: (projectId: string) => ipcRenderer.invoke('orchestrator:reset', projectId),
    steer: (projectId: string, text: string) => ipcRenderer.invoke('orchestrator:steer', projectId, text),
    getState: (projectId: string) => ipcRenderer.invoke('orchestrator:getState', projectId),
    getProgress: (projectId: string) => ipcRenderer.invoke('orchestrator:getProgress', projectId),
    getLogs: (projectId: string, limit?: number) => ipcRenderer.invoke('orchestrator:getLogs', projectId, limit),
    getSessions: (projectId: string) => ipcRenderer.invoke('orchestrator:getSessions', projectId),
    getRecoveryStatus: (projectId: string) => ipcRenderer.invoke('orchestrator:getRecoveryStatus', projectId)
  },
  bible: {
    get: (projectId: string) => ipcRenderer.invoke('bible:get', projectId),
    updateField: (projectId: string, sectionType: BibleSectionType, sectionKey: string, content: string) =>
      ipcRenderer.invoke('bible:updateField', projectId, sectionType, sectionKey, content),
    setStatus: (projectId: string, sectionType: BibleSectionType, sectionKey: string, status: BibleFieldStatus) =>
      ipcRenderer.invoke('bible:setStatus', projectId, sectionType, sectionKey, status),
    setCandidate: (projectId: string, sectionType: BibleSectionType, sectionKey: string, candidate: string, mode: AiCoCreateMode) =>
      ipcRenderer.invoke('bible:setCandidate', projectId, sectionType, sectionKey, candidate, mode),
    acceptCandidate: (projectId: string, sectionType: BibleSectionType, sectionKey: string) =>
      ipcRenderer.invoke('bible:acceptCandidate', projectId, sectionType, sectionKey),
    rejectCandidate: (projectId: string, sectionType: BibleSectionType, sectionKey: string) =>
      ipcRenderer.invoke('bible:rejectCandidate', projectId, sectionType, sectionKey),
    coCreate: (projectId: string, sectionType: BibleSectionType, sectionKey: string, mode: AiCoCreateMode, userMessage?: string) =>
      ipcRenderer.invoke('bible:coCreate', projectId, sectionType, sectionKey, mode, userMessage),
    getReadiness: (projectId: string) => ipcRenderer.invoke('bible:getReadiness', projectId)
  },
  import: {
    document: (projectId: string, filename: string, content: string) =>
      ipcRenderer.invoke('import:document', projectId, filename, content),
    listDocuments: (projectId: string) => ipcRenderer.invoke('import:listDocuments', projectId),
    parseDocument: (projectId: string, documentId: string) =>
      ipcRenderer.invoke('import:parseDocument', projectId, documentId),
    parseAll: (projectId: string) => ipcRenderer.invoke('import:parseAll', projectId),
    parseAndMergeAll: (projectId: string) =>
      ipcRenderer.invoke('import:parseAndMergeAll', projectId),
    mergeSegments: (projectId: string, segmentIds: string[]) =>
      ipcRenderer.invoke('import:mergeSegments', projectId, segmentIds),
    getConflicts: (projectId: string) => ipcRenderer.invoke('import:getConflicts', projectId),
    deleteDocument: (projectId: string, documentId: string) =>
      ipcRenderer.invoke('import:deleteDocument', projectId, documentId)
  },
  guided: {
    getQuestions: (projectId: string) => ipcRenderer.invoke('guided:getQuestions', projectId),
    submitAnswers: (
      projectId: string,
      answers: Array<{ questionId: string; answer: string; targetSection: BibleSectionType; targetKey: string }>
    ) => ipcRenderer.invoke('guided:submitAnswers', projectId, answers)
  },
  launch: {
    evaluate: (projectId: string) => ipcRenderer.invoke('launch:evaluate', projectId),
    generateSnapshot: (projectId: string) => ipcRenderer.invoke('launch:generateSnapshot', projectId),
    getActiveSnapshot: (projectId: string) => ipcRenderer.invoke('launch:getActiveSnapshot', projectId),
    lockAndStart: (projectId: string, snapshotId: string) =>
      ipcRenderer.invoke('launch:lockAndStart', projectId, snapshotId)
  },
  bibleSegment: {
    list: (projectId: string, documentId?: string) =>
      ipcRenderer.invoke('bibleSegment:list', projectId, documentId),
    updateStatus: (segmentId: string, status: string) =>
      ipcRenderer.invoke('bibleSegment:updateStatus', segmentId, status),
    delete: (segmentId: string) => ipcRenderer.invoke('bibleSegment:delete', segmentId)
  },
  contract: {
    getChapterContract: (projectId: string, chapterId: string) =>
      ipcRenderer.invoke('contract:getChapterContract', projectId, chapterId),
    createChapterContract: (projectId: string, chapterId: string, arcId: string | null, input: Partial<import('@shared/types').ChapterContract>) =>
      ipcRenderer.invoke('contract:createChapterContract', projectId, chapterId, arcId, input),
    updateChapterContract: (id: string, patch: Partial<import('@shared/types').ChapterContract>) =>
      ipcRenderer.invoke('contract:updateChapterContract', id, patch),
    listContractsByArc: (projectId: string, arcId: string) =>
      ipcRenderer.invoke('contract:listContractsByArc', projectId, arcId),
    generateChapterContract: (projectId: string, chapterId: string, arcId: string | null) =>
      ipcRenderer.invoke('contract:generateChapterContract', projectId, chapterId, arcId),
    getKnowledgeContract: (projectId: string, chapterId: string) =>
      ipcRenderer.invoke('contract:getKnowledgeContract', projectId, chapterId),
    createKnowledgeContract: (projectId: string, chapterId: string, input: Partial<import('@shared/types').KnowledgeContract>) =>
      ipcRenderer.invoke('contract:createKnowledgeContract', projectId, chapterId, input),
    updateKnowledgeContract: (id: string, patch: Partial<import('@shared/types').KnowledgeContract>) =>
      ipcRenderer.invoke('contract:updateKnowledgeContract', id, patch),
    generateKnowledgeContract: (projectId: string, chapterId: string, povCharacterId: string | null) =>
      ipcRenderer.invoke('contract:generateKnowledgeContract', projectId, chapterId, povCharacterId)
  },
  factLock: {
    lockFact: (projectId: string, characterId: string, factKey: string, factValue: string, lockLevel: FactLockLevel, allowedChangeEvents?: string[]) =>
      ipcRenderer.invoke('factLock:lockFact', projectId, characterId, factKey, factValue, lockLevel, allowedChangeEvents ?? []),
    unlockFact: (id: string) => ipcRenderer.invoke('factLock:unlockFact', id),
    getLocks: (characterId: string) => ipcRenderer.invoke('factLock:getLocks', characterId),
    getLocksForProject: (projectId: string) => ipcRenderer.invoke('factLock:getLocksForProject', projectId),
    verifyFact: (characterId: string, factKey: string, claimedValue: string) =>
      ipcRenderer.invoke('factLock:verifyFact', characterId, factKey, claimedValue),
    changeFactWithEvent: (characterId: string, factKey: string, newValue: string, eventId: string) =>
      ipcRenderer.invoke('factLock:changeFactWithEvent', characterId, factKey, newValue, eventId),
    batchLockFromSnapshot: (projectId: string, snapshotData: Record<string, unknown>) =>
      ipcRenderer.invoke('factLock:batchLockFromSnapshot', projectId, snapshotData)
  },
  draft: {
    getLatestDraft: (chapterId: string) => ipcRenderer.invoke('draft:getLatestDraft', chapterId),
    getDraft: (id: string) => ipcRenderer.invoke('draft:getDraft', id),
    listDrafts: (chapterId: string) => ipcRenderer.invoke('draft:listDrafts', chapterId),
    commitDraft: (draftId: string) => ipcRenderer.invoke('draft:commitDraft', draftId),
    rejectDraft: (draftId: string, reason: string) => ipcRenderer.invoke('draft:rejectDraft', draftId, reason),
    isCommitted: (chapterId: string) => ipcRenderer.invoke('draft:isCommitted', chapterId)
  },
  gate: {
    runPlanGate: (projectId: string, chapterId: string) =>
      ipcRenderer.invoke('gate:runPlanGate', projectId, chapterId),
    runDraftGate: (draftId: string) => ipcRenderer.invoke('gate:runDraftGate', draftId),
    getGateReports: (draftId: string) => ipcRenderer.invoke('gate:getGateReports', draftId),
    getLatestVerdict: (draftId: string) => ipcRenderer.invoke('gate:getLatestVerdict', draftId),
    getVerdictsByChapter: (chapterId: string) => ipcRenderer.invoke('gate:getVerdictsByChapter', chapterId)
  },
  routing: {
    listRules: (projectId?: string) => ipcRenderer.invoke('routing:listRules', projectId),
    setRule: (input: {
      project_id?: string | null
      agent_type: string
      task_type: string
      risk_level: 'low' | 'normal' | 'high' | 'critical'
      preferred_tier: ModelTier
      auto_escalate: boolean
    }) => ipcRenderer.invoke('routing:setRule', input),
    resolveModel: (agentType: string, taskType: string, context?: { riskLevel?: string; forceTier?: ModelTier }) =>
      ipcRenderer.invoke('routing:resolveModel', agentType, taskType, context),
    shouldEscalate: (context: {
      failCount: number
      violationType?: string
      chapterImportance?: 'normal' | 'climax' | 'volume_start' | 'volume_end' | 'major_twist'
      userMarked?: boolean
    }) => ipcRenderer.invoke('routing:shouldEscalate', context)
  },
  integrity: {
    getEvaluationCases: () => ipcRenderer.invoke('integrity:getEvaluationCases'),
    createEvaluationCase: (input: Omit<import('@shared/types').EvaluationCase, 'id' | 'created_at'>) =>
      ipcRenderer.invoke('integrity:createEvaluationCase', input),
    updateEvaluationCase: (id: string, patch: Partial<import('@shared/types').EvaluationCase>) =>
      ipcRenderer.invoke('integrity:updateEvaluationCase', id, patch),
    deleteEvaluationCase: (id: string) => ipcRenderer.invoke('integrity:deleteEvaluationCase', id),
    runEvaluationCase: (caseId: string, input: {
      projectId: string
      chapterId?: string
      draftId?: string
      content?: string
    }) => ipcRenderer.invoke('integrity:runEvaluationCase', caseId, input),
    runAllEvaluationCases: (input: {
      projectId: string
      chapterId?: string
      draftId?: string
      content?: string
      category?: import('@shared/types').EvaluationCase['category']
    }) => ipcRenderer.invoke('integrity:runAllEvaluationCases', input)
  },
  on: (event: IpcEvent, cb: (payload: unknown) => void) => {
    const channel = `event:${event}`
    const listener = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (e) {
    console.error(e)
  }
} else {
  // @ts-expect-error fallback
  window.api = api
}
