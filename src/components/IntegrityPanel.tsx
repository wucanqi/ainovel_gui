import { useEffect, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/ipc'
import type {
  ChapterContract,
  ChapterDraft,
  CharacterFactLock,
  DraftGateReport,
  DraftGateVerdict,
  EvaluationCase,
  EvaluationRunResult,
  KnowledgeContract,
  ModelRoutingRule
} from '@shared/types'

interface IntegrityPanelProps {
  projectId: string
  chapterId: string | null
}

type PlanGatePreview = Awaited<ReturnType<typeof api.gate.runPlanGate>> | null

export function IntegrityPanel({ projectId, chapterId }: IntegrityPanelProps): JSX.Element {
  const [loading, setLoading] = useState(false)
  const [chapterContract, setChapterContract] = useState<ChapterContract | null>(null)
  const [knowledgeContract, setKnowledgeContract] = useState<KnowledgeContract | null>(null)
  const [projectLocks, setProjectLocks] = useState<CharacterFactLock[]>([])
  const [latestDraft, setLatestDraft] = useState<ChapterDraft | null>(null)
  const [latestVerdict, setLatestVerdict] = useState<DraftGateVerdict | null>(null)
  const [reports, setReports] = useState<DraftGateReport[]>([])
  const [planGate, setPlanGate] = useState<PlanGatePreview>(null)
  const [routingRules, setRoutingRules] = useState<ModelRoutingRule[]>([])
  const [evaluationCases, setEvaluationCases] = useState<EvaluationCase[]>([])
  const [evaluationResults, setEvaluationResults] = useState<EvaluationRunResult[]>([])
  const [evalLoading, setEvalLoading] = useState(false)
  const lastChapterRef = useRef<string | null>(null)

  const refresh = async (): Promise<void> => {
    if (!chapterId) return
    setLoading(true)
    const chapterChanged = lastChapterRef.current !== chapterId
    lastChapterRef.current = chapterId
    try {
      const [nextChapterContract, nextKnowledgeContract, nextLocks, nextDraft, nextPlanGate, nextRoutingRules, nextCases] =
        await Promise.all([
          api.contract.getChapterContract(projectId, chapterId),
          api.contract.getKnowledgeContract(projectId, chapterId),
          api.factLock.getLocksForProject(projectId),
          api.draft.getLatestDraft(chapterId),
          chapterChanged ? api.gate.runPlanGate(projectId, chapterId).catch(() => null) : Promise.resolve(planGate as PlanGatePreview),
          chapterChanged ? api.routing.listRules(projectId) : Promise.resolve(routingRules),
          api.integrity.getEvaluationCases()
        ])
      setChapterContract(nextChapterContract)
      setKnowledgeContract(nextKnowledgeContract)
      setProjectLocks(nextLocks)
      setLatestDraft(nextDraft)
      setPlanGate(nextPlanGate)
      setRoutingRules(nextRoutingRules)
      setEvaluationCases(nextCases)

      if (nextDraft) {
        const [nextVerdict, nextReports] = await Promise.all([
          api.gate.getLatestVerdict(nextDraft.id),
          api.gate.getGateReports(nextDraft.id)
        ])
        setLatestVerdict(nextVerdict)
        setReports(nextReports)
      } else {
        setLatestVerdict(null)
        setReports([])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [projectId, chapterId])

  const runEvaluations = async (): Promise<void> => {
    if (!chapterId) return
    setEvalLoading(true)
    try {
      const results = await api.integrity.runAllEvaluationCases({
        projectId,
        chapterId,
        draftId: latestDraft?.id
      })
      setEvaluationResults(results)
    } finally {
      setEvalLoading(false)
    }
  }

  if (!chapterId) {
    return (
      <div className="h-full overflow-auto bg-bg-soft p-4 text-sm text-ink-faint">
        选择章节后，这里会显示第四期完整性状态。
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-bg-soft p-4 text-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-ink-faint">Integrity</div>
          <div className="text-base font-semibold text-ink">第四期完整性面板</div>
        </div>
        <button
          onClick={() => void refresh()}
          className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:bg-bg"
        >
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      <Section title="Plan Gate">
        {planGate ? (
          <>
            <StatusBadge verdict={planGate.verdict} />
            <p className="mt-2 text-xs text-ink-soft">{planGate.summary}</p>
          </>
        ) : (
          <Empty text="暂无 Plan Gate 结果" />
        )}
      </Section>

      <Section title="Draft Gate">
        {latestDraft ? (
          <>
            <div className="flex items-center gap-2">
              <StatusBadge verdict={latestVerdict?.verdict ?? 'draft'} />
              <span className="text-xs text-ink-faint">
                draft v{latestDraft.version} · {latestDraft.lifecycle}
              </span>
            </div>
            {latestVerdict ? (
              <p className="mt-2 text-xs text-ink-soft">{latestVerdict.summary}</p>
            ) : (
              <p className="mt-2 text-xs text-ink-faint">最新草稿尚未产生命运判定。</p>
            )}
            <div className="mt-3 space-y-2">
              {reports.length === 0 ? (
                <Empty text="暂无门禁报告" />
              ) : (
                reports.map((report) => (
                  <div key={report.id} className="rounded border border-line bg-bg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{report.check_type}</span>
                      <span className={`text-xs ${severityText(report.severity)}`}>
                        {report.passed ? '通过' : report.severity}
                      </span>
                    </div>
                    {report.violations.length > 0 ? (
                      <div className="mt-2 space-y-1 text-xs text-ink-soft">
                        {report.violations.map((violation, index) => (
                          <div key={`${report.id}-${index}`}>
                            {violation.detail}
                            {violation.evidence ? `：${violation.evidence}` : ''}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <Empty text="当前章节还没有草稿" />
        )}
      </Section>

      <Section title="Contracts">
        <ContractBlock
          label="章节契约"
          items={chapterContract?.required_beats ?? []}
          fallback="未生成章节契约"
        />
        <ContractBlock
          label="知识契约"
          items={knowledgeContract?.forbidden_inferences ?? []}
          fallback="未生成知识契约"
        />
      </Section>

      <Section title="Fact Locks">
        {projectLocks.length === 0 ? (
          <Empty text="当前项目没有事实锁" />
        ) : (
          <div className="space-y-2">
            {projectLocks.slice(0, 10).map((lock) => (
              <div key={lock.id} className="rounded border border-line bg-bg px-3 py-2 text-xs">
                <div className="font-medium text-ink">
                  {lock.fact_key} = {lock.fact_value}
                </div>
                <div className="mt-1 text-ink-faint">{lock.lock_level}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Model Routing">
        <div className="space-y-2">
          {routingRules.slice(0, 8).map((rule) => (
            <div key={rule.id} className="rounded border border-line bg-bg px-3 py-2 text-xs">
              <div className="font-medium text-ink">
                {rule.agent_type} / {rule.task_type}
              </div>
              <div className="mt-1 text-ink-faint">
                {rule.risk_level} → {rule.preferred_tier}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Evaluation Runner">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-ink-faint">内置用例 {evaluationCases.length} 条</span>
          <button
            onClick={() => void runEvaluations()}
            className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:bg-bg"
          >
            {evalLoading ? '运行中...' : '运行全部'}
          </button>
        </div>
        {evaluationResults.length === 0 ? (
          <Empty text="还没有运行评估用例" />
        ) : (
          <div className="space-y-2">
            {evaluationResults.map((result) => (
              <div key={result.case_id} className="rounded border border-line bg-bg px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{result.case_name}</span>
                  <span className={result.passed ? 'text-emerald-400' : 'text-rose-400'}>
                    {result.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <div className="mt-1 text-ink-soft">{result.details}</div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="mb-4 rounded-lg border border-line bg-bg-soft/50 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
        {title}
      </div>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="text-xs text-ink-faint">{text}</div>
}

function ContractBlock({
  label,
  items,
  fallback
}: {
  label: string
  items: string[]
  fallback: string
}): JSX.Element {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-medium text-ink">{label}</div>
      {items.length === 0 ? (
        <Empty text={fallback} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.slice(0, 8).map((item) => (
            <span key={item} className="rounded bg-bg px-2 py-1 text-xs text-ink-soft">
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ verdict }: { verdict: string }): JSX.Element {
  const tone =
    verdict === 'pass'
      ? 'bg-emerald-500/15 text-emerald-300'
      : verdict === 'polish'
        ? 'bg-amber-500/15 text-amber-300'
        : verdict === 'rewrite' || verdict === 'replan' || verdict === 'escalate'
          ? 'bg-rose-500/15 text-rose-300'
          : 'bg-blue-500/15 text-blue-300'
  return <span className={`rounded px-2 py-1 text-xs font-medium ${tone}`}>{verdict}</span>
}

function severityText(severity: string): string {
  if (severity === 'critical' || severity === 'error') return 'text-rose-400'
  if (severity === 'warning') return 'text-amber-400'
  return 'text-emerald-400'
}
