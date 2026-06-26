import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { getStoryBible } from './story-bible.service'
import { ensureLaunchAssets } from './launch-bootstrap.service'
import { rebuildFoundations } from './memory.service'
import type { LaunchSnapshot, BibleSectionType } from '@shared/types'

type Row = {
  id: string
  project_id: string
  version: number
  snapshot_data: string
  is_active: number
  created_at: number
}

function mapRow(r: Row): LaunchSnapshot {
  return {
    id: r.id,
    project_id: r.project_id,
    version: r.version,
    snapshot_data: JSON.parse(r.snapshot_data) as Record<string, unknown>,
    is_active: r.is_active === 1,
    created_at: r.created_at
  }
}

export async function generateSnapshot(projectId: string): Promise<LaunchSnapshot> {
  ensureLaunchAssets(projectId)
  await rebuildFoundations(projectId)
  const bible = getStoryBible(projectId)

  const snapshotData = buildSnapshotData(projectId, bible)

  const db = getDb()
  const versionRow = db
    .prepare('SELECT MAX(version) AS v FROM launch_snapshots WHERE project_id = ?')
    .get(projectId) as { v: number | null } | undefined
  const version = (versionRow?.v || 0) + 1

  const id = uuid()
  const ts = now()

  db.prepare('UPDATE launch_snapshots SET is_active = 0 WHERE project_id = ?').run(projectId)

  db.prepare(
    `INSERT INTO launch_snapshots (id, project_id, version, snapshot_data, is_active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(id, projectId, version, JSON.stringify(snapshotData), ts)

  return mapRow(db.prepare('SELECT * FROM launch_snapshots WHERE id = ?').get(id) as Row)
}

function buildSnapshotData(
  projectId: string,
  bible: ReturnType<typeof getStoryBible>
): Record<string, unknown> {
  const db = getDb()

  const positioning = fieldsToObject(bible.positioning)
  const compass = fieldsToObject(bible.compass)
  const world = fieldsToObject(bible.world)
  const characters = fieldsToObject(bible.characters)
  const structure = fieldsToObject(bible.structure)
  const foreshadowing = fieldsToObject(bible.foreshadowing)
  const style = fieldsToObject(bible.style)

  const characterRows = db
    .prepare('SELECT * FROM characters WHERE project_id = ?')
    .all(projectId) as Array<Record<string, unknown>>
  const characterArcRows = db
    .prepare('SELECT * FROM character_arcs WHERE project_id = ?')
    .all(projectId) as Array<Record<string, unknown>>
  const worldRuleRows = db
    .prepare('SELECT * FROM world_rules WHERE project_id = ?')
    .all(projectId) as Array<Record<string, unknown>>
  const volumeArcRows = db
    .prepare('SELECT * FROM volume_arcs WHERE project_id = ? ORDER BY volume_number, arc_number')
    .all(projectId) as Array<Record<string, unknown>>
  const foreshadowingRows = db
    .prepare('SELECT * FROM foreshadowing_ledger WHERE project_id = ?')
    .all(projectId) as Array<Record<string, unknown>>

  return {
    positioning,
    compass,
    world: { ...world, rules: worldRuleRows, worldbuilding: [] },
    characters: { ...characters, list: characterRows, arcs: characterArcRows },
    structure: { ...structure, volume_arcs: volumeArcRows },
    foreshadowing: { ...foreshadowing, ledger: foreshadowingRows },
    style,
    taboos: style.taboos || '',
    inspirations: positioning.inspiration || '',
    missing_but_rolling: identifyRollingGaps(bible)
  }
}

function fieldsToObject(fields: ReturnType<typeof getStoryBible>[BibleSectionType]): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const f of fields) {
    if (f.status !== 'deprecated' && f.content) {
      obj[f.section_key] = f.content
    }
  }
  return obj
}

function identifyRollingGaps(bible: ReturnType<typeof getStoryBible>): string[] {
  const gaps: string[] = []
  const structure = bible.structure
  const hasFullOutline = structure.some(
    (f) => f.section_key === 'volume_skeleton' && f.content.length > 20
  )
  if (!hasFullOutline) gaps.push('后续卷弧骨架（可滚动补全）')

  const hasArcOutline = structure.some(
    (f) => f.section_key === 'arc_skeleton' && f.content.length > 20
  )
  if (!hasArcOutline) gaps.push('后续弧细纲（可滚动补全）')

  return gaps
}

export function getActiveSnapshot(projectId: string): LaunchSnapshot | null {
  const row = getDb()
    .prepare('SELECT * FROM launch_snapshots WHERE project_id = ? AND is_active = 1')
    .get(projectId) as Row | undefined
  return row ? mapRow(row) : null
}

export function listSnapshots(projectId: string): LaunchSnapshot[] {
  const rows = getDb()
    .prepare('SELECT * FROM launch_snapshots WHERE project_id = ? ORDER BY version DESC')
    .all(projectId) as Row[]
  return rows.map(mapRow)
}

export function lockSnapshot(projectId: string, snapshotId: string): void {
  const db = getDb()
  db.prepare('UPDATE launch_snapshots SET is_active = 0 WHERE project_id = ?').run(projectId)
  db.prepare('UPDATE launch_snapshots SET is_active = 1 WHERE id = ? AND project_id = ?').run(
    snapshotId,
    projectId
  )
}
