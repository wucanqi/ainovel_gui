export type ID = string

export interface Project {
  id: ID
  title: string
  summary: string
  cover_path: string | null
  created_at: number
  updated_at: number
}

export interface Volume {
  id: ID
  project_id: ID
  title: string
  sort_order: number
}

export interface Chapter {
  id: ID
  volume_id: ID
  project_id: ID
  title: string
  content: string
  plain_text: string
  sort_order: number
  word_count: number
  status: 'draft' | 'revising' | 'done'
  created_at: number
  updated_at: number
}

export interface Character {
  id: ID
  project_id: ID
  name: string
  aliases: string[]
  role: string
  appearance: string
  personality: string
  background: string
  relations: Array<{ target: ID; type: string; desc: string }>
  notes: string
  updated_at: number
}

export interface Location {
  id: ID
  project_id: ID
  name: string
  description: string
  related_characters: ID[]
}

export interface Worldbuilding {
  id: ID
  project_id: ID
  category: string
  key: string
  value: string
}

export type MemorySourceType = 'chapter' | 'character' | 'location' | 'lore' | 'foundation'

export interface MemoryChunk {
  id: ID
  project_id: ID
  source_type: MemorySourceType
  source_id: ID
  chunk_index: number
  content: string
  token_count: number
  created_at: number
  updated_at: number
}

export interface MemoryStats {
  totalChunks: number
  totalTokens: number
}

export interface RagParams {
  topK: number
  chapter_top: number
  character_top: number
  location_top: number
  lore_top: number
  foundation_top: number
  context_token_budget: number
  current_chapter_tail_chars: number
  enable_lore_injection: boolean
}

export const DEFAULT_RAG_PARAMS: RagParams = {
  topK: 15,
  chapter_top: 5,
  character_top: 3,
  location_top: 2,
  lore_top: 3,
  foundation_top: 8,
  context_token_budget: 8000,
  current_chapter_tail_chars: 2000,
  enable_lore_injection: true
}

export interface ApiProvider {
  id: ID
  provider: string
  base_url: string
  llm_model: string
  embedding_model: string
  model_tier: ModelTier | null
  is_active: number
  is_embedding_active: number
  has_key: boolean
}

export interface ApiProviderInput {
  provider: string
  base_url: string
  api_key: string
  llm_model: string
  embedding_model: string
  model_tier?: ModelTier | null
  is_active?: number
  is_embedding_active?: number
}

export interface SystemStatus {
  dbReady: boolean
  dbPath: string
  vecReady: boolean
  vecVersion: string
  tableCount: number
}

export type IpcEvent =
  | 'aiToken'
  | 'aiDone'
  | 'aiError'
  | 'memoryProgress'
  | 'memoryRebuilt'
  | 'agentThinking'
  | 'agentToolCall'
  | 'agentToolResult'
  | 'agentDone'
  | 'agentError'
  | 'agentAborted'
  | 'agentStateChange'
  | 'boundaryChanged'
  | 'checkpointReached'
  | 'coordinatorThinking'
  | 'subagentStart'
  | 'subagentDone'
  | 'subagentThinking'
  | 'subagentToolCall'
  | 'subagentToolResult'
  | 'phaseChanged'
  | 'flowChanged'
  | 'progressUpdated'
  | 'roundSummary'

export interface IpcEventPayloads {
  aiToken: { text: string }
  aiDone: { summary?: string }
  aiError: { message: string }
  memoryProgress: { current: number; total: number }
  memoryRebuilt: { chunks: number }
  agentThinking: { text: string; timestamp: number }
  agentToolCall: { toolName: string; args: Record<string, unknown> }
  agentToolResult: { toolName: string; result: unknown }
  agentDone: { summary: string }
  agentError: { message: string; timestamp: number }
  agentAborted: { message?: string }
  agentStateChange: { state: string; reason?: string }
  boundaryChanged: { changes: string[]; message: string }
  checkpointReached: { message: string; timestamp: number }
  coordinatorThinking: { text: string; timestamp: number }
  subagentStart: { agentType: string; task: string; timestamp: number }
  subagentDone: { agentType: string; done: boolean; summary: string; timestamp: number }
  subagentThinking: { agentType: string; text: string; timestamp: number }
  subagentToolCall: { agentType: string; toolName: string; args: Record<string, unknown>; timestamp: number }
  subagentToolResult: { agentType: string; toolName: string; success: boolean; error?: string; timestamp: number }
  phaseChanged: { from: string; to: string; reason?: string; timestamp: number }
  flowChanged: { from: string; to: string; reason?: string; timestamp: number }
  progressUpdated: { chapter: number; total: number; timestamp: number }
  roundSummary: { summary: string; timestamp: number }
}

export interface IpcEventListener {
  (payload: unknown): void
}

export interface RetrievedChunk {
  chunk_id: string
  source_type: MemorySourceType
  source_id: string
  content: string
  score: number
  token_count: number
}

export interface RagContext {
  chunks: RetrievedChunk[]
  current_chapter_tail: string
  total_tokens: number
}

export type AiTaskType = 'continue' | 'polish' | 'rewrite' | 'chat'

export interface AiSession {
  id: ID
  project_id: ID
  type: AiTaskType
  title: string
  created_at: number
}

export interface AiMessage {
  id: ID
  session_id: ID
  role: 'user' | 'assistant' | 'system'
  content: string
  context_refs: string[]
  created_at: number
}

export interface ContinueParams {
  project_id: ID
  chapter_id: ID
  cursor_before: string
}

export interface PolishParams {
  project_id: ID
  selected_text: string
  style: string
}

export interface RewriteParams {
  project_id: ID
  selected_text: string
  instruction?: string
}

export interface ChatParams {
  project_id: ID
  session_id?: ID
  message: string
  refs?: Array<{ type: MemorySourceType; id: ID }>
}

export interface JSONSchemaProperty {
  type: string
  description?: string
  items?: JSONSchemaProperty
  properties?: Record<string, JSONSchemaProperty>
  enum?: string[]
}

export interface JSONSchema {
  type: string
  properties: Record<string, JSONSchemaProperty>
  required?: string[]
}

// ============================================================
// 二期：Agent 编排系统类型
// ============================================================

export type OrchestratorState =
  | 'idle'
  | 'initializing'
  | 'architecting'
  | 'contract_generation'
  | 'plan_gate'
  | 'writing'
  | 'draft_gate'
  | 'arc_review_pending'
  | 'arc_review'
  | 'arc_passed'
  | 'polishing'
  | 'chapter_review'
  | 'chapter_rewrite'
  | 'next_arc_plan'
  | 'volume_review'
  | 'completed'

export type AgentType = 'architect' | 'writer' | 'editor'

export type ArcType = 'setup' | 'rising' | 'climax' | 'resolution' | 'transition'

export type ArcStatus = 'planned' | 'expanded' | 'in_progress' | 'completed'

export type ForeShadowingType = 'mystery' | 'character' | 'plot' | 'world' | 'relationship'

export type ForeShadowingImportance = 'major' | 'minor' | 'easter_egg'

export type ForeShadowingStatus = 'unplanned' | 'planted' | 'progressing' | 'payed_off' | 'abandoned'

export type ReviewVerdict = 'pass' | 'polish' | 'rewrite_chapter' | 'replan'

export type ReviewType = 'chapter' | 'arc' | 'volume'

export type CharacterArcType = 'positive_change' | 'negative_change' | 'flat' | 'fall_redemption'

export type CharacterArcSpan = 'project' | 'volume' | 'multi_volume'

export interface StoryCompass {
  id: ID
  project_id: ID
  ending_direction: string
  core_conflict: string
  theme: string
  one_line_pitch: string
  genre: string
  sub_genre: string
  selling_point: string
  target_audience: string
  emotional_tone: string
  narrative_pov: string
  version: number
  created_at: number
  updated_at: number
}

export interface TitleCandidate {
  id: ID
  project_id: ID
  title: string
  reasoning: string
  selected: number
  created_at: number
}

export interface CharacterArc {
  id: ID
  project_id: ID
  character_id: ID
  arc_type: CharacterArcType
  starting_state: string
  ending_state: string
  core_lie: string
  core_truth: string
  transformation_nodes: Array<{ node: string; chapter?: number }>
  span: CharacterArcSpan
  volume_id: ID | null
  arc_id: ID | null
  is_protagonist: number
  version: number
  created_at: number
  updated_at: number
}

export interface WorldRule {
  id: ID
  project_id: ID
  category: string
  name: string
  description: string
  implications: string
  related_character_ids: ID[]
  created_at: number
  updated_at: number
}

export interface VolumeArc {
  id: ID
  project_id: ID
  volume_number: number
  volume_title: string
  arc_number: number
  arc_title: string
  arc_goal: string
  arc_type: ArcType
  planned_chapters: number
  actual_chapters: number
  status: ArcStatus
  sort_order: number
  created_at: number
  updated_at: number
}

export interface ArcOutline {
  id: ID
  project_id: ID
  arc_id: ID
  arc_opening: string
  arc_midpoint: string
  arc_climax: string
  arc_resolution: string
  planned_foreshadowings: string[]
  character_arc_plan: Record<string, unknown>
  version: number
  created_at: number
  updated_at: number
}

export interface ArcChapterPlan {
  id: ID
  arc_id: ID
  chapter_number: number
  chapter_title: string
  chapter_goal: string
  scenes: Array<{ description: string; location?: string }>
  foreshadowing_plan: Array<{ foreshadowing_id: string; action: 'plant' | 'progress' | 'payoff' }>
  pov_character_id: ID | null
  estimated_words: number
  status: 'planned' | 'written'
  created_at: number
  updated_at: number
}

export interface ForeShadowingEntry {
  id: ID
  project_id: ID
  name: string
  content: string
  type: ForeShadowingType
  importance: ForeShadowingImportance
  planned_plant_arc_id: ID | null
  planned_plant_chapter: number | null
  planned_progress_points: Array<{ arc_id: string; chapter: number }>
  planned_payoff_arc_id: ID | null
  planned_payoff_chapter: number | null
  status: ForeShadowingStatus
  actual_plant_chapter_id: ID | null
  actual_payoff_chapter_id: ID | null
  notes: string
  created_at: number
  updated_at: number
}

export interface ChapterPlan {
  id: ID
  project_id: ID
  chapter_id: ID
  arc_id: ID | null
  chapter_number: number
  plan_content: string
  scenes: Array<{ description: string; location?: string; characters?: string[] }>
  pacing: string
  pov: string
  estimated_words: number
  created_at: number
  updated_at: number
}

export interface ChapterSummary {
  id: ID
  project_id: ID
  chapter_id: ID
  summary: string
  key_events: string[]
  next_chapter_hint: string
  word_count: number
  created_at: number
  updated_at: number
}

export interface CharacterStateSnapshot {
  id: ID
  project_id: ID
  character_id: ID
  source_type: 'chapter' | 'arc' | 'volume'
  source_id: ID
  state_description: string
  current_location: string
  current_goal: string
  emotional_state: string
  inventory: string[]
  key_relationships: Record<string, string>
  created_at: number
  updated_at: number
}

export interface CharacterRelationship {
  id: ID
  project_id: ID
  character_a_id: ID
  character_b_id: ID
  relationship_type: string
  description: string
  intensity: number
  updated_at: number
}

export interface WorldStateChange {
  id: ID
  project_id: ID
  chapter_id: ID | null
  category: string
  description: string
  before_state: string
  after_state: string
  created_at: number
}

export interface ConsistencyReport {
  id: ID
  project_id: ID
  chapter_id: ID | null
  check_items: string[]
  issues: string[]
  resolved: number
  created_at: number
}

export interface ArcSummary {
  id: ID
  project_id: ID
  arc_id: ID
  summary: string
  character_progression: Record<string, string>
  foreshadowing_status: Array<{ id: string; status: string }>
  world_state_summary: string
  created_at: number
  updated_at: number
}

export interface VolumeSummary {
  id: ID
  project_id: ID
  volume_number: number
  summary: string
  compass_deviation: string
  quality_assessment: string
  created_at: number
  updated_at: number
}

export interface ReviewRecord {
  id: ID
  project_id: ID
  review_type: ReviewType
  target_id: ID
  verdict: ReviewVerdict
  opinion: string
  polish_points: Array<{ chapter_id: string; point: string }>
  rewrite_reason: string
  replan_suggestion: string
  dimension_scores: Record<string, number>
  created_at: number
}

export interface AgentSession {
  id: ID
  project_id: ID
  agent_type: AgentType
  mode: string
  context_snapshot: string
  status: 'running' | 'completed' | 'aborted'
  ended_at: number | null
  created_at: number
}

export interface AgentDecision {
  id: ID
  project_id: ID
  session_id: ID
  agent_type: AgentType
  round_number: number
  tool_name: string
  tool_args: Record<string, unknown>
  tool_result: Record<string, unknown>
  thinking: string
  created_at: number
}

export interface OrchestrationLogEntry {
  id: ID
  project_id: ID
  event_type: string
  from_state: OrchestratorState | null
  to_state: OrchestratorState | null
  reason: string
  details: Record<string, unknown>
  created_at: number
}

export type ExecutionMode =
  | 'semi_auto'
  | 'full_auto'
  | 'arc_auto'
  | 'node_review'

export interface SystemState {
  project_id: ID
  phase: Phase
  flow: Flow
  lifecycle: Lifecycle
  current_chapter: number
  current_volume: number
  current_arc: number
  pending_rewrites: number[]
  foundation_missing: string[]
  is_paused: number
  auto_mode: number
  // legacy compat (old orchestrator references)
  orchestrator_state?: OrchestratorState
  current_volume_id?: string | null
  current_arc_id?: string | null
  current_chapter_id?: string | null
  active_agent?: AgentType | null
  paused_boundary?: string
  updated_at: number
}

// ============================================================
// 重构：Coordinator/Flow/Router 类型
// ============================================================

export type Phase = 'init' | 'premise' | 'outline' | 'writing' | 'complete'

export type Flow = 'writing' | 'reviewing' | 'rewriting' | 'polishing' | 'steering'

export type Lifecycle = 'idle' | 'running' | 'paused' | 'completed'

export interface Progress {
  project_id: ID
  novel_name: string
  phase: Phase
  flow: Flow
  current_chapter: number
  total_chapters: number
  completed_chapters: number[]
  pending_rewrites: number[]
  total_word_count: number
  layered: number
  updated_at: number
}

export interface RouteState {
  phase: Phase
  flow: Flow
  lastCompleted: number
  nextChapter: number
  nextChapterId: string | null
  nextChapterTitle: string | null
  totalPlannedChapters: number
  pendingRewrites: number[]
  arcBoundary: {
    isArcEnd: boolean
    isVolumeEnd: boolean
    volume: number
    arc: number
    nextArc: number
    nextVolume: number
    needsExpansion: boolean
    needsNewVolume: boolean
  } | null
  hasArcReview: boolean
  hasArcSummary: boolean
  hasVolumeSummary: boolean
  foundationMissing: string[]
  chapterReadiness: {
    chapterId: string | null
    chapterNumber: number
    chapterTitle: string | null
    chapterContractReady: boolean
    knowledgeContractReady: boolean
    blockingIssues: string[]
    readyToWrite: boolean
  } | null
}

export interface Instruction {
  agent: 'architect' | 'architect_long' | 'writer' | 'editor'
  task: string
  reason: string
  chapter?: number
}

export type HostActionType = 'dispatch_agent' | 'wait' | 'transition' | 'recover'

export interface HostAction {
  type: HostActionType
  agent?: 'architect' | 'architect_long' | 'writer' | 'editor'
  task?: string
  reason: string
  targetState?: OrchestratorState
  metadata?: Record<string, unknown>
}

export type CheckpointType =
  | 'chapter_done'
  | 'arc_done'
  | 'volume_done'
  | 'gate_failed'
  | 'agent_error'
  | 'agent_aborted'
  | 'user_paused'
  | 'boundary_changed'

export interface CheckpointPayload {
  checkpoint_type: CheckpointType
  current_arc_id: string | null
  current_chapter_id: string | null
  completed_chapters: number
  total_chapters_in_arc: number
  last_review_verdict: string | null
  message: string
  timestamp: number
}

export interface RecoveryStatus {
  needsRecovery: boolean
  lastState: OrchestratorState
  lastActiveAgent: AgentType | null
  abortedSessions: number
  lastActivityAt: number | null
  message: string
}

// ============================================================
// 二期：工具调用协议类型
// ============================================================

export interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
}

export interface AgentResponse {
  thinking: string
  tool_calls: ToolCall[]
  done: boolean
  summary: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema
  handler: (projectId: string, args: Record<string, unknown>) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface AgentContext {
  projectId: string
  agentType: AgentType
  mode: string
  systemPrompt: string
  context: string
  tools: ToolDefinition[]
}

export interface BoundaryConditions {
  canWrite: boolean
  arcHasMoreChapters: boolean
  arcDone: boolean
  volumeDone: boolean
  reviewDone: boolean
  reviewVerdict: ReviewVerdict | null
  arcSummarized: boolean
  hasMoreArcsInVolume: boolean
  nextArcPlanned: boolean
  hasMoreVolumes: boolean
  architectureReady: boolean
  currentChapterId: string | null
  currentArcId: string | null
  currentVolumeId: string | null
}

// ============================================================
// 第三期：Story Bible 初始化中心
// ============================================================

export type BibleSectionType =
  | 'positioning'
  | 'compass'
  | 'world'
  | 'characters'
  | 'structure'
  | 'foreshadowing'
  | 'style'

export type BibleFieldStatus = 'draft' | 'confirmed' | 'pending' | 'deprecated'

export type BibleSourceType = 'manual' | 'import' | 'ai_suggest' | 'guided'

export type AiCoCreateMode =
  | 'complete'
  | 'question'
  | 'variant'
  | 'merge'
  | 'compress'
  | 'expand'

export interface BibleField {
  id: string
  project_id: ID
  section_type: BibleSectionType
  section_key: string
  content: string
  status: BibleFieldStatus
  source_type: BibleSourceType
  source_ref: string
  ai_candidate: string
  ai_candidate_mode: AiCoCreateMode | ''
  created_at: number
  updated_at: number
}

export interface StoryBible {
  positioning: BibleField[]
  compass: BibleField[]
  world: BibleField[]
  characters: BibleField[]
  structure: BibleField[]
  foreshadowing: BibleField[]
  style: BibleField[]
}

export interface ImportedDocument {
  id: string
  project_id: ID
  filename: string
  content: string
  char_count: number
  status: 'pending' | 'parsed' | 'merged' | 'ignored'
  created_at: number
}

export type ParsedSegmentType =
  | 'world'
  | 'character'
  | 'plot'
  | 'outline'
  | 'volume'
  | 'arc'
  | 'chapter_draft'
  | 'foreshadowing'
  | 'style'
  | 'taboo'
  | 'inspiration'
  | 'reference'
  | 'unclassified'

export interface ParsedSegment {
  id: string
  project_id: ID
  document_id: string
  segment_index: number
  raw_text: string
  detected_type: ParsedSegmentType
  confidence: number
  target_section: BibleSectionType | ''
  target_key: string
  merge_status: 'pending' | 'merged' | 'ignored' | 'conflict' | 'deprecated'
  conflict_with: string
  created_at: number
}

export type ReadinessLevel = 'sufficient' | 'weak' | 'insufficient' | 'missing'

export interface ReadinessSectionResult {
  section_type: BibleSectionType
  level: ReadinessLevel
  reason: string
  missing_items: string[]
}

export interface ReadinessResult {
  overall: 'can_launch' | 'suggest_supplement' | 'need_guidance' | 'inspiration_only'
  sections: ReadinessSectionResult[]
  can_force_launch: boolean
}

export interface GuidedQuestion {
  id: string
  question: string
  target_section: BibleSectionType
  target_key: string
  options?: string[]
  allow_ai_decide: boolean
}

export interface LaunchSnapshot {
  id: string
  project_id: ID
  version: number
  snapshot_data: Record<string, unknown>
  is_active: boolean
  created_at: number
}

export interface MergeResult {
  segment_id: string
  success: boolean
  target_field_id?: string
  error?: string
}

export interface ConflictItem {
  segment_id: string
  segment_text: string
  conflict_field_id: string
  conflict_field_content: string
  section_type: BibleSectionType
  section_key: string
  reason: string
}

// ============================================================
// 第四期：叙事一致性与知识边界系统
// ============================================================

export type FactLockLevel = 'immutable' | 'event_required' | 'soft'

export type DraftLifecycle =
  | 'draft_generated'
  | 'plan_checked'
  | 'draft_checked'
  | 'draft_rejected'
  | 'draft_revised'
  | 'final_committed'
  | 'indexed_to_memory'

export type GateCheckType =
  | 'consistency'
  | 'contract'
  | 'knowledge'
  | 'fact_lock'
  | 'foreshadow'
  | 'timeline'
  | 'world_rule'

export type GateSeverity = 'info' | 'warning' | 'error' | 'critical'

export type GateVerdictType = 'pass' | 'polish' | 'rewrite' | 'replan' | 'escalate'

export type ModelTier = 'flash' | 'pro'

export interface ChapterContract {
  id: ID
  project_id: ID
  chapter_id: ID
  arc_id: ID | null
  required_beats: string[]
  forbidden_moves: string[]
  continuity_checks: string[]
  emotion_target: string
  payoff_points: string[]
  hook_goal: string
  allowed_foreshadow_ids: string[]
  hard_constraints: string[]
  status: 'active' | 'fulfilled' | 'violated' | 'superseded'
  created_at: number
  updated_at: number
}

export interface KnowledgeContract {
  id: ID
  project_id: ID
  chapter_id: ID
  pov_character_id: ID | null
  known_facts: string[]
  unknown_facts: string[]
  author_only_facts: string[]
  reader_visible_facts: string[]
  allowed_reveals: string[]
  forbidden_inferences: string[]
  allowed_foreshadow_ids: string[]
  priority: 'absolute' | 'high' | 'normal'
  created_at: number
  updated_at: number
}

export interface CharacterFactLock {
  id: ID
  project_id: ID
  character_id: ID
  fact_key: string
  fact_value: string
  lock_level: FactLockLevel
  change_requires_event: boolean
  allowed_change_events: string[]
  last_verified_chapter_id: ID | null
  created_at: number
  updated_at: number
}

export interface ChapterDraft {
  id: ID
  project_id: ID
  chapter_id: ID
  version: number
  content: string
  plain_text: string
  word_count: number
  lifecycle: DraftLifecycle
  model_used: string
  generated_at: number
  committed_at: number | null
}

export interface GateViolation {
  type: string
  severity: GateSeverity
  detail: string
  evidence?: string
}

export interface GateCheckResult {
  check_type: GateCheckType
  passed: boolean
  violations: GateViolation[]
  severity: GateSeverity
}

export interface DraftGateReport {
  id: ID
  project_id: ID
  draft_id: ID
  chapter_id: ID
  check_type: GateCheckType
  passed: boolean
  violations: GateViolation[]
  severity: GateSeverity
  created_at: number
}

export interface DraftGateVerdict {
  id: ID
  project_id: ID
  draft_id: ID
  chapter_id: ID
  verdict: GateVerdictType
  overall_passed: boolean
  fail_count: number
  critical_count: number
  summary: string
  recommended_model: string
  created_at: number
}

export interface ModelRoutingRule {
  id: ID
  project_id: ID | null
  agent_type: string
  task_type: string
  risk_level: 'low' | 'normal' | 'high' | 'critical'
  preferred_tier: ModelTier
  auto_escalate: boolean
  created_at: number
}

export interface RoutingDecision {
  tier: ModelTier
  model: string
  provider_id?: ID | null
  reason: string
  auto_escalate: boolean
}

export interface EvaluationRunResult {
  case_id: ID
  case_name: string
  category: EvaluationCase['category']
  passed: boolean
  matches: string[]
  details: string
  recommended_gate: EvaluationCase['recommended_gate']
}

export interface EvaluationCase {
  id: ID
  name: string
  category: 'knowledge_leak' | 'fact_drift' | 'foreshadow_violation' | 'timeline' | 'world_rule' | 'relationship'
  setup_context: Record<string, unknown>
  expected_behavior: string
  forbidden_output_patterns: string[]
  pass_criteria: string
  fail_criteria: string
  recommended_gate: 'draft_gate' | 'plan_gate' | 'knowledge_check'
  enabled: boolean
  created_at: number
}
