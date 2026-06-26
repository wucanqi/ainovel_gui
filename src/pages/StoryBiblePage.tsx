import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/ipc'
import type {
  Project,
  StoryBible,
  BibleSectionType,
  BibleField,
  AiCoCreateMode,
  ReadinessResult,
  ImportedDocument,
  ParsedSegment,
  GuidedQuestion,
  LaunchSnapshot
} from '@shared/types'

const SECTION_META: Array<{ type: BibleSectionType; label: string; icon: string; fields: Array<{ key: string; label: string; placeholder: string }> }> = [
  {
    type: 'positioning',
    label: '作品定位',
    icon: '📌',
    fields: [
      { key: 'genre', label: '类型题材', placeholder: '如：玄幻/都市/科幻...' },
      { key: 'selling_point', label: '核心卖点', placeholder: '这本书最吸引读者的点' },
      { key: 'target_audience', label: '目标读者', placeholder: '面向什么读者群' },
      { key: 'inspiration', label: '灵感片段', placeholder: '零散灵感' },
      { key: 'reference', label: '参考作品', placeholder: '类似风格的作品' }
    ]
  },
  {
    type: 'compass',
    label: '故事指南针',
    icon: '🧭',
    fields: [
      { key: 'ending_direction', label: '终局方向', placeholder: '故事最终往哪里走' },
      { key: 'core_conflict', label: '核心冲突', placeholder: '主角面对的根本矛盾' },
      { key: 'theme', label: '主题命题', placeholder: '故事想表达什么' },
      { key: 'long_term_suspense', label: '长线悬念', placeholder: '贯穿全书的大悬念' }
    ]
  },
  {
    type: 'world',
    label: '世界设定',
    icon: '🌍',
    fields: [
      { key: 'background', label: '世界背景', placeholder: '故事发生的世界' },
      { key: 'power_system', label: '能力体系', placeholder: '魔法/科技/修炼等' },
      { key: 'rules', label: '基础规则', placeholder: '世界运行规则与限制' },
      { key: 'factions', label: '势力组织', placeholder: '主要势力' },
      { key: 'geography', label: '地理', placeholder: '重要地点' }
    ]
  },
  {
    type: 'characters',
    label: '人物设定',
    icon: '👤',
    fields: [
      { key: 'protagonist', label: '主角', placeholder: '主角设定' },
      { key: 'supporting', label: '主要配角', placeholder: '重要配角' },
      { key: 'antagonist', label: '反派/敌对', placeholder: '反派力量' },
      { key: 'character_arc', label: '主角人物弧', placeholder: '初始状态→终局变化' },
      { key: 'relationships', label: '人物关系', placeholder: '主要关系网' }
    ]
  },
  {
    type: 'structure',
    label: '故事结构',
    icon: '📖',
    fields: [
      { key: 'main_plot', label: '主线大纲', placeholder: '全书主线' },
      { key: 'volume_skeleton', label: '分卷骨架', placeholder: '卷级规划' },
      { key: 'arc_skeleton', label: '首弧骨架', placeholder: '第一弧要发生什么' },
      { key: 'chapter_plan', label: '前几章方向', placeholder: '可写的前几章' }
    ]
  },
  {
    type: 'foreshadowing',
    label: '伏笔与悬念',
    icon: '🔮',
    fields: [
      { key: 'foreshadowing', label: '伏笔规划', placeholder: '计划埋设的伏笔' },
      { key: 'secrets', label: '秘密', placeholder: '人物/世界秘密' }
    ]
  },
  {
    type: 'style',
    label: '风格与约束',
    icon: '🎨',
    fields: [
      { key: 'writing_style', label: '文风', placeholder: '叙事风格' },
      { key: 'pov', label: '叙事视角', placeholder: '第一/第三人称' },
      { key: 'pacing', label: '节奏偏好', placeholder: '快节奏/慢热等' },
      { key: 'taboos', label: '禁忌内容', placeholder: '不想出现的内容' }
    ]
  }
]

const AI_MODES: Array<{ mode: AiCoCreateMode; label: string; icon: string }> = [
  { mode: 'complete', label: '补全', icon: '✏️' },
  { mode: 'question', label: '质疑', icon: '❓' },
  { mode: 'variant', label: '变体', icon: '🔀' },
  { mode: 'merge', label: '融合', icon: '🔗' },
  { mode: 'compress', label: '压缩', icon: '📦' },
  { mode: 'expand', label: '展开', icon: '📈' }
]

type SubView = 'bible' | 'import' | 'guided' | 'readiness'

export function StoryBiblePage({
  project,
  onLaunchReady
}: {
  project: Project
  onLaunchReady?: () => void
}): JSX.Element {
  const [bible, setBible] = useState<StoryBible | null>(null)
  const [activeSection, setActiveSection] = useState<BibleSectionType>('positioning')
  const [activeFieldKey, setActiveFieldKey] = useState<string>('genre')
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null)
  const [subView, setSubView] = useState<SubView>('bible')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiMessage, setAiMessage] = useState('')
  const [launching, setLaunching] = useState(false)
  const [launchStatus, setLaunchStatus] = useState('')

  const refresh = useCallback(async () => {
    const b = await api.bible.get(project.id)
    setBible(b)
    const r = await api.bible.getReadiness(project.id)
    setReadiness(r)
  }, [project.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleUpdateField = async (sectionType: BibleSectionType, sectionKey: string, content: string): Promise<void> => {
    await api.bible.updateField(project.id, sectionType, sectionKey, content)
    void refresh()
  }

  const handleSetStatus = async (sectionType: BibleSectionType, sectionKey: string, status: 'draft' | 'confirmed' | 'pending' | 'deprecated'): Promise<void> => {
    await api.bible.setStatus(project.id, sectionType, sectionKey, status)
    void refresh()
  }

  const handleCoCreate = async (mode: AiCoCreateMode): Promise<void> => {
    setAiLoading(true)
    try {
      await api.bible.coCreate(project.id, activeSection, activeFieldKey, mode, aiMessage || undefined)
      setAiMessage('')
      void refresh()
    } catch (e) {
      console.error(e)
    } finally {
      setAiLoading(false)
    }
  }

  const handleAcceptCandidate = async (): Promise<void> => {
    await api.bible.acceptCandidate(project.id, activeSection, activeFieldKey)
    void refresh()
  }

  const handleRejectCandidate = async (): Promise<void> => {
    await api.bible.rejectCandidate(project.id, activeSection, activeFieldKey)
    void refresh()
  }

  const handleLaunch = async (): Promise<void> => {
    setLaunching(true)
    setLaunchStatus('正在生成启动快照...')
    try {
      const snapshot = await api.launch.generateSnapshot(project.id)
      setLaunchStatus('正在启动编排器...')
      const result = await api.launch.lockAndStart(project.id, snapshot.id)
      setLaunchStatus(result.message)
      onLaunchReady?.()
    } catch (error) {
      setLaunchStatus(`启动失败：${(error as Error).message}`)
    } finally {
      setLaunching(false)
    }
  }

  if (!bible) {
    return <div className="flex h-full items-center justify-center text-ink-faint">加载中…</div>
  }

  const currentField = bible[activeSection]?.find((f) => f.section_key === activeFieldKey)

  return (
    <div className="flex h-full">
      {/* 左侧导航 */}
      <div className="flex w-56 shrink-0 flex-col border-r border-line bg-bg-soft">
        <div className="border-b border-line px-3 py-2 text-xs font-medium text-ink-soft">
          Story Bible
        </div>
        {SECTION_META.map((sec) => (
          <button
            key={sec.type}
            onClick={() => {
              setActiveSection(sec.type)
              setActiveFieldKey(sec.fields[0].key)
              setSubView('bible')
            }}
            className={`flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
              activeSection === sec.type && subView === 'bible'
                ? 'bg-bg-softer text-ink'
                : 'text-ink-soft hover:bg-bg-softer'
            }`}
          >
            <span>{sec.icon}</span>
            <span>{sec.label}</span>
            {readiness && (
              <LevelDot level={readiness.sections.find((s) => s.section_type === sec.type)?.level} />
            )}
          </button>
        ))}
        <div className="my-2 border-t border-line" />
        <button
          onClick={() => setSubView('import')}
          className={`flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
            subView === 'import' ? 'bg-bg-softer text-ink' : 'text-ink-soft hover:bg-bg-softer'
          }`}
        >
          📥 导入管理
        </button>
        <button
          onClick={() => setSubView('readiness')}
          className={`flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
            subView === 'readiness' ? 'bg-bg-softer text-ink' : 'text-ink-soft hover:bg-bg-softer'
          }`}
        >
          📊 启动准备度
        </button>
        <button
          onClick={() => setSubView('guided')}
          className={`flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
            subView === 'guided' ? 'bg-bg-softer text-ink' : 'text-ink-soft hover:bg-bg-softer'
          }`}
        >
          💬 引导问答
        </button>
      </div>

      {/* 中间内容区 */}
      <div className="min-w-0 flex-1 overflow-auto">
        {subView === 'bible' && (
          <BibleEditor
            sectionType={activeSection}
            activeFieldKey={activeFieldKey}
            setActiveFieldKey={setActiveFieldKey}
            bible={bible}
            onUpdateField={handleUpdateField}
            onSetStatus={handleSetStatus}
          />
        )}
        {subView === 'import' && <ImportManager projectId={project.id} onChanged={refresh} />}
        {subView === 'readiness' && readiness && (
          <ReadinessView
            readiness={readiness}
            onLaunch={handleLaunch}
            launching={launching}
            launchStatus={launchStatus}
          />
        )}
        {subView === 'guided' && <GuidedMode projectId={project.id} onChanged={refresh} />}
      </div>

      {/* 右侧 AI 共创栏 */}
      {subView === 'bible' && currentField && (
        <div className="flex w-80 shrink-0 flex-col border-l border-line bg-bg-soft">
          <div className="border-b border-line px-3 py-2 text-xs font-medium text-ink-soft">
            AI 共创 · {SECTION_META.find((s) => s.type === activeSection)?.fields.find((f) => f.key === activeFieldKey)?.label}
          </div>

          {currentField.ai_candidate && (
            <div className="border-b border-line bg-emerald-950/20 p-3">
              <div className="mb-1 text-xs font-medium text-emerald-400">
                AI 候选 ({currentField.ai_candidate_mode})
              </div>
              <div className="mb-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-ink-soft">
                {currentField.ai_candidate}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={handleAcceptCandidate}
                  className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500"
                >
                  ✓ 采纳
                </button>
                <button
                  onClick={handleRejectCandidate}
                  className="rounded bg-bg-softer px-2 py-1 text-xs text-ink-soft hover:bg-bg"
                >
                  ✗ 拒绝
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1 p-2">
            {AI_MODES.map((m) => (
              <button
                key={m.mode}
                onClick={() => handleCoCreate(m.mode)}
                disabled={aiLoading}
                className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:bg-bg-softer disabled:opacity-50"
                title={m.label}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          <textarea
            value={aiMessage}
            onChange={(e) => setAiMessage(e.target.value)}
            placeholder="补充要求（可选）..."
            className="m-2 flex-1 resize-none rounded border border-line bg-bg p-2 text-xs outline-none focus:border-emerald-600"
          />

          {aiLoading && (
            <div className="px-3 py-1 text-xs text-emerald-400">AI 思考中…</div>
          )}
        </div>
      )}
    </div>
  )
}

function LevelDot({ level }: { level?: string }): JSX.Element {
  if (!level) return <></>
  const colors: Record<string, string> = {
    sufficient: 'bg-emerald-500',
    weak: 'bg-amber-500',
    insufficient: 'bg-rose-500',
    missing: 'bg-gray-600'
  }
  return <span className={`ml-auto h-2 w-2 rounded-full ${colors[level] || 'bg-gray-600'}`} />
}

function BibleEditor({
  sectionType,
  activeFieldKey,
  setActiveFieldKey,
  bible,
  onUpdateField,
  onSetStatus
}: {
  sectionType: BibleSectionType
  activeFieldKey: string
  setActiveFieldKey: (k: string) => void
  bible: StoryBible
  onUpdateField: (sectionType: BibleSectionType, sectionKey: string, content: string) => Promise<void>
  onSetStatus: (sectionType: BibleSectionType, sectionKey: string, status: 'draft' | 'confirmed' | 'pending' | 'deprecated') => Promise<void>
}): JSX.Element {
  const meta = SECTION_META.find((s) => s.type === sectionType)!
  const fields = bible[sectionType] || []

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-semibold">
        {meta.icon} {meta.label}
      </h1>
      <p className="mb-6 text-xs text-ink-faint">点击字段编辑，右侧 AI 栏可共创</p>

      <div className="flex flex-col gap-4">
        {meta.fields.map((fieldMeta) => {
          const field = fields.find((f) => f.section_key === fieldMeta.key)
          const isActive = activeFieldKey === fieldMeta.key
          return (
            <div
              key={fieldMeta.key}
              className={`rounded-lg border p-3 transition-colors ${
                isActive ? 'border-emerald-600 bg-bg-soft' : 'border-line bg-bg-soft'
              }`}
              onClick={() => setActiveFieldKey(fieldMeta.key)}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">{fieldMeta.label}</span>
                <div className="flex items-center gap-2">
                  {field && (
                    <StatusBadge status={field.status} />
                  )}
                  {field?.source_type === 'import' && (
                    <span className="rounded bg-blue-600/20 px-1.5 py-0.5 text-[10px] text-blue-400">
                      导入
                    </span>
                  )}
                  {field?.source_type === 'guided' && (
                    <span className="rounded bg-purple-600/20 px-1.5 py-0.5 text-[10px] text-purple-400">
                      引导
                    </span>
                  )}
                  {field?.source_type === 'ai_suggest' && (
                    <span className="rounded bg-emerald-600/20 px-1.5 py-0.5 text-[10px] text-emerald-400">
                      AI
                    </span>
                  )}
                </div>
              </div>
              <textarea
                value={field?.content || ''}
                onChange={(e) => void onUpdateField(sectionType, fieldMeta.key, e.target.value)}
                placeholder={fieldMeta.placeholder}
                rows={4}
                className="w-full resize-y rounded border border-line bg-bg p-2 text-sm outline-none focus:border-emerald-600"
                onClick={(e) => e.stopPropagation()}
              />
              {field && (
                <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                  {field.source_ref && <span>来源: {field.source_ref}</span>}
                  <select
                    value={field.status}
                    onChange={(e) => void onSetStatus(sectionType, fieldMeta.key, e.target.value as 'draft' | 'confirmed' | 'pending' | 'deprecated')}
                    className="rounded border border-line bg-bg px-1 py-0.5 text-[10px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="draft">草稿</option>
                    <option value="confirmed">已确认</option>
                    <option value="pending">待定</option>
                    <option value="deprecated">废弃</option>
                  </select>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const colors: Record<string, string> = {
    draft: 'bg-gray-600/20 text-gray-400',
    confirmed: 'bg-emerald-600/20 text-emerald-400',
    pending: 'bg-amber-600/20 text-amber-400',
    deprecated: 'bg-rose-600/20 text-rose-400'
  }
  const labels: Record<string, string> = {
    draft: '草稿',
    confirmed: '已确认',
    pending: '待定',
    deprecated: '废弃'
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${colors[status] || colors.draft}`}>
      {labels[status] || status}
    </span>
  )
}

function ReadinessView({
  readiness,
  onLaunch,
  launching,
  launchStatus
}: {
  readiness: ReadinessResult
  onLaunch: () => Promise<void>
  launching: boolean
  launchStatus: string
}): JSX.Element {
  const levelColors: Record<string, string> = {
    sufficient: 'text-emerald-400',
    weak: 'text-amber-400',
    insufficient: 'text-rose-400',
    missing: 'text-gray-500'
  }
  const levelLabels: Record<string, string> = {
    sufficient: '足够',
    weak: '较弱',
    insufficient: '不足',
    missing: '缺失'
  }
  const overallLabels: Record<string, string> = {
    can_launch: '可以启动',
    suggest_supplement: '建议补充后启动',
    need_guidance: '需要引导',
    inspiration_only: '仅灵感库'
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-semibold">📊 启动准备度</h1>
      <p className="mb-6 text-xs text-ink-faint">评估当前 Story Bible 是否足以启动编排</p>

      <div className="mb-6 rounded-lg border border-line bg-bg-soft p-4">
        <div className="mb-2 text-sm font-medium">
          总体评估：
          <span className={levelColors[readiness.overall === 'can_launch' ? 'sufficient' : readiness.overall === 'suggest_supplement' ? 'weak' : 'insufficient']}>
            {overallLabels[readiness.overall]}
          </span>
        </div>
        {readiness.can_force_launch && readiness.overall !== 'can_launch' && (
          <div className="text-xs text-amber-400">
            ⚠ 满足最低启动条件，可强行启动
          </div>
        )}
      </div>

      <div className="mb-6 flex flex-col gap-2">
        {readiness.sections.map((s) => {
          const meta = SECTION_META.find((m) => m.type === s.section_type)!
          return (
            <div key={s.section_type} className="rounded-lg border border-line bg-bg-soft p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {meta.icon} {meta.label}
                </span>
                <span className={`text-xs font-medium ${levelColors[s.level]}`}>
                  {levelLabels[s.level]}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-faint">{s.reason}</p>
              {s.missing_items.length > 0 && (
                <div className="mt-1 text-[10px] text-rose-400">
                  缺失: {s.missing_items.join(', ')}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {launchStatus && (
        <div className="mb-4 rounded-lg border border-line bg-bg-soft p-3 text-xs text-ink-soft">
          {launchStatus}
        </div>
      )}

      <button
        onClick={onLaunch}
        disabled={launching || readiness.overall === 'inspiration_only' || (readiness.overall === 'need_guidance' && !readiness.can_force_launch)}
        className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {launching
          ? '正在进入自动编排台...'
          : readiness.overall === 'can_launch'
            ? '🚀 生成启动快照并启动编排'
            : '⚠ 强行启动（生成快照）'}
      </button>
    </div>
  )
}

function ImportManager({
  projectId,
  onChanged
}: {
  projectId: string
  onChanged: () => Promise<void>
}): JSX.Element {
  const [docs, setDocs] = useState<ImportedDocument[]>([])
  const [segments, setSegments] = useState<ParsedSegment[]>([])
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)

  const refresh = async (): Promise<void> => {
    setDocs(await api.import.listDocuments(projectId))
    setSegments(await api.bibleSegment.list(projectId))
  }

  useEffect(() => {
    void refresh()
  }, [projectId])

  const handleFile = async (file: File): Promise<void> => {
    const text = await file.text()
    await api.import.document(projectId, file.name, text)
    await refresh()
    await onChanged?.()
  }

  const handlePaste = async (): Promise<void> => {
    if (!pasteText.trim()) return
    await api.import.document(projectId, '粘贴文本.md', pasteText)
    setPasteText('')
    await refresh()
    await onChanged?.()
  }

  const handleParse = async (docId: string): Promise<void> => {
    setParsing(true)
    try {
      await api.import.parseDocument(projectId, docId)
      await refresh()
      await onChanged()
    } finally {
      setParsing(false)
    }
  }

  const handleParseAll = async (): Promise<void> => {
    setParsing(true)
    try {
      await api.import.parseAll(projectId)
      await refresh()
      await onChanged()
    } finally {
      setParsing(false)
    }
  }

  const handleParseAndMergeAll = async (): Promise<void> => {
    setParsing(true)
    try {
      await api.import.parseAndMergeAll(projectId)
      await refresh()
      await onChanged()
    } finally {
      setParsing(false)
    }
  }

  const handleMerge = async (segId: string): Promise<void> => {
    await api.import.mergeSegments(projectId, [segId])
    await refresh()
    await onChanged()
  }

  const handleIgnore = async (segId: string): Promise<void> => {
    await api.bibleSegment.updateStatus(segId, 'ignored')
    await refresh()
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-semibold">📥 导入管理</h1>
      <p className="mb-6 text-xs text-ink-faint">导入 Markdown 文档或粘贴文本，系统自动识别分类</p>

      <div className="mb-6 rounded-lg border-2 border-dashed border-line p-6 text-center">
        <input
          type="file"
          accept=".md,.txt"
          multiple
          onChange={(e) => {
            const files = e.target.files
            if (files) {
              for (const f of Array.from(files)) {
                void handleFile(f)
              }
            }
          }}
          className="hidden"
          id="file-input"
        />
        <label
          htmlFor="file-input"
          className="cursor-pointer rounded-md bg-bg-softer px-4 py-2 text-sm text-ink-soft hover:bg-bg"
        >
          📁 选择 Markdown 文件
        </label>
        <p className="mt-2 text-xs text-ink-faint">或拖拽文件到此处</p>
      </div>

      <div className="mb-6">
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="或粘贴文本内容..."
          rows={4}
          className="w-full resize-y rounded border border-line bg-bg-soft p-2 text-sm outline-none focus:border-emerald-600"
        />
        <button
          onClick={handlePaste}
          disabled={!pasteText.trim()}
          className="mt-2 rounded-md bg-bg-softer px-3 py-1 text-xs text-ink-soft hover:bg-bg disabled:opacity-50"
        >
          导入粘贴文本
        </button>
      </div>

      {docs.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">已导入文档（{docs.length}）</h2>
            <div className="flex gap-2">
              <button
                onClick={handleParseAll}
                disabled={parsing}
                className="rounded bg-bg-softer px-2 py-1 text-xs text-ink-soft hover:bg-bg disabled:opacity-50"
              >
                {parsing ? '解析中...' : '解析全部'}
              </button>
              <button
                onClick={handleParseAndMergeAll}
                disabled={parsing}
                className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {parsing ? '处理中...' : '解析并合并全部'}
              </button>
            </div>
          </div>
          {docs.map((doc) => (
            <div key={doc.id} className="mb-2 flex items-center justify-between rounded border border-line bg-bg-soft p-2 text-xs">
              <div>
                <span className="font-medium">{doc.filename}</span>
                <span className="ml-2 text-ink-faint">{doc.char_count} 字</span>
                <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${
                  doc.status === 'parsed' ? 'bg-emerald-600/20 text-emerald-400' :
                  doc.status === 'merged' ? 'bg-blue-600/20 text-blue-400' :
                  'bg-amber-600/20 text-amber-400'
                }`}>
                  {doc.status === 'pending' ? '待解析' : doc.status === 'parsed' ? '已解析' : doc.status === 'merged' ? '已合并' : '已忽略'}
                </span>
              </div>
              <div className="flex gap-1">
                {doc.status === 'pending' && (
                  <button
                    onClick={() => handleParse(doc.id)}
                    disabled={parsing}
                    className="rounded px-2 py-1 text-emerald-400 hover:bg-emerald-500/10"
                  >
                    解析
                  </button>
                )}
                <button
                  onClick={async () => {
                    await api.import.deleteDocument(projectId, doc.id)
                    await refresh()
                  }}
                  className="rounded px-2 py-1 text-rose-400 hover:bg-rose-500/10"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {segments.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">解析片段（{segments.length}）</h2>
          {segments.map((seg) => (
            <div key={seg.id} className="mb-2 rounded border border-line bg-bg-soft p-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-bg-softer px-1.5 py-0.5 text-[10px]">
                    {seg.detected_type}
                  </span>
                  {seg.target_section && (
                    <span className="text-[10px] text-emerald-400">
                      → {seg.target_section}.{seg.target_key}
                    </span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                    seg.merge_status === 'merged' ? 'bg-emerald-600/20 text-emerald-400' :
                    seg.merge_status === 'conflict' ? 'bg-rose-600/20 text-rose-400' :
                    seg.merge_status === 'ignored' ? 'bg-gray-600/20 text-gray-400' :
                    'bg-amber-600/20 text-amber-400'
                  }`}>
                    {seg.merge_status}
                  </span>
                </div>
                {seg.merge_status === 'pending' && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleMerge(seg.id)}
                      className="rounded px-2 py-0.5 text-emerald-400 hover:bg-emerald-500/10"
                    >
                      合并
                    </button>
                    <button
                      onClick={() => handleIgnore(seg.id)}
                      className="rounded px-2 py-0.5 text-gray-400 hover:bg-gray-500/10"
                    >
                      忽略
                    </button>
                  </div>
                )}
              </div>
              <div className="max-h-24 overflow-auto whitespace-pre-wrap text-ink-soft">
                {seg.raw_text.slice(0, 200)}
                {seg.raw_text.length > 200 && '...'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GuidedMode({
  projectId,
  onChanged
}: {
  projectId: string
  onChanged: () => Promise<void>
}): JSX.Element {
  const [questions, setQuestions] = useState<GuidedQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const refresh = async (): Promise<void> => {
    setQuestions(await api.guided.getQuestions(projectId))
  }

  useEffect(() => {
    void refresh()
  }, [projectId])

  const handleSubmit = async (): Promise<void> => {
    setSubmitting(true)
    try {
      const answerList = questions
        .filter((q) => answers[q.id]?.trim())
        .map((q) => ({
          questionId: q.id,
          answer: answers[q.id],
          targetSection: q.target_section,
          targetKey: q.target_key
        }))
      await api.guided.submitAnswers(projectId, answerList)
      setAnswers({})
      await refresh()
      await onChanged()
    } finally {
      setSubmitting(false)
    }
  }

  const handleAiDecide = async (questionId: string): Promise<void> => {
    const q = questions.find((x) => x.id === questionId)
    if (!q) return
    setAnswers({ ...answers, [questionId]: '(交给 AI 决定)' })
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-semibold">💬 引导问答模式</h1>
      <p className="mb-6 text-xs text-ink-faint">回答关键问题，AI 自动整理进 Story Bible</p>

      {questions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-ink-faint">
          当前素材已足够，无需引导。
          <br />
          请前往「启动准备度」面板查看详情。
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {questions.map((q, idx) => (
              <div key={q.id} className="rounded-lg border border-line bg-bg-soft p-4">
                <div className="mb-2 text-sm font-medium">
                  Q{idx + 1}. {q.question}
                </div>
                {q.options ? (
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setAnswers({ ...answers, [q.id]: opt })}
                        className={`rounded border px-2 py-1 text-xs ${
                          answers[q.id] === opt
                            ? 'border-emerald-600 bg-emerald-600/20 text-emerald-400'
                            : 'border-line text-ink-soft hover:bg-bg-softer'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea
                    value={answers[q.id] || ''}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    placeholder="输入你的想法..."
                    rows={3}
                    className="w-full resize-y rounded border border-line bg-bg p-2 text-sm outline-none focus:border-emerald-600"
                  />
                )}
                <div className="mt-2 flex gap-2 text-[10px]">
                  <button
                    onClick={() => setAnswers({ ...answers, [q.id]: '' })}
                    className="text-ink-faint hover:text-ink"
                  >
                    跳过
                  </button>
                  {q.allow_ai_decide && (
                    <button
                      onClick={() => handleAiDecide(q.id)}
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      交给 AI 决定
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? '提交中...' : '提交回答'}
          </button>
        </>
      )}
    </div>
  )
}
