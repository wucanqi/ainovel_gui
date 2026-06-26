import { initTestDb, closeDb, getDb } from '../electron/db'
import { registerTools } from '../electron/services/tool-executor'
import { architectTools } from '../electron/services/tools/architect.tools'
import { writerTools } from '../electron/services/tools/writer.tools'
import { editorTools } from '../electron/services/tools/editor.tools'
import { uuid, now } from '../electron/lib/util'

beforeEach(() => {
  closeDb()
  initTestDb()
  registerTools([
    ...architectTools,
    ...writerTools,
    ...editorTools
  ])
})

afterEach(() => {
  closeDb()
})

export function createTestProject(): string {
  const db = getDb()
  const id = uuid()
  const ts = now()
  db.prepare(
    `INSERT INTO projects (id, title, summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, 'Test Project', 'Test summary', ts, ts)
  return id
}

export { uuid, now }