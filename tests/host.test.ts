import { describe, expect, it } from 'vitest'
import { getDb } from '../electron/db'
import { Host } from '../electron/services/host'
import { now } from '../electron/lib/util'
import { createTestProject } from './setup'

describe('host lifecycle guards', () => {
  it('should not restart a completed project', async () => {
    const projectId = createTestProject()
    const ts = now()

    getDb().prepare(
      `INSERT INTO system_state (project_id, orchestrator_state, phase, flow, lifecycle, is_paused, auto_mode, updated_at)
       VALUES (?, 'completed', 'complete', 'writing', 'completed', 0, 0, ?)`
    ).run(projectId, ts)

    getDb().prepare(
      `INSERT INTO progress (project_id, phase, flow, updated_at)
       VALUES (?, 'complete', 'writing', ?)`
    ).run(projectId, ts)

    const host = new Host(projectId)
    const result = await host.start()

    expect(result.phase).toBe('complete')
    expect(result.message).toContain('项目已完成')
    expect(host.getLifecycle()).toBe('completed')
  })
})
