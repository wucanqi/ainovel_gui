import { describe, expect, it } from 'vitest'
import { createTestProject } from './setup'
import { importDocument, parseAndMergeAllDocuments } from '../electron/services/import.service'
import { buildContext, getStats } from '../electron/services/memory.service'
import { generateSnapshot } from '../electron/services/launch.service'
import { getOrchestrator, destroyOrchestrator } from '../electron/services/orchestrator'

describe('Foundation RAG recall', () => {
  it('should index imported markdown as foundation memory and retrieve it for writing context', async () => {
    const projectId = createTestProject()

    importDocument(
      projectId,
      '01-世界观.md',
      [
        '# 世界观',
        '',
        '## 核心设定',
        '黑潮群岛每逢冬季都会出现逆潮，逆潮会吞没港口的低层街区。',
        '',
        '## 规则',
        '所有能够进入逆潮的人，必须佩戴灰银锚针，否则会失去方向感。'
      ].join('\n')
    )

    await parseAndMergeAllDocuments(projectId)
    const stats = getStats(projectId)
    expect(stats.totalChunks).toBeGreaterThan(0)

    const rag = await buildContext(projectId, '逆潮 灰银锚针 港口', undefined)
    expect(rag.chunks.some((chunk) => chunk.source_type === 'foundation')).toBe(true)
    expect(
      rag.chunks.some(
        (chunk) =>
          chunk.source_type === 'foundation' &&
          chunk.content.includes('灰银锚针')
      )
    ).toBe(true)

    await generateSnapshot(projectId)
    const orchestrator = getOrchestrator(projectId)
    const context = await orchestrator.getContext('writer')
    expect(context.includes('foundationContext')).toBe(true)
    expect(context.includes('灰银锚针')).toBe(true)
    destroyOrchestrator(projectId)
  })
})
