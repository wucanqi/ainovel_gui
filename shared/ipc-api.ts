import type {
  Project,
  Volume,
  Chapter,
  Character,
  Location,
  Worldbuilding,
  SystemStatus,
  MemoryChunk,
  MemoryStats,
  ApiProvider,
  ApiProviderInput,
  IpcEvent,
  RagContext,
  AiSession,
  AiMessage,
  ContinueParams,
  PolishParams,
  RewriteParams,
  ChatParams,
  RagParams,
  OrchestratorState,
  SystemState,
  BoundaryConditions,
  OrchestrationLogEntry,
  AgentSession,
  AgentResponse,
  ExecutionMode,
  RecoveryStatus,
  CheckpointPayload,
  StoryBible,
  BibleSectionType,
  BibleFieldStatus,
  AiCoCreateMode,
  BibleField,
  ImportedDocument,
  ParsedSegment,
  MergeResult,
  ConflictItem,
  ReadinessResult,
  GuidedQuestion,
  LaunchSnapshot,
  ChapterContract,
  KnowledgeContract,
  CharacterFactLock,
  ChapterDraft,
  DraftGateReport,
  DraftGateVerdict,
  ModelRoutingRule,
  RoutingDecision,
  EvaluationCase,
  EvaluationRunResult,
  FactLockLevel,
  ModelTier
} from './types'

export interface SystemApi {
  status(): Promise<SystemStatus>
}

export interface ProjectApi {
  list(): Promise<Project[]>
  get(id: string): Promise<Project | null>
  create(input: { title: string; summary?: string }): Promise<Project>
  update(id: string, input: { title?: string; summary?: string }): Promise<void>
  delete(id: string): Promise<void>
}

export interface VolumeApi {
  list(projectId: string): Promise<Volume[]>
  create(input: { project_id: string; title: string }): Promise<Volume>
  update(id: string, input: { title?: string }): Promise<void>
  delete(id: string): Promise<void>
  reorder(orders: Array<{ id: string; sort_order: number }>): Promise<void>
}

export interface ChapterApi {
  list(volumeId: string): Promise<Chapter[]>
  get(id: string): Promise<Chapter | null>
  create(input: {
    project_id: string
    volume_id: string
    title: string
  }): Promise<Chapter>
  update(
    id: string,
    input: { title?: string; content?: string; status?: string }
  ): Promise<void>
  delete(id: string): Promise<void>
  reorder(orders: Array<{ id: string; sort_order: number }>): Promise<void>
  move(id: string, volumeId: string): Promise<void>
}

export interface CharacterApi {
  list(projectId: string): Promise<Character[]>
  create(input: {
    project_id: string
    name: string
  }): Promise<Character>
  update(
    id: string,
    input: Partial<Omit<Character, 'id' | 'project_id' | 'updated_at'>>
  ): Promise<void>
  delete(id: string): Promise<void>
}

export interface LocationApi {
  list(projectId: string): Promise<Location[]>
  create(input: { project_id: string; name: string }): Promise<Location>
  update(
    id: string,
    input: Partial<Omit<Location, 'id' | 'project_id'>>
  ): Promise<void>
  delete(id: string): Promise<void>
}

export interface WorldbuildingApi {
  list(projectId: string): Promise<Worldbuilding[]>
  create(input: {
    project_id: string
    category: string
    key: string
    value: string
  }): Promise<Worldbuilding>
  update(
    id: string,
    input: Partial<Omit<Worldbuilding, 'id' | 'project_id'>>
  ): Promise<void>
  delete(id: string): Promise<void>
}

export interface MemoryApi {
  listChunks(
    projectId: string,
    filter?: { source_type?: string }
  ): Promise<MemoryChunk[]>
  getStats(projectId: string): Promise<MemoryStats>
  deleteChunk(id: string): Promise<void>
  insertChunk(input: {
    project_id: string
    source_type: string
    source_id: string
    chunk_index: number
    content: string
  }): Promise<MemoryChunk>
  rebuildChapter(projectId: string, chapterId: string): Promise<number>
  rebuildLore(projectId: string, sourceType: string, sourceId: string): Promise<number>
  rebuildAll(projectId: string): Promise<void>
  search(projectId: string, query: string, topK?: number): Promise<MemoryChunk[]>
  buildContext(
    projectId: string,
    query: string,
    currentChapterId?: string
  ): Promise<RagContext>
}

export interface AiApi {
  continue(params: ContinueParams): Promise<void>
  polish(params: PolishParams): Promise<void>
  rewrite(params: RewriteParams): Promise<void>
  chat(params: ChatParams): Promise<void>
  stop(): void
  listSessions(projectId: string): Promise<AiSession[]>
  getMessages(sessionId: string): Promise<AiMessage[]>
  deleteSession(id: string): Promise<void>
}

export interface SettingsApi {
  getRagParams(): Promise<RagParams>
  setRagParams(params: RagParams): Promise<void>
}

export interface ConfigApi {
  listProviders(): Promise<ApiProvider[]>
  saveProvider(input: ApiProviderInput): Promise<ApiProvider>
  setActiveProvider(id: string): Promise<void>
  setActiveEmbedding(id: string): Promise<void>
  deleteProvider(id: string): Promise<void>
  encryptionAvailable(): Promise<boolean>
  testEmbedding(): Promise<{ ok: boolean; message: string; model: string; dims?: number }>
}

export interface OrchestratorApi {
  start(projectId: string): Promise<{ phase: string; message: string }>
  resume(projectId: string): Promise<{ phase: string; message: string }>
  pause(projectId: string): Promise<void>
  reset(projectId: string): Promise<{ state: string; message: string }>
  steer(projectId: string, text: string): Promise<void>
  getState(projectId: string): Promise<Record<string, unknown> | null>
  getProgress(projectId: string): Promise<Record<string, unknown> | null>
  getLogs(projectId: string, limit?: number): Promise<OrchestrationLogEntry[]>
  getSessions(projectId: string): Promise<AgentSession[]>
  getRecoveryStatus(projectId: string): Promise<RecoveryStatus>
}

export interface EventApi {
  on(event: IpcEvent, cb: (payload: unknown) => void): () => void
}

export interface BibleApi {
  get(projectId: string): Promise<StoryBible>
  updateField(projectId: string, sectionType: BibleSectionType, sectionKey: string, content: string): Promise<BibleField>
  setStatus(projectId: string, sectionType: BibleSectionType, sectionKey: string, status: BibleFieldStatus): Promise<void>
  setCandidate(projectId: string, sectionType: BibleSectionType, sectionKey: string, candidate: string, mode: AiCoCreateMode): Promise<void>
  acceptCandidate(projectId: string, sectionType: BibleSectionType, sectionKey: string): Promise<void>
  rejectCandidate(projectId: string, sectionType: BibleSectionType, sectionKey: string): Promise<void>
  coCreate(projectId: string, sectionType: BibleSectionType, sectionKey: string, mode: AiCoCreateMode, userMessage?: string): Promise<string>
  getReadiness(projectId: string): Promise<ReadinessResult>
}

export interface ImportApi {
  document(projectId: string, filename: string, content: string): Promise<ImportedDocument>
  listDocuments(projectId: string): Promise<ImportedDocument[]>
  parseDocument(projectId: string, documentId: string): Promise<ParsedSegment[]>
  parseAll(projectId: string): Promise<void>
  parseAndMergeAll(projectId: string): Promise<MergeResult[]>
  mergeSegments(projectId: string, segmentIds: string[]): Promise<MergeResult[]>
  getConflicts(projectId: string): Promise<ConflictItem[]>
  deleteDocument(projectId: string, documentId: string): Promise<void>
}

export interface GuidedApi {
  getQuestions(projectId: string): Promise<GuidedQuestion[]>
  submitAnswers(
    projectId: string,
    answers: Array<{ questionId: string; answer: string; targetSection: BibleSectionType; targetKey: string }>
  ): Promise<void>
}

export interface LaunchApi {
  evaluate(projectId: string): Promise<ReadinessResult>
  generateSnapshot(projectId: string): Promise<LaunchSnapshot>
  getActiveSnapshot(projectId: string): Promise<LaunchSnapshot | null>
  lockAndStart(projectId: string, snapshotId: string): Promise<{ state: OrchestratorState; message: string }>
}

export interface BibleSegmentApi {
  list(projectId: string, documentId?: string): Promise<ParsedSegment[]>
  updateStatus(segmentId: string, status: string): Promise<void>
  delete(segmentId: string): Promise<void>
}

// ============================================================
// 第四期：叙事一致性与知识边界系统
// ============================================================

export interface ContractApi {
  getChapterContract(projectId: string, chapterId: string): Promise<ChapterContract | null>
  createChapterContract(projectId: string, chapterId: string, arcId: string | null, input: Partial<ChapterContract>): Promise<ChapterContract>
  updateChapterContract(id: string, patch: Partial<ChapterContract>): Promise<void>
  listContractsByArc(projectId: string, arcId: string): Promise<ChapterContract[]>
  generateChapterContract(projectId: string, chapterId: string, arcId: string | null): Promise<ChapterContract>
  getKnowledgeContract(projectId: string, chapterId: string): Promise<KnowledgeContract | null>
  createKnowledgeContract(projectId: string, chapterId: string, input: Partial<KnowledgeContract>): Promise<KnowledgeContract>
  updateKnowledgeContract(id: string, patch: Partial<KnowledgeContract>): Promise<void>
  generateKnowledgeContract(projectId: string, chapterId: string, povCharacterId: string | null): Promise<KnowledgeContract>
}

export interface FactLockApi {
  lockFact(projectId: string, characterId: string, factKey: string, factValue: string, lockLevel: FactLockLevel, allowedChangeEvents?: string[]): Promise<CharacterFactLock>
  unlockFact(id: string): Promise<void>
  getLocks(characterId: string): Promise<CharacterFactLock[]>
  getLocksForProject(projectId: string): Promise<CharacterFactLock[]>
  verifyFact(characterId: string, factKey: string, claimedValue: string): Promise<{ valid: boolean; reason: string }>
  changeFactWithEvent(characterId: string, factKey: string, newValue: string, eventId: string): Promise<void>
  batchLockFromSnapshot(projectId: string, snapshotData: Record<string, unknown>): Promise<number>
}

export interface DraftApi {
  getLatestDraft(chapterId: string): Promise<ChapterDraft | null>
  getDraft(id: string): Promise<ChapterDraft | null>
  listDrafts(chapterId: string): Promise<ChapterDraft[]>
  commitDraft(draftId: string): Promise<{ success: boolean; chapterId: string }>
  rejectDraft(draftId: string, reason: string): Promise<void>
  isCommitted(chapterId: string): Promise<boolean>
}

export interface GateApi {
  runPlanGate(projectId: string, chapterId: string): Promise<{
    verdict: string
    overall_passed: boolean
    fail_count: number
    critical_count: number
    summary: string
    recommended_model: string
    reports: Array<{
      check_type: string
      passed: boolean
      violations: Array<{ type: string; severity: string; detail: string; evidence?: string }>
      severity: string
    }>
  }>
  runDraftGate(draftId: string): Promise<{
    verdict: string
    overall_passed: boolean
    fail_count: number
    critical_count: number
    summary: string
    recommended_model: string
    reports: Array<{
      check_type: string
      passed: boolean
      violations: Array<{ type: string; severity: string; detail: string; evidence?: string }>
      severity: string
    }>
  }>
  getGateReports(draftId: string): Promise<DraftGateReport[]>
  getLatestVerdict(draftId: string): Promise<DraftGateVerdict | null>
  getVerdictsByChapter(chapterId: string): Promise<DraftGateVerdict[]>
}

export interface RoutingApi {
  listRules(projectId?: string): Promise<ModelRoutingRule[]>
  setRule(input: {
    project_id?: string | null
    agent_type: string
    task_type: string
    risk_level: 'low' | 'normal' | 'high' | 'critical'
    preferred_tier: ModelTier
    auto_escalate: boolean
  }): Promise<ModelRoutingRule>
  resolveModel(agentType: string, taskType: string, context?: { riskLevel?: string; forceTier?: ModelTier }): Promise<RoutingDecision>
  shouldEscalate(context: {
    failCount: number
    violationType?: string
    chapterImportance?: 'normal' | 'climax' | 'volume_start' | 'volume_end' | 'major_twist'
    userMarked?: boolean
  }): Promise<boolean>
}

export interface IntegrityApi {
  getEvaluationCases(): Promise<EvaluationCase[]>
  createEvaluationCase(input: Omit<EvaluationCase, 'id' | 'created_at'>): Promise<EvaluationCase>
  updateEvaluationCase(id: string, patch: Partial<EvaluationCase>): Promise<void>
  deleteEvaluationCase(id: string): Promise<void>
  runEvaluationCase(caseId: string, input: {
    projectId: string
    chapterId?: string
    draftId?: string
    content?: string
  }): Promise<EvaluationRunResult>
  runAllEvaluationCases(input: {
    projectId: string
    chapterId?: string
    draftId?: string
    content?: string
    category?: EvaluationCase['category']
  }): Promise<EvaluationRunResult[]>
}

export interface Api {
  system: SystemApi
  project: ProjectApi
  volume: VolumeApi
  chapter: ChapterApi
  character: CharacterApi
  location: LocationApi
  worldbuilding: WorldbuildingApi
  memory: MemoryApi
  ai: AiApi
  config: ConfigApi
  settings: SettingsApi
  orchestrator: OrchestratorApi
  bible: BibleApi
  import: ImportApi
  guided: GuidedApi
  launch: LaunchApi
  bibleSegment: BibleSegmentApi
  contract: ContractApi
  factLock: FactLockApi
  draft: DraftApi
  gate: GateApi
  routing: RoutingApi
  integrity: IntegrityApi
  on: EventApi['on']
}
