import { describe, expect, it } from 'vitest'
import { applyFilenameConvention, parseByRules } from '../electron/services/bible-parser'

function classify(filename: string, content: string) {
  return applyFilenameConvention(filename, parseByRules(content))
}

describe('Import filename fallback', () => {
  it('should map 01-世界观.md into world fields', () => {
    const segments = classify(
      '01-世界观.md',
      [
        '规则：超凡能力必须付出寿命代价。',
        '势力：北境议会与灰塔学院长期对立。',
        '地理：故事主要发生在雾港与黑潮群岛。'
      ].join('\n\n')
    )

    expect(segments.map((seg) => seg.target_key)).toEqual([
      'rules',
      'factions',
      'geography'
    ])
    expect(segments.every((seg) => seg.target_section === 'world')).toBe(true)
  })

  it('should map 02-人物.md into character fields', () => {
    const segments = classify(
      '02-人物.md',
      [
        '主角：沈砚，执拗冷静的调查员。',
        '反派：白庭，表面是导师，实际操盘全局。',
        '关系：沈砚与师妹从互不信任走向并肩。'
      ].join('\n\n')
    )

    expect(segments.map((seg) => seg.target_key)).toEqual([
      'protagonist',
      'antagonist',
      'relationships'
    ])
    expect(segments.every((seg) => seg.target_section === 'characters')).toBe(true)
  })

  it('should map 03-主线粗纲.md into structure and compass fields', () => {
    const segments = classify(
      '03-主线粗纲.md',
      [
        '核心冲突：主角必须在真相与家族之间做选择。',
        '主题：信任要靠代价换来。',
        '分卷：第一卷破解旧案，第二卷反攻组织。'
      ].join('\n\n')
    )

    expect(segments.map((seg) => `${seg.target_section}.${seg.target_key}`)).toEqual([
      'compass.core_conflict',
      'compass.theme',
      'structure.volume_skeleton'
    ])
  })

  it('should map 04-重要情节.md into foreshadowing fields', () => {
    const segments = classify(
      '04-重要情节.md',
      [
        '秘密：失踪案的真正幕后是议会内部成员。',
        '伏笔：第一章出现的旧怀表将在终局证明身份。'
      ].join('\n\n')
    )

    expect(segments.map((seg) => seg.target_key)).toEqual([
      'secrets',
      'foreshadowing'
    ])
    expect(segments.every((seg) => seg.target_section === 'foreshadowing')).toBe(true)
  })

  it('should map 05-关键场景细纲.md into chapter plans', () => {
    const segments = classify(
      '05-关键场景细纲.md',
      [
        '第一章：尸检室初见疑点，建立主线悬念。',
        '场景二：码头追逐失败，主角意识到被监视。'
      ].join('\n\n')
    )

    expect(segments.map((seg) => seg.target_key)).toEqual([
      'chapter_plan',
      'chapter_plan'
    ])
    expect(segments.every((seg) => seg.target_section === 'structure')).toBe(true)
  })

  it('should map 06-写作要求.md into style fields', () => {
    const segments = classify(
      '06-写作要求.md',
      [
        '视角：全书采用第三人称限知。',
        '节奏：单章尽量保持事件推动，不长篇空转。',
        '禁忌：不要上帝视角，不要强行解释设定。'
      ].join('\n\n')
    )

    expect(segments.map((seg) => seg.target_key)).toEqual([
      'pov',
      'pacing',
      'taboos'
    ])
    expect(segments.every((seg) => seg.target_section === 'style')).toBe(true)
  })
})
