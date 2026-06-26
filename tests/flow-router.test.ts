import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../electron/db'
import { importDocument, parseAndMergeAllDocuments } from '../electron/services/import.service'
import { generateSnapshot } from '../electron/services/launch.service'
import { LoadState, Route, detectFoundationMissing } from '../electron/services/flow-router'
import { createTestProject } from './setup'

const EXAMPLE_DOCS = [
  '世界观.md',
  '人物.md',
  '主线粗钢.md',
  '重要情节.md',
  '关键场景细纲.md',
  '写作要求.md'
]

describe('flow-router chapter readiness', () => {
  it('should mark chapter_contracts missing at foundation level when arc plans exist but no chapter contracts', async () => {
    const projectId = await seedProject()
    getDb().prepare('DELETE FROM chapter_contracts WHERE project_id = ?').run(projectId)

    const missing = detectFoundationMissing(projectId)
    expect(missing).toContain('chapter_contracts')
  })

  it('should mark knowledge_contracts missing at foundation level when arc plans exist but no knowledge contracts', async () => {
    const projectId = await seedProject()
    getDb().prepare('DELETE FROM knowledge_contracts WHERE project_id = ?').run(projectId)

    const missing = detectFoundationMissing(projectId)
    expect(missing).toContain('knowledge_contracts')
  })

  it('should route architect instead of writer when the next chapter is missing chapter contract', async () => {
    const projectId = await seedProject()
    const state = LoadState(projectId)

    expect(state.nextChapter).toBeGreaterThan(0)
    expect(state.nextChapterId).toBeTruthy()

    getDb().prepare('DELETE FROM chapter_contracts WHERE project_id = ? AND chapter_id = ?').run(projectId, state.nextChapterId)

    const reloaded = LoadState(projectId)
    expect(reloaded.chapterReadiness?.chapterContractReady).toBe(false)
    expect(reloaded.chapterReadiness?.readyToWrite).toBe(false)

    const instruction = Route(reloaded)
    expect(instruction?.agent).toBe('architect')
    expect(instruction?.reason).toContain('chapter_contract')
  })

  it('should route architect instead of writer when the next chapter is missing knowledge contract', async () => {
    const projectId = await seedProject()
    const state = LoadState(projectId)

    expect(state.nextChapter).toBeGreaterThan(0)
    expect(state.nextChapterId).toBeTruthy()

    getDb().prepare('DELETE FROM knowledge_contracts WHERE project_id = ? AND chapter_id = ?').run(projectId, state.nextChapterId)

    const reloaded = LoadState(projectId)
    expect(reloaded.chapterReadiness?.knowledgeContractReady).toBe(false)
    expect(reloaded.chapterReadiness?.readyToWrite).toBe(false)

    const instruction = Route(reloaded)
    expect(instruction?.agent).toBe('architect')
    expect(instruction?.reason).toContain('knowledge_contract')
  })
})

async function seedProject(): Promise<string> {
  const projectId = createTestProject()

  for (const filename of EXAMPLE_DOCS) {
    const content = readFileSync(join(process.cwd(), 'example', filename), 'utf8')
    importDocument(projectId, filename, content)
  }

  const results = await parseAndMergeAllDocuments(projectId)
  expect(results.some((result) => result.success)).toBe(true)

  const snapshot = await generateSnapshot(projectId)
  expect(snapshot.is_active).toBe(true)

  return projectId
}
