import type { RouteState } from '@shared/types'

const PHASE_LABELS: Record<string, string> = {
  init: '初始',
  premise: '前提设定',
  outline: '大纲规划',
  writing: '写作中',
  complete: '已完成'
}

const FLOW_LABELS: Record<string, string> = {
  writing: '正常写作',
  reviewing: '评审中',
  rewriting: '重写中',
  polishing: '打磨中',
  steering: '处理用户干预'
}

export function generateReminder(state: RouteState): string {
  const lines: string[] = []

  lines.push(`当前阶段: ${PHASE_LABELS[state.phase] ?? state.phase}`)
  lines.push(`当前流程: ${FLOW_LABELS[state.flow] ?? state.flow}`)

  if (state.lastCompleted > 0) {
    lines.push(`已完成: ${state.lastCompleted} 章 / 计划 ${state.totalPlannedChapters} 章`)
  } else {
    lines.push(`尚未开始写作，已规划 ${state.totalPlannedChapters} 章`)
  }

  if (state.nextChapter > 0 && state.phase === 'writing') {
    lines.push(`下一章: 第 ${state.nextChapter} 章`)
  }

  if (state.chapterReadiness && !state.chapterReadiness.readyToWrite) {
    lines.push(`⚠ 当前章节阻塞: ${state.chapterReadiness.blockingIssues.join(', ')}（优先补齐当前章前置条件）`)
  }

  if (state.pendingRewrites.length > 0) {
    lines.push(`⚠ 待重写章节: 第 ${state.pendingRewrites.join(', ')} 章`)
  }

  if (state.arcBoundary?.isArcEnd) {
    const b = state.arcBoundary
    lines.push(`📍 已到达第 ${b.volume} 卷第 ${b.arc} 弧末尾`)
    if (!state.hasArcReview) lines.push('→ 需要执行弧级评审（调用 editor subagent）')
    else if (!state.hasArcSummary) lines.push('→ 需要生成弧摘要（调用 editor subagent）')
    else if (b.isVolumeEnd && !state.hasVolumeSummary) lines.push('→ 需要生成卷摘要（调用 editor subagent）')
    else if (b.needsExpansion) lines.push('→ 下一弧骨架待展开（调用 architect subagent）')
    else if (b.needsNewVolume) lines.push('→ 卷末需决定追加新卷或结束全书（调用 architect subagent）')
  }

  if (state.foundationMissing.length > 0) {
    lines.push(`⚠ 设定缺失项: ${state.foundationMissing.join(', ')}（调用 architect subagent 补齐）`)
  }

  if (state.flow === 'steering') {
    lines.push('⚠ 用户干预指令待处理，请按干预要求裁定下一步')
  }

  return `<system-reminder>\n${lines.join('\n')}\n</system-reminder>`
}
