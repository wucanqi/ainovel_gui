import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../electron/db'
import { createTestProject } from './setup'
import { importDocument, parseAndMergeAllDocuments } from '../electron/services/import.service'
import { generateSnapshot } from '../electron/services/launch.service'
import { destroyOrchestrator, getOrchestrator } from '../electron/services/orchestrator'

const EXAMPLE_DOCS = [
  '世界观.md',
  '人物.md',
  '主线粗钢.md',
  '重要情节.md',
  '关键场景细纲.md',
  '写作要求.md'
]

describe('Import to launch flow', () => {
  it('should turn the example markdown set into launchable orchestration assets', async () => {
    const projectId = createTestProject()

    for (const filename of EXAMPLE_DOCS) {
      const content = readFileSync(join(process.cwd(), 'example', filename), 'utf8')
      importDocument(projectId, filename, content)
    }

    const results = await parseAndMergeAllDocuments(projectId)
    expect(results.some((result) => result.success)).toBe(true)

    const snapshot = await generateSnapshot(projectId)
    expect(snapshot.is_active).toBe(true)

    const db = getDb()
    const counts = {
      compass: countRows('story_compass', projectId),
      characters: countRows('characters', projectId),
      characterArcs: countRows('character_arcs', projectId),
      arcs: countRows('volume_arcs', projectId),
      arcOutlines: countRows('arc_outlines', projectId),
      arcPlans: countArcChapterPlans(projectId),
      chapters: countRows('chapters', projectId),
      chapterPlans: countRows('chapter_plans', projectId),
      chapterContracts: countRows('chapter_contracts', projectId),
      knowledgeContracts: countRows('knowledge_contracts', projectId),
      foreshadowing: countRows('foreshadowing_ledger', projectId)
    }

    expect(counts.compass).toBeGreaterThan(0)
    expect(counts.characters).toBeGreaterThan(0)
    expect(counts.characterArcs).toBeGreaterThan(0)
    expect(counts.arcs).toBeGreaterThan(0)
    expect(counts.arcOutlines).toBeGreaterThan(0)
    expect(counts.arcPlans).toBeGreaterThan(0)
    expect(counts.chapters).toBe(counts.arcPlans)
    expect(counts.chapterPlans).toBeGreaterThan(0)
    expect(counts.chapterContracts).toBeGreaterThan(0)
    expect(counts.knowledgeContracts).toBeGreaterThan(0)
    expect(counts.foreshadowing).toBeGreaterThan(0)

    const expandedArc = db
      .prepare("SELECT id FROM volume_arcs WHERE project_id = ? AND status = 'expanded' LIMIT 1")
      .get(projectId)
    expect(expandedArc).toBeTruthy()

    const orchestrator = getOrchestrator(projectId)
    const started = await orchestrator.start()
    expect(started.state).toBe('contract_generation')
    const stepped = await orchestrator.tick()
    expect(stepped.state).toBe('plan_gate')
    destroyOrchestrator(projectId)
  })
})

function countRows(table: string, projectId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`)
    .get(projectId) as { count: number }
  return row.count
}

function countArcChapterPlans(projectId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM arc_chapter_plans acp
       JOIN volume_arcs va ON va.id = acp.arc_id
       WHERE va.project_id = ?`
    )
    .get(projectId) as { count: number }
  return row.count
}
