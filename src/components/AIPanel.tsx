import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/ipc'
import type { AiMessage } from '@shared/types'

type Tab = 'continue' | 'polish' | 'rewrite' | 'chat'
type Style = '简洁' | '文学' | '紧凑'

interface AIPanelProps {
  projectId: string
  chapterId: string | null
  cursorBefore: string
  selectedText: string
}

interface TokenPayload {
  session_id: string
  token: string
  start?: boolean
}
interface DonePayload {
  session_id: string
  content: string
}
interface ErrorPayload {
  message: string
}

export function AIPanel({
  projectId,
  chapterId,
  cursorBefore,
  selectedText
}: AIPanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('continue')
  const [style, setStyle] = useState<Style>('简洁')
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const [chatSessionId, setChatSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [chatInput, setChatInput] = useState('')

  const currentSessionRef = useRef<string | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const chatBoxRef = useRef<HTMLDivElement>(null)

  const hasSelection = selectedText.trim().length > 0

  useEffect(() => {
    const offToken = api.on('aiToken', (payload) => {
      const p = payload as TokenPayload
      if (currentSessionRef.current === null) {
        currentSessionRef.current = p.session_id
      }
      if (currentSessionRef.current !== p.session_id) return
      if (p.start) {
        setStreaming(true)
        return
      }
      setOutput((prev) => prev + p.token)
    })
    const offDone = api.on('aiDone', (payload) => {
      const p = payload as DonePayload
      if (currentSessionRef.current !== p.session_id) return
      setStreaming(false)
      setLoading(false)
      setOutput(p.content)
      currentSessionRef.current = null
      if (tab === 'chat') {
        setChatSessionId(p.session_id)
        void refreshChatMessages(p.session_id)
      }
    })
    const offError = api.on('aiError', (payload) => {
      const p = payload as ErrorPayload
      setStreaming(false)
      setLoading(false)
      currentSessionRef.current = null
      setError(p.message)
    })
    return () => {
      offToken()
      offDone()
      offError()
    }
  }, [tab])

  useEffect(() => {
    setOutput('')
    setError('')
    setCopied(false)
  }, [tab])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight
    }
  }, [messages])

  const refreshChatMessages = async (sid?: string): Promise<void> => {
    const id = sid ?? chatSessionId
    if (!id) return
    try {
      const msgs = await api.ai.getMessages(id)
      setMessages(msgs)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleContinue = async (): Promise<void> => {
    if (!chapterId) {
      setError('请先选择一个章节')
      return
    }
    setOutput('')
    setError('')
    setLoading(true)
    setStreaming(true)
    currentSessionRef.current = null
    try {
      await api.ai.continue({
        project_id: projectId,
        chapter_id: chapterId,
        cursor_before: cursorBefore
      })
    } catch (e) {
      setStreaming(false)
      setLoading(false)
      setError((e as Error).message)
    }
  }

  const handlePolish = async (): Promise<void> => {
    if (!hasSelection) return
    setOutput('')
    setError('')
    setLoading(true)
    setStreaming(true)
    currentSessionRef.current = null
    try {
      await api.ai.polish({
        project_id: projectId,
        selected_text: selectedText,
        style
      })
    } catch (e) {
      setStreaming(false)
      setLoading(false)
      setError((e as Error).message)
    }
  }

  const handleRewrite = async (): Promise<void> => {
    if (!hasSelection) return
    setOutput('')
    setError('')
    setLoading(true)
    setStreaming(true)
    currentSessionRef.current = null
    try {
      await api.ai.rewrite({
        project_id: projectId,
        selected_text: selectedText
      })
    } catch (e) {
      setStreaming(false)
      setLoading(false)
      setError((e as Error).message)
    }
  }

  const handleStop = (): void => {
    api.ai.stop()
    setStreaming(false)
    setLoading(false)
    currentSessionRef.current = null
  }

  const handleCopy = async (): Promise<void> => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('复制失败')
    }
  }

  const handleSendChat = async (): Promise<void> => {
    const msg = chatInput.trim()
    if (!msg || streaming || loading) return
    setError('')
    const userMsg: AiMessage = {
      id: `tmp-${Date.now()}`,
      session_id: chatSessionId ?? '',
      role: 'user',
      content: msg,
      context_refs: [],
      created_at: Date.now()
    }
    setMessages((prev) => [...prev, userMsg])
    setChatInput('')
    setLoading(true)
    setStreaming(true)
    currentSessionRef.current = null
    try {
      await api.ai.chat({
        project_id: projectId,
        session_id: chatSessionId ?? undefined,
        message: msg
      })
    } catch (e) {
      setStreaming(false)
      setLoading(false)
      setError((e as Error).message)
    }
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'continue', label: '续写' },
    { key: 'polish', label: '润色' },
    { key: 'rewrite', label: '改写' },
    { key: 'chat', label: '对话' }
  ]

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-10 shrink-0 items-center border-b border-line px-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded px-3 py-1 text-xs transition-colors ${
              tab === t.key
                ? 'bg-bg-softer text-ink'
                : 'text-ink-faint hover:text-ink-soft'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="shrink-0 border-b border-rose-900/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col p-3">
        {tab !== 'chat' ? (
          <>
            <div className="mb-2 flex shrink-0 items-center gap-2">
              {tab === 'polish' ? (
                <div className="flex items-center gap-1">
                  {((['简洁', '文学', '紧凑'] as Style[])).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStyle(s)}
                      className={`rounded px-2 py-0.5 text-xs ${
                        style === s
                          ? 'bg-emerald-600 text-white'
                          : 'bg-bg-softer text-ink-soft hover:text-ink'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}

              {tab === 'continue' ? (
                <span className="text-xs text-ink-faint">
                  {chapterId ? '基于光标前文续写' : '请先选择章节'}
                </span>
              ) : null}

              {tab === 'polish' || tab === 'rewrite' ? (
                <span className="text-xs text-ink-faint">
                  {hasSelection ? `已选 ${selectedText.length} 字` : '请先在编辑器选中文本'}
                </span>
              ) : null}

              <div className="ml-auto flex items-center gap-1">
                {streaming ? (
                  <button
                    onClick={handleStop}
                    className="rounded bg-rose-600 px-2 py-0.5 text-xs text-white hover:bg-rose-500"
                  >
                    停止
                  </button>
                ) : null}
                {output && !streaming ? (
                  <button
                    onClick={handleCopy}
                    className="rounded bg-bg-softer px-2 py-0.5 text-xs text-ink-soft hover:text-ink"
                  >
                    {copied ? '已复制' : '复制'}
                  </button>
                ) : null}
              </div>
            </div>

            <div
              ref={outputRef}
              className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-bg-soft p-3 text-sm leading-relaxed text-ink"
            >
              {output ? (
                output
              ) : (
                <span className="text-ink-faint">
                  {tab === 'continue'
                    ? '点击「续写」生成后续内容…'
                    : tab === 'polish'
                      ? '选中文本后点击「润色」…'
                      : '选中文本后点击「改写」…'}
                </span>
              )}
              {streaming ? <span className="ml-0.5 animate-pulse text-emerald-500">▍</span> : null}
            </div>

            <div className="mt-2 shrink-0">
              <button
                onClick={
                  tab === 'continue'
                    ? handleContinue
                    : tab === 'polish'
                      ? handlePolish
                      : handleRewrite
                }
                disabled={
                  loading ||
                  streaming ||
                  (tab === 'continue' ? !chapterId : !hasSelection)
                }
                className="w-full rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-bg-softer disabled:text-ink-faint"
              >
                {streaming ? '生成中…' : tab === 'continue' ? '续写' : tab === 'polish' ? '润色' : '改写'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              ref={chatBoxRef}
              className="min-h-0 flex-1 space-y-3 overflow-auto rounded border border-line bg-bg-soft p-3"
            >
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-ink-faint">
                  输入问题，与 AI 探讨灵感…
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-bg-softer text-ink'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))
              )}
              {streaming ? (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-bg-softer px-3 py-2 text-sm text-ink-faint">
                    <span className="animate-pulse">AI 正在思考…</span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-2 flex shrink-0 items-center gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handleSendChat()
                  }
                }}
                placeholder={streaming ? 'AI 回复中…' : '输入消息，回车发送'}
                disabled={streaming}
                className="flex-1 rounded border border-line bg-bg-soft px-3 py-1.5 text-sm text-ink outline-none focus:border-emerald-600"
              />
              {streaming ? (
                <button
                  onClick={handleStop}
                  className="rounded bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-500"
                >
                  停止
                </button>
              ) : (
                <button
                  onClick={handleSendChat}
                  disabled={!chatInput.trim() || loading}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-bg-softer disabled:text-ink-faint"
                >
                  发送
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
