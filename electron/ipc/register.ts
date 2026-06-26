import { ipcMain } from 'electron'
import * as projectService from '../services/project.service'
import * as volumeService from '../services/volume.service'
import * as chapterService from '../services/chapter.service'
import * as characterService from '../services/character.service'
import * as locationService from '../services/location.service'
import * as worldbuildingService from '../services/worldbuilding.service'
import * as memoryService from '../services/memory.service'
import * as aiService from '../services/ai.service'
import * as embeddingService from '../services/embedding.service'
import * as configService from '../services/config.service'
import * as settingsService from '../services/settings.service'
import { getDbPath, getVecVersion, getTableCount, getDb } from '../db'
import { resetCompactState } from '../services/compaction'
import { getHost } from '../services/host'
import { executeTool, getAllToolNames } from '../services/tool-executor'
import * as bibleService from '../services/story-bible.service'
import * as importService from '../services/import.service'
import * as bibleAiService from '../services/bible-ai.service'
import * as readinessService from '../services/readiness.service'
import * as launchService from '../services/launch.service'
import * as contractService from '../services/contract.service'
import * as factLockService from '../services/fact-lock.service'
import * as draftService from '../services/draft.service'
import * as draftGateService from '../services/draft-gate.service'
import * as modelRouterService from '../services/model-router.service'
import * as evaluationCasesService from '../services/evaluation-cases.service'
import * as evaluatorService from '../services/evaluator.service'
import type {
  ApiProviderInput,
  Character,
  Location,
  Worldbuilding,
  ContinueParams,
  PolishParams,
  RewriteParams,
  ChatParams,
  RagParams,
  BibleSectionType,
  BibleFieldStatus,
  AiCoCreateMode,
  ChapterContract,
  KnowledgeContract,
  FactLockLevel,
  ModelTier
} from '@shared/types'

export function registerIpc(): void {
  ipcMain.handle('system:status', () => {
    return {
      dbReady: true,
      dbPath: getDbPath(),
      vecReady: !!getVecVersion(),
      vecVersion: getVecVersion(),
      tableCount: getTableCount()
    }
  })

  ipcMain.handle('project:list', () => projectService.list())
  ipcMain.handle('project:get', (_e, id: string) => projectService.get(id))
  ipcMain.handle('project:create', (_e, input: { title: string; summary?: string }) =>
    projectService.create(input)
  )
  ipcMain.handle(
    'project:update',
    (_e, id: string, input: { title?: string; summary?: string }) =>
      projectService.update(id, input)
  )
  ipcMain.handle('project:delete', (_e, id: string) => {
    resetCompactState(id)
    return projectService.remove(id)
  })

  ipcMain.handle('volume:list', (_e, projectId: string) => volumeService.list(projectId))
  ipcMain.handle(
    'volume:create',
    (_e, input: { project_id: string; title: string }) => volumeService.create(input)
  )
  ipcMain.handle('volume:update', (_e, id: string, input: { title?: string }) =>
    volumeService.update(id, input)
  )
  ipcMain.handle('volume:delete', (_e, id: string) => volumeService.remove(id))
  ipcMain.handle(
    'volume:reorder',
    (_e, orders: Array<{ id: string; sort_order: number }>) => volumeService.reorder(orders)
  )

  ipcMain.handle('chapter:list', (_e, volumeId: string) => chapterService.list(volumeId))
  ipcMain.handle('chapter:get', (_e, id: string) => chapterService.get(id))
  ipcMain.handle(
    'chapter:create',
    (_e, input: { project_id: string; volume_id: string; title: string }) =>
      chapterService.create(input)
  )
  ipcMain.handle(
    'chapter:update',
    (_e, id: string, input: { title?: string; content?: string; status?: string }) =>
      chapterService.update(id, input)
  )
  ipcMain.handle('chapter:delete', (_e, id: string) => chapterService.remove(id))
  ipcMain.handle(
    'chapter:reorder',
    (_e, orders: Array<{ id: string; sort_order: number }>) => chapterService.reorder(orders)
  )
  ipcMain.handle('chapter:move', (_e, id: string, volumeId: string) =>
    chapterService.move(id, volumeId)
  )

  ipcMain.handle('character:list', (_e, projectId: string) =>
    characterService.list(projectId)
  )
  ipcMain.handle(
    'character:create',
    (_e, input: { project_id: string; name: string }) => characterService.create(input)
  )
  ipcMain.handle(
    'character:update',
    (_e, id: string, input: Partial<Omit<Character, 'id' | 'project_id' | 'updated_at'>>) =>
      characterService.update(id, input)
  )
  ipcMain.handle('character:delete', (_e, id: string) => characterService.remove(id))

  ipcMain.handle('location:list', (_e, projectId: string) =>
    locationService.list(projectId)
  )
  ipcMain.handle(
    'location:create',
    (_e, input: { project_id: string; name: string }) => locationService.create(input)
  )
  ipcMain.handle(
    'location:update',
    (_e, id: string, input: Partial<Omit<Location, 'id' | 'project_id'>>) =>
      locationService.update(id, input)
  )
  ipcMain.handle('location:delete', (_e, id: string) => locationService.remove(id))

  ipcMain.handle('worldbuilding:list', (_e, projectId: string) =>
    worldbuildingService.list(projectId)
  )
  ipcMain.handle(
    'worldbuilding:create',
    (_e, input: { project_id: string; category: string; key: string; value: string }) =>
      worldbuildingService.create(input)
  )
  ipcMain.handle(
    'worldbuilding:update',
    (_e, id: string, input: Partial<Omit<Worldbuilding, 'id' | 'project_id'>>) =>
      worldbuildingService.update(id, input)
  )
  ipcMain.handle('worldbuilding:delete', (_e, id: string) => worldbuildingService.remove(id))

  ipcMain.handle(
    'memory:listChunks',
    (_e, projectId: string, filter?: { source_type?: string }) =>
      memoryService.listChunks(projectId, filter as never)
  )
  ipcMain.handle('memory:getStats', (_e, projectId: string) =>
    memoryService.getStats(projectId)
  )
  ipcMain.handle('memory:deleteChunk', (_e, id: string) => memoryService.deleteChunk(id))
  ipcMain.handle(
    'memory:insertChunk',
    (_e, input: {
      project_id: string
      source_type: string
      source_id: string
      chunk_index: number
      content: string
    }) => memoryService.insertChunk(input as never)
  )
  ipcMain.handle('memory:rebuildChapter', (_e, projectId: string, chapterId: string) =>
    memoryService.rebuildChapter(projectId, chapterId)
  )
  ipcMain.handle(
    'memory:rebuildLore',
    (_e, projectId: string, sourceType: string, sourceId: string) =>
      memoryService.rebuildLore(projectId, sourceType as never, sourceId)
  )
  ipcMain.handle('memory:rebuildAll', (_e, projectId: string) =>
    memoryService.rebuildAll(projectId)
  )
  ipcMain.handle('memory:search', (_e, projectId: string, query: string, topK?: number) =>
    memoryService.search(projectId, query, topK)
  )
  ipcMain.handle(
    'memory:buildContext',
    (_e, projectId: string, query: string, currentChapterId?: string) =>
      memoryService.buildContext(projectId, query, currentChapterId)
  )

  ipcMain.handle('ai:continue', (_e, params: ContinueParams) => aiService.continueWrite(params))
  ipcMain.handle('ai:polish', (_e, params: PolishParams) => aiService.polish(params))
  ipcMain.handle('ai:rewrite', (_e, params: RewriteParams) => aiService.rewrite(params))
  ipcMain.handle('ai:chat', (_e, params: ChatParams) => aiService.chat(params))
  ipcMain.handle('ai:stop', () => aiService.stop())
  ipcMain.handle('ai:listSessions', (_e, projectId: string) =>
    aiService.listSessions(projectId)
  )
  ipcMain.handle('ai:getMessages', (_e, sessionId: string) =>
    aiService.getMessages(sessionId)
  )
  ipcMain.handle('ai:deleteSession', (_e, id: string) => aiService.deleteSession(id))

  ipcMain.handle('settings:getRagParams', () => settingsService.getRagParams())
  ipcMain.handle('settings:setRagParams', (_e, params: RagParams) =>
    settingsService.setRagParams(params)
  )

  ipcMain.handle('config:listProviders', () => configService.list())
  ipcMain.handle('config:saveProvider', (_e, input: ApiProviderInput) =>
    configService.save(input)
  )
  ipcMain.handle('config:setActiveProvider', (_e, id: string) => configService.setActive(id))
  ipcMain.handle('config:setActiveEmbedding', (_e, id: string) => configService.setActiveEmbedding(id))
  ipcMain.handle('config:deleteProvider', (_e, id: string) => configService.remove(id))
  ipcMain.handle('config:encryptionAvailable', () => configService.encryptionAvailable())

  ipcMain.handle('config:testEmbedding', async () => {
    console.log('[IPC] config:testEmbedding')
    return embeddingService.testEmbeddingConnection()
  })

  ipcMain.handle('orchestrator:start', async (event, projectId: string) => {
    console.log('[IPC] orchestrator:start', { projectId })
    try {
      const host = getHost(projectId)
      const sender = event.sender
      const s = (ch: string, p: unknown) => { try { sender.send(`event:${ch}`, p) } catch { /* */ } }
      const ts = () => Date.now()

      host.setCallbacks({
        onSystem: (text) => s('agentThinking', { text, timestamp: ts() }),
        onCoordinatorThinking: (text) => s('coordinatorThinking', { text, timestamp: ts() }),
        onSubAgentStart: (agentType, task) => s('subagentStart', { agentType, task, timestamp: ts() }),
        onSubAgentDone: (agentType, done, summary) => s('subagentDone', { agentType, done, summary, timestamp: ts() }),
        onSubAgentThinking: (agentType, text) => s('subagentThinking', { agentType, text: text.slice(0, 500), timestamp: ts() }),
        onSubAgentToolCall: (agentType, toolName, args) => s('subagentToolCall', { agentType, toolName, args, timestamp: ts() }),
        onSubAgentToolResult: (agentType, toolName, success, error) => s('subagentToolResult', { agentType, toolName, success, error, timestamp: ts() }),
        onPhaseChange: (from, to, reason) => s('phaseChanged', { from, to, reason, timestamp: ts() }),
        onFlowChange: (from, to, reason) => s('flowChanged', { from, to, reason, timestamp: ts() }),
        onProgress: (chapter, total) => s('progressUpdated', { chapter, total, timestamp: ts() }),
        onCheckpoint: (message) => s('checkpointReached', { message, timestamp: ts() })
      })

      const result = await host.start()
      console.log('[IPC] orchestrator:start ->', result)

      // Start continuous loop in background
      setImmediate(() => {
        host.runLoop().catch(e => {
          console.error('[IPC] runLoop error:', e)
          s('agentError', { message: (e as Error).message, timestamp: ts() })
        })
      })

      return result
    } catch (e) {
      console.error('[IPC] orchestrator:start ERROR', e)
      throw e
    }
  })

  ipcMain.handle('orchestrator:resume', async (event, projectId: string) => {
    console.log('[IPC] orchestrator:resume', { projectId })
    try {
      const host = getHost(projectId)
      const sender = event.sender
      const s = (ch: string, p: unknown) => { try { sender.send(`event:${ch}`, p) } catch { /* */ } }
      const ts = () => Date.now()

      host.setCallbacks({
        onSystem: (text) => s('agentThinking', { text, timestamp: ts() }),
        onCoordinatorThinking: (text) => s('coordinatorThinking', { text, timestamp: ts() }),
        onSubAgentStart: (agentType, task) => s('subagentStart', { agentType, task, timestamp: ts() }),
        onSubAgentDone: (agentType, done, summary) => s('subagentDone', { agentType, done, summary, timestamp: ts() }),
        onSubAgentThinking: (agentType, text) => s('subagentThinking', { agentType, text: text.slice(0, 500), timestamp: ts() }),
        onSubAgentToolCall: (agentType, toolName, args) => s('subagentToolCall', { agentType, toolName, args, timestamp: ts() }),
        onSubAgentToolResult: (agentType, toolName, success, error) => s('subagentToolResult', { agentType, toolName, success, error, timestamp: ts() }),
        onPhaseChange: (from, to, reason) => s('phaseChanged', { from, to, reason, timestamp: ts() }),
        onFlowChange: (from, to, reason) => s('flowChanged', { from, to, reason, timestamp: ts() }),
        onProgress: (chapter, total) => s('progressUpdated', { chapter, total, timestamp: ts() }),
        onCheckpoint: (message) => s('checkpointReached', { message, timestamp: ts() })
      })

      await host.resume()

      setImmediate(() => {
        host.runLoop().catch(e => {
          console.error('[IPC] runLoop error:', e)
          s('agentError', { message: (e as Error).message, timestamp: ts() })
        })
      })

      return { phase: host.getPhase(), message: '编排器已恢复' }
    } catch (e) {
      console.error('[IPC] orchestrator:resume ERROR', e)
      throw e
    }
  })

  ipcMain.handle('orchestrator:pause', async (_e, projectId: string) => {
    console.log('[IPC] orchestrator:pause', { projectId })
    try {
      const host = getHost(projectId)
      await host.pause()
    } catch (e) {
      console.error('[IPC] orchestrator:pause ERROR', e)
      throw e
    }
  })

  ipcMain.handle('orchestrator:reset', async (_e, projectId: string) => {
    console.log('[IPC] orchestrator:reset', { projectId })
    try {
      const host = getHost(projectId)
      await host.reset()
      return { state: 'idle', message: '编排器已重置' }
    } catch (e) {
      console.error('[IPC] orchestrator:reset ERROR', e)
      throw e
    }
  })

  ipcMain.handle('orchestrator:steer', async (_e, projectId: string, text: string) => {
    console.log('[IPC] orchestrator:steer', { projectId, textLen: text?.length })
    try {
      const host = getHost(projectId)
      await host.steer(text)
    } catch (e) {
      console.error('[IPC] orchestrator:steer ERROR', e)
      throw e
    }
  })

  ipcMain.handle('orchestrator:getState', (_e, projectId: string) => {
    const host = getHost(projectId)
    const state = host.getState()
    console.log('[IPC] orchestrator:getState', { projectId, phase: (state as Record<string,unknown>)?.phase })
    return state
  })

  ipcMain.handle('orchestrator:getProgress', (_e, projectId: string) => {
    const host = getHost(projectId)
    return host.getProgress()
  })

  ipcMain.handle('orchestrator:getLogs', (_e, projectId: string, limit?: number) => {
    const db = getDb()
    const rows = db.prepare(
      `SELECT * FROM orchestration_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(projectId, limit ?? 100) as Array<Record<string, unknown>>
    return rows.map(r => ({
      ...r,
      details: typeof r.details === 'string' ? JSON.parse(r.details as string) : r.details
    }))
  })

  ipcMain.handle('orchestrator:getSessions', (_e, projectId: string) => {
    const db = getDb()
    return db.prepare(
      `SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY created_at DESC`
    ).all(projectId)
  })

  ipcMain.handle('orchestrator:getRecoveryStatus', (_e, projectId: string) => {
    const host = getHost(projectId)
    const lifecycle = host.getLifecycle()
    const phase = host.getPhase()
    const needsRecovery = lifecycle === 'paused'
    return {
      needsRecovery,
      lastState: phase as string,
      lastActiveAgent: null,
      abortedSessions: 0,
      lastActivityAt: null,
      message: needsRecovery ? '编排器处于暂停状态' : '编排器空闲'
    }
  })

  // ── Story Bible ──
  ipcMain.handle('bible:get', (_e, projectId: string) =>
    bibleService.getStoryBible(projectId)
  )
  ipcMain.handle(
    'bible:updateField',
    (_e, projectId: string, sectionType: BibleSectionType, sectionKey: string, content: string) =>
      bibleService.updateField(projectId, sectionType, sectionKey, content)
  )
  ipcMain.handle(
    'bible:setStatus',
    (_e, projectId: string, sectionType: BibleSectionType, sectionKey: string, status: BibleFieldStatus) =>
      bibleService.setFieldStatus(projectId, sectionType, sectionKey, status)
  )
  ipcMain.handle(
    'bible:setCandidate',
    (_e, projectId: string, sectionType: BibleSectionType, sectionKey: string, candidate: string, mode: AiCoCreateMode) =>
      bibleService.setAiCandidate(projectId, sectionType, sectionKey, candidate, mode)
  )
  ipcMain.handle(
    'bible:acceptCandidate',
    (_e, projectId: string, sectionType: BibleSectionType, sectionKey: string) =>
      bibleService.acceptAiCandidate(projectId, sectionType, sectionKey)
  )
  ipcMain.handle(
    'bible:rejectCandidate',
    (_e, projectId: string, sectionType: BibleSectionType, sectionKey: string) =>
      bibleService.rejectAiCandidate(projectId, sectionType, sectionKey)
  )
  ipcMain.handle(
    'bible:coCreate',
    (_e, projectId: string, sectionType: BibleSectionType, sectionKey: string, mode: AiCoCreateMode, userMessage?: string) =>
      bibleAiService.coCreate(projectId, sectionType, sectionKey, mode, userMessage)
  )
  ipcMain.handle('bible:getReadiness', (_e, projectId: string) =>
    readinessService.evaluateReadiness(projectId)
  )

  // ── Import ──
  ipcMain.handle(
    'import:document',
    (_e, projectId: string, filename: string, content: string) =>
      importService.importDocument(projectId, filename, content)
  )
  ipcMain.handle('import:listDocuments', (_e, projectId: string) =>
    importService.listDocuments(projectId)
  )
  ipcMain.handle('import:parseDocument', (_e, projectId: string, documentId: string) =>
    importService.parseDocument(projectId, documentId)
  )
  ipcMain.handle('import:parseAll', (_e, projectId: string) =>
    importService.parseAllDocuments(projectId)
  )
  ipcMain.handle('import:parseAndMergeAll', (_e, projectId: string) =>
    importService.parseAndMergeAllDocuments(projectId)
  )
  ipcMain.handle('import:mergeSegments', (_e, projectId: string, segmentIds: string[]) =>
    importService.mergeSegments(projectId, segmentIds)
  )
  ipcMain.handle('import:getConflicts', (_e, projectId: string) =>
    importService.getConflicts(projectId)
  )
  ipcMain.handle('import:deleteDocument', (_e, projectId: string, documentId: string) =>
    importService.deleteDocument(projectId, documentId)
  )

  // ── Guided Mode ──
  ipcMain.handle('guided:getQuestions', (_e, projectId: string) =>
    bibleAiService.generateGuidedQuestions(projectId)
  )
  ipcMain.handle(
    'guided:submitAnswers',
    (_e, projectId: string, answers: Array<{ questionId: string; answer: string; targetSection: BibleSectionType; targetKey: string }>) =>
      bibleAiService.processGuidedAnswers(projectId, answers)
  )

  // ── Launch ──
  ipcMain.handle('launch:evaluate', (_e, projectId: string) =>
    readinessService.evaluateReadiness(projectId)
  )
  ipcMain.handle('launch:generateSnapshot', (_e, projectId: string) =>
    launchService.generateSnapshot(projectId)
  )
  ipcMain.handle('launch:getActiveSnapshot', (_e, projectId: string) =>
    launchService.getActiveSnapshot(projectId)
  )
  ipcMain.handle('launch:lockAndStart', async (_e, projectId: string, snapshotId: string) => {
    launchService.lockSnapshot(projectId, snapshotId)
    const host = getHost(projectId)
    return host.start()
  })

  // ── Bible Segments ──
  ipcMain.handle('bibleSegment:list', (_e, projectId: string, documentId?: string) =>
    importService.listSegments(projectId, documentId)
  )
  ipcMain.handle(
    'bibleSegment:updateStatus',
    (_e, segmentId: string, status: string) =>
      importService.updateSegmentStatus(segmentId, status as never)
  )
  ipcMain.handle('bibleSegment:delete', (_e, segmentId: string) =>
    importService.deleteSegment(segmentId)
  )

  // ── Phase 4: Contract ──
  ipcMain.handle('contract:getChapterContract', (_e, projectId: string, chapterId: string) =>
    contractService.getChapterContract(projectId, chapterId)
  )
  ipcMain.handle(
    'contract:createChapterContract',
    (_e, projectId: string, chapterId: string, arcId: string | null, input: Partial<ChapterContract>) =>
      contractService.createChapterContract(projectId, chapterId, arcId, input)
  )
  ipcMain.handle('contract:updateChapterContract', (_e, id: string, patch: Partial<ChapterContract>) =>
    contractService.updateChapterContract(id, patch)
  )
  ipcMain.handle('contract:listContractsByArc', (_e, projectId: string, arcId: string) =>
    contractService.listContractsByArc(projectId, arcId)
  )
  ipcMain.handle(
    'contract:generateChapterContract',
    (_e, projectId: string, chapterId: string, arcId: string | null) =>
      contractService.generateChapterContract(projectId, chapterId, arcId)
  )
  ipcMain.handle('contract:getKnowledgeContract', (_e, projectId: string, chapterId: string) =>
    contractService.getKnowledgeContract(projectId, chapterId)
  )
  ipcMain.handle(
    'contract:createKnowledgeContract',
    (_e, projectId: string, chapterId: string, input: Partial<KnowledgeContract>) =>
      contractService.createKnowledgeContract(projectId, chapterId, input)
  )
  ipcMain.handle('contract:updateKnowledgeContract', (_e, id: string, patch: Partial<KnowledgeContract>) =>
    contractService.updateKnowledgeContract(id, patch)
  )
  ipcMain.handle(
    'contract:generateKnowledgeContract',
    (_e, projectId: string, chapterId: string, povCharacterId: string | null) =>
      contractService.generateKnowledgeContract(projectId, chapterId, povCharacterId)
  )

  // ── Phase 4: Fact Lock ──
  ipcMain.handle(
    'factLock:lockFact',
    (_e, projectId: string, characterId: string, factKey: string, factValue: string, lockLevel: FactLockLevel, allowedChangeEvents: string[]) =>
      factLockService.lockFact(projectId, characterId, factKey, factValue, lockLevel, allowedChangeEvents)
  )
  ipcMain.handle('factLock:unlockFact', (_e, id: string) => factLockService.unlockFact(id))
  ipcMain.handle('factLock:getLocks', (_e, characterId: string) => factLockService.getLocks(characterId))
  ipcMain.handle('factLock:getLocksForProject', (_e, projectId: string) =>
    factLockService.getLocksForProject(projectId)
  )
  ipcMain.handle(
    'factLock:verifyFact',
    (_e, characterId: string, factKey: string, claimedValue: string) =>
      factLockService.verifyFact(characterId, factKey, claimedValue)
  )
  ipcMain.handle(
    'factLock:changeFactWithEvent',
    (_e, characterId: string, factKey: string, newValue: string, eventId: string) =>
      factLockService.changeFactWithEvent(characterId, factKey, newValue, eventId)
  )
  ipcMain.handle('factLock:batchLockFromSnapshot', (_e, projectId: string, snapshotData: Record<string, unknown>) =>
    factLockService.batchLockFromSnapshot(projectId, snapshotData)
  )

  // ── Phase 4: Draft ──
  ipcMain.handle('draft:getLatestDraft', (_e, chapterId: string) =>
    draftService.getLatestDraft(chapterId)
  )
  ipcMain.handle('draft:getDraft', (_e, id: string) => draftService.getDraft(id))
  ipcMain.handle('draft:listDrafts', (_e, chapterId: string) => draftService.listDrafts(chapterId))
  ipcMain.handle('draft:commitDraft', (_e, draftId: string) => draftService.commitDraft(draftId))
  ipcMain.handle('draft:rejectDraft', (_e, draftId: string, reason: string) =>
    draftService.rejectDraft(draftId, reason)
  )
  ipcMain.handle('draft:isCommitted', (_e, chapterId: string) => draftService.isCommitted(chapterId))

  // ── Phase 4: Gate ──
  ipcMain.handle('gate:runPlanGate', async (_e, projectId: string, chapterId: string) => {
    const verdict = await draftGateService.runPlanGate(projectId, chapterId)
    return {
      verdict: verdict.verdict,
      overall_passed: verdict.overall_passed,
      fail_count: verdict.fail_count,
      critical_count: verdict.critical_count,
      summary: verdict.summary,
      recommended_model: verdict.recommended_model,
      reports: verdict.reports.map((r) => ({
        check_type: r.check_type,
        passed: r.passed,
        violations: r.violations,
        severity: r.severity
      }))
    }
  })
  ipcMain.handle('gate:runDraftGate', async (_e, draftId: string) => {
    const verdict = await draftGateService.runDraftGate(draftId)
    return {
      verdict: verdict.verdict,
      overall_passed: verdict.overall_passed,
      fail_count: verdict.fail_count,
      critical_count: verdict.critical_count,
      summary: verdict.summary,
      recommended_model: verdict.recommended_model,
      reports: verdict.reports.map((r) => ({
        check_type: r.check_type,
        passed: r.passed,
        violations: r.violations,
        severity: r.severity
      }))
    }
  })
  ipcMain.handle('gate:getGateReports', (_e, draftId: string) => {
    const db = getDb()
    const rows = db
      .prepare('SELECT * FROM draft_gate_reports WHERE draft_id = ? ORDER BY created_at ASC')
      .all(draftId) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: r.id as string,
      project_id: r.project_id as string,
      draft_id: r.draft_id as string,
      chapter_id: r.chapter_id as string,
      check_type: r.check_type as string,
      passed: r.passed === 1,
      violations: JSON.parse((r.violations as string) || '[]'),
      severity: r.severity as string,
      created_at: r.created_at as number
    }))
  })
  ipcMain.handle('gate:getLatestVerdict', (_e, draftId: string) => {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM draft_gate_verdicts WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(draftId) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      draft_id: row.draft_id as string,
      chapter_id: row.chapter_id as string,
      verdict: row.verdict as string,
      overall_passed: row.overall_passed === 1,
      fail_count: row.fail_count as number,
      critical_count: row.critical_count as number,
      summary: row.summary as string,
      recommended_model: row.recommended_model as string,
      created_at: row.created_at as number
    }
  })
  ipcMain.handle('gate:getVerdictsByChapter', (_e, chapterId: string) => {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT v.* FROM draft_gate_verdicts v
         JOIN chapter_drafts d ON v.draft_id = d.id
         WHERE d.chapter_id = ?
         ORDER BY v.created_at DESC`
      )
      .all(chapterId) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: r.id as string,
      project_id: r.project_id as string,
      draft_id: r.draft_id as string,
      chapter_id: r.chapter_id as string,
      verdict: r.verdict as string,
      overall_passed: r.overall_passed === 1,
      fail_count: r.fail_count as number,
      critical_count: r.critical_count as number,
      summary: r.summary as string,
      recommended_model: r.recommended_model as string,
      created_at: r.created_at as number
    }))
  })

  // ── Phase 4: Model Routing ──
  ipcMain.handle('routing:listRules', (_e, projectId?: string) =>
    modelRouterService.listRoutingRules(projectId)
  )
  ipcMain.handle(
    'routing:setRule',
    (_e, input: {
      project_id?: string | null
      agent_type: string
      task_type: string
      risk_level: 'low' | 'normal' | 'high' | 'critical'
      preferred_tier: ModelTier
      auto_escalate: boolean
    }) => modelRouterService.setRoutingRule(input)
  )
  ipcMain.handle(
    'routing:resolveModel',
    (_e, agentType: string, taskType: string, context?: { riskLevel?: string; forceTier?: ModelTier }) =>
      modelRouterService.resolveModel(agentType, taskType, context)
  )
  ipcMain.handle(
    'routing:shouldEscalate',
    (_e, context: {
      failCount: number
      violationType?: string
      chapterImportance?: 'normal' | 'climax' | 'volume_start' | 'volume_end' | 'major_twist'
      userMarked?: boolean
    }) => modelRouterService.shouldEscalate(context)
  )

  // ── Phase 4: Evaluation Cases ──
  ipcMain.handle('integrity:getEvaluationCases', () => evaluationCasesService.getEvaluationCases())
  ipcMain.handle(
    'integrity:createEvaluationCase',
    (_e, input: Parameters<typeof evaluationCasesService.createEvaluationCase>[0]) =>
      evaluationCasesService.createEvaluationCase(input)
  )
  ipcMain.handle('integrity:updateEvaluationCase', (_e, id: string, patch: Partial<Parameters<typeof evaluationCasesService.createEvaluationCase>[0]>) =>
    evaluationCasesService.updateEvaluationCase(id, patch)
  )
  ipcMain.handle('integrity:deleteEvaluationCase', (_e, id: string) =>
    evaluationCasesService.deleteEvaluationCase(id)
  )
  ipcMain.handle(
    'integrity:runEvaluationCase',
    (_e, caseId: string, input: { projectId: string; chapterId?: string; draftId?: string; content?: string }) =>
      evaluatorService.runEvaluationCase(caseId, input)
  )
  ipcMain.handle(
    'integrity:runAllEvaluationCases',
    (_e, input: { projectId: string; chapterId?: string; draftId?: string; content?: string; category?: Parameters<typeof evaluatorService.runAllEvaluationCases>[0]['category'] }) =>
      evaluatorService.runAllEvaluationCases(input)
  )
}
