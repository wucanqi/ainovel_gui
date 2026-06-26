export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const ascii = (text.match(/[A-Za-z0-9_]+/g) || []).length
  const other = text.length - cjk - ascii * 4
  return cjk + ascii + Math.max(0, Math.ceil(other / 4))
}
