export const schema = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  cover_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volumes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  volume_id TEXT NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  plain_text TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapters_project_order ON chapters(project_id, sort_order);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT DEFAULT '[]',
  role TEXT DEFAULT '',
  appearance TEXT DEFAULT '',
  personality TEXT DEFAULT '',
  background TEXT DEFAULT '',
  relations TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id, name);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  related_characters TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS worldbuilding (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '其他',
  key TEXT NOT NULL,
  value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS memory_chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding BLOB,
  tags TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_project_source ON memory_chunks(project_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  context_refs TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aimsg_session ON ai_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS api_configs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_enc BLOB,
  llm_model TEXT DEFAULT '',
  embedding_model TEXT DEFAULT '',
  model_tier TEXT DEFAULT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  is_embedding_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============================================================
-- 二期：Agent 编排系统表
-- ============================================================

CREATE TABLE IF NOT EXISTS story_compass (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ending_direction TEXT DEFAULT '',
  core_conflict TEXT DEFAULT '',
  theme TEXT DEFAULT '',
  one_line_pitch TEXT DEFAULT '',
  genre TEXT DEFAULT '',
  sub_genre TEXT DEFAULT '',
  selling_point TEXT DEFAULT '',
  target_audience TEXT DEFAULT '',
  emotional_tone TEXT DEFAULT '',
  narrative_pov TEXT DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS title_candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  reasoning TEXT DEFAULT '',
  selected INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_arcs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  arc_type TEXT NOT NULL DEFAULT 'positive_change',
  starting_state TEXT DEFAULT '',
  ending_state TEXT DEFAULT '',
  core_lie TEXT DEFAULT '',
  core_truth TEXT DEFAULT '',
  transformation_nodes TEXT DEFAULT '[]',
  span TEXT NOT NULL DEFAULT 'project',
  volume_id TEXT,
  arc_id TEXT,
  is_protagonist INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_character_arcs_char ON character_arcs(project_id, character_id);

CREATE TABLE IF NOT EXISTS world_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general',
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  implications TEXT DEFAULT '',
  related_character_ids TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volume_arcs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  volume_number INTEGER NOT NULL,
  volume_title TEXT DEFAULT '',
  arc_number INTEGER NOT NULL,
  arc_title TEXT DEFAULT '',
  arc_goal TEXT DEFAULT '',
  arc_type TEXT DEFAULT 'rising',
  planned_chapters INTEGER NOT NULL DEFAULT 0,
  actual_chapters INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_volume_arcs_sort ON volume_arcs(project_id, volume_number, arc_number, sort_order);

CREATE TABLE IF NOT EXISTS arc_outlines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  arc_id TEXT NOT NULL REFERENCES volume_arcs(id) ON DELETE CASCADE,
  arc_opening TEXT DEFAULT '',
  arc_midpoint TEXT DEFAULT '',
  arc_climax TEXT DEFAULT '',
  arc_resolution TEXT DEFAULT '',
  planned_foreshadowings TEXT DEFAULT '[]',
  character_arc_plan TEXT DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS arc_chapter_plans (
  id TEXT PRIMARY KEY,
  arc_id TEXT NOT NULL REFERENCES volume_arcs(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  chapter_title TEXT DEFAULT '',
  chapter_goal TEXT DEFAULT '',
  scenes TEXT DEFAULT '[]',
  foreshadowing_plan TEXT DEFAULT '[]',
  pov_character_id TEXT,
  estimated_words INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS foreshadowing_ledger (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'plot',
  importance TEXT NOT NULL DEFAULT 'minor',
  planned_plant_arc_id TEXT,
  planned_plant_chapter INTEGER,
  planned_progress_points TEXT DEFAULT '[]',
  planned_payoff_arc_id TEXT,
  planned_payoff_chapter INTEGER,
  status TEXT NOT NULL DEFAULT 'unplanned',
  actual_plant_chapter_id TEXT,
  actual_payoff_chapter_id TEXT,
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_foreshadowing_status ON foreshadowing_ledger(project_id, status);

CREATE TABLE IF NOT EXISTS chapter_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  arc_id TEXT,
  chapter_number INTEGER NOT NULL,
  plan_content TEXT DEFAULT '',
  scenes TEXT DEFAULT '[]',
  pacing TEXT DEFAULT '',
  pov TEXT DEFAULT '',
  estimated_words INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapter_summaries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  summary TEXT DEFAULT '',
  key_events TEXT DEFAULT '[]',
  next_chapter_hint TEXT DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_state_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  state_description TEXT DEFAULT '',
  current_location TEXT DEFAULT '',
  current_goal TEXT DEFAULT '',
  emotional_state TEXT DEFAULT '',
  inventory TEXT DEFAULT '[]',
  key_relationships TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_character_snapshots ON character_state_snapshots(project_id, character_id, source_type);

CREATE TABLE IF NOT EXISTS character_relationships (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_a_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  character_b_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  relationship_type TEXT DEFAULT '',
  description TEXT DEFAULT '',
  intensity INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relationships ON character_relationships(project_id, character_a_id, character_b_id);

CREATE TABLE IF NOT EXISTS world_state_changes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  category TEXT DEFAULT '',
  description TEXT DEFAULT '',
  before_state TEXT DEFAULT '',
  after_state TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS consistency_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  check_items TEXT DEFAULT '[]',
  issues TEXT DEFAULT '[]',
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS arc_summaries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  arc_id TEXT NOT NULL REFERENCES volume_arcs(id) ON DELETE CASCADE,
  summary TEXT DEFAULT '',
  character_progression TEXT DEFAULT '{}',
  foreshadowing_status TEXT DEFAULT '[]',
  world_state_summary TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volume_summaries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  volume_number INTEGER NOT NULL,
  summary TEXT DEFAULT '',
  compass_deviation TEXT DEFAULT '',
  quality_assessment TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  review_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  opinion TEXT DEFAULT '',
  polish_points TEXT DEFAULT '[]',
  rewrite_reason TEXT DEFAULT '',
  replan_suggestion TEXT DEFAULT '',
  dimension_scores TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_target ON review_records(project_id, review_type, target_id);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  mode TEXT DEFAULT '',
  context_snapshot TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  ended_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  round_number INTEGER NOT NULL DEFAULT 0,
  tool_name TEXT NOT NULL,
  tool_args TEXT DEFAULT '{}',
  tool_result TEXT DEFAULT '{}',
  thinking TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_session ON agent_decisions(session_id, round_number);

CREATE TABLE IF NOT EXISTS orchestration_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  reason TEXT DEFAULT '',
  details TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orch_log_project ON orchestration_log(project_id, created_at);

CREATE TABLE IF NOT EXISTS system_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  orchestrator_state TEXT NOT NULL DEFAULT 'idle',
  phase TEXT NOT NULL DEFAULT 'init',
  flow TEXT NOT NULL DEFAULT 'writing',
  lifecycle TEXT NOT NULL DEFAULT 'idle',
  current_volume_id TEXT,
  current_arc_id TEXT,
  current_chapter_id TEXT,
  current_chapter INTEGER NOT NULL DEFAULT 0,
  current_volume INTEGER NOT NULL DEFAULT 0,
  current_arc INTEGER NOT NULL DEFAULT 0,
  pending_rewrites TEXT DEFAULT '[]',
  foundation_missing TEXT DEFAULT '[]',
  active_agent TEXT,
  is_paused INTEGER NOT NULL DEFAULT 0,
  auto_mode INTEGER NOT NULL DEFAULT 0,
  paused_boundary TEXT DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  novel_name TEXT DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'init',
  flow TEXT NOT NULL DEFAULT 'writing',
  current_chapter INTEGER NOT NULL DEFAULT 0,
  total_chapters INTEGER NOT NULL DEFAULT 0,
  completed_chapters TEXT DEFAULT '[]',
  pending_rewrites TEXT DEFAULT '[]',
  total_word_count INTEGER NOT NULL DEFAULT 0,
  layered INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory_chunks USING vec0(
  embedding float[1536]
);

-- ============================================================
-- 第三期：Story Bible 初始化中心
-- ============================================================

CREATE TABLE IF NOT EXISTS story_bible_sections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,
  section_key TEXT NOT NULL,
  content TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  source_type TEXT DEFAULT 'manual',
  source_ref TEXT DEFAULT '',
  ai_candidate TEXT DEFAULT '',
  ai_candidate_mode TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bible_section ON story_bible_sections(project_id, section_type, section_key);

CREATE TABLE IF NOT EXISTS imported_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS parsed_segments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES imported_documents(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  detected_type TEXT NOT NULL,
  confidence REAL DEFAULT 0,
  target_section TEXT DEFAULT '',
  target_key TEXT DEFAULT '',
  merge_status TEXT NOT NULL DEFAULT 'pending',
  conflict_with TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parsed_seg ON parsed_segments(project_id, document_id, merge_status);

CREATE TABLE IF NOT EXISTS readiness_checks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,
  level TEXT NOT NULL,
  reason TEXT DEFAULT '',
  missing_items TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readiness ON readiness_checks(project_id, created_at);

CREATE TABLE IF NOT EXISTS launch_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  snapshot_data TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- ============================================================
-- 第四期：叙事一致性与知识边界系统
-- ============================================================

CREATE TABLE IF NOT EXISTS chapter_contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  arc_id TEXT,
  required_beats TEXT NOT NULL DEFAULT '[]',
  forbidden_moves TEXT NOT NULL DEFAULT '[]',
  continuity_checks TEXT NOT NULL DEFAULT '[]',
  emotion_target TEXT DEFAULT '',
  payoff_points TEXT NOT NULL DEFAULT '[]',
  hook_goal TEXT DEFAULT '',
  allowed_foreshadow_ids TEXT NOT NULL DEFAULT '[]',
  hard_constraints TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_chapter ON chapter_contracts(chapter_id);

CREATE TABLE IF NOT EXISTS knowledge_contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  pov_character_id TEXT,
  known_facts TEXT NOT NULL DEFAULT '[]',
  unknown_facts TEXT NOT NULL DEFAULT '[]',
  author_only_facts TEXT NOT NULL DEFAULT '[]',
  reader_visible_facts TEXT NOT NULL DEFAULT '[]',
  allowed_reveals TEXT NOT NULL DEFAULT '[]',
  forbidden_inferences TEXT NOT NULL DEFAULT '[]',
  allowed_foreshadow_ids TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'absolute',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kcontract_chapter ON knowledge_contracts(chapter_id);

CREATE TABLE IF NOT EXISTS character_fact_locks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  lock_level TEXT NOT NULL DEFAULT 'soft',
  change_requires_event INTEGER NOT NULL DEFAULT 0,
  allowed_change_events TEXT NOT NULL DEFAULT '[]',
  last_verified_chapter_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_factlock_unique ON character_fact_locks(character_id, fact_key);

CREATE TABLE IF NOT EXISTS chapter_drafts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  lifecycle TEXT NOT NULL DEFAULT 'draft_generated',
  model_used TEXT DEFAULT '',
  generated_at INTEGER NOT NULL,
  committed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_draft_chapter ON chapter_drafts(chapter_id, version);

CREATE TABLE IF NOT EXISTS draft_gate_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES chapter_drafts(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  check_type TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  violations TEXT NOT NULL DEFAULT '[]',
  severity TEXT NOT NULL DEFAULT 'info',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gate_draft ON draft_gate_reports(draft_id);

CREATE TABLE IF NOT EXISTS draft_gate_verdicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES chapter_drafts(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  overall_passed INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT DEFAULT '',
  recommended_model TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gate_verdict_draft ON draft_gate_verdicts(draft_id);

CREATE TABLE IF NOT EXISTS plan_gate_verdicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  overall_passed INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT DEFAULT '',
  recommended_model TEXT DEFAULT '',
  reports_json TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_gate_verdict_chapter ON plan_gate_verdicts(chapter_id);
CREATE INDEX IF NOT EXISTS idx_plan_gate_verdict_project ON plan_gate_verdicts(project_id);

CREATE TABLE IF NOT EXISTS model_routing_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  agent_type TEXT NOT NULL,
  task_type TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'normal',
  preferred_tier TEXT NOT NULL DEFAULT 'flash',
  auto_escalate INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routing_lookup ON model_routing_rules(agent_type, task_type, risk_level);

CREATE TABLE IF NOT EXISTS evaluation_cases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  setup_context TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  forbidden_output_patterns TEXT NOT NULL DEFAULT '[]',
  pass_criteria TEXT NOT NULL,
  fail_criteria TEXT NOT NULL,
  recommended_gate TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
`
