import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import type { ApiProvider, ModelTier } from '@shared/types'

const PRESETS: Array<{
  label: string
  provider: string
  base_url: string
  llm_model: string
  embedding_model: string
  usage: 'llm' | 'embedding' | 'both'
}> = [
  {
    label: 'DeepSeek (LLM)',
    provider: 'deepseek',
    base_url: 'https://api.deepseek.com/v1',
    llm_model: 'deepseek-chat',
    embedding_model: '',
    usage: 'llm'
  },
  {
    label: 'Ollama 本地 (Embedding)',
    provider: 'ollama',
    base_url: 'http://localhost:11434',
    llm_model: '',
    embedding_model: 'nomic-embed-text',
    usage: 'embedding'
  },
  {
    label: 'OpenAI (LLM + Embedding)',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    llm_model: 'gpt-4o-mini',
    embedding_model: 'text-embedding-3-small',
    usage: 'both'
  }
]

type UsageType = 'llm' | 'embedding' | 'both'

export function Settings(): JSX.Element {
  const [providers, setProviders] = useState<ApiProvider[]>([])
  const [encAvailable, setEncAvailable] = useState(false)
  const [form, setForm] = useState({
    provider: 'deepseek',
    base_url: 'https://api.deepseek.com/v1',
    api_key: '',
    llm_model: 'deepseek-chat',
    embedding_model: '',
    model_tier: 'flash' as ModelTier,
    usage: 'llm' as UsageType
  })

  const refresh = (): void => {
    void api.config.listProviders().then((p: ApiProvider[]) => setProviders(p))
    void api.config.encryptionAvailable().then((v: boolean) => setEncAvailable(v))
  }

  useEffect(refresh, [])

  const handleSave = async (): Promise<void> => {
    const is_active = form.usage === 'llm' || form.usage === 'both' ? 1 : 0
    const is_embedding_active = form.usage === 'embedding' || form.usage === 'both' ? 1 : 0
    await api.config.saveProvider({
      provider: form.provider,
      base_url: form.base_url,
      api_key: form.api_key,
      llm_model: form.llm_model,
      embedding_model: form.embedding_model,
      model_tier: form.usage === 'embedding' ? null : form.model_tier,
      is_active,
      is_embedding_active
    })
    setForm({
      ...form,
      api_key: '',
      provider: 'deepseek',
      base_url: 'https://api.deepseek.com/v1',
      llm_model: 'deepseek-chat',
      embedding_model: '',
      model_tier: 'flash',
      usage: 'llm'
    })
    refresh()
  }

  const handleSetActive = async (id: string): Promise<void> => {
    await api.config.setActiveProvider(id)
    refresh()
  }

  const handleSetEmbeddingActive = async (id: string): Promise<void> => {
    await api.config.setActiveEmbedding(id)
    refresh()
  }

  const handleDelete = async (id: string): Promise<void> => {
    await api.config.deleteProvider(id)
    refresh()
  }

  const applyPreset = (preset: (typeof PRESETS)[number]): void => {
    setForm({
      provider: preset.provider,
      base_url: preset.base_url,
      api_key: '',
      llm_model: preset.llm_model,
      embedding_model: preset.embedding_model,
      model_tier: preset.provider === 'openai' ? 'pro' : 'flash',
      usage: preset.usage
    })
  }

  const needsApiKey = form.provider !== 'ollama'

  const llmProviders = providers.filter((p) => p.llm_model)
  const embeddingProviders = providers.filter((p) => p.embedding_model)

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-xl font-semibold">设置</h1>
      <p className="mb-6 text-sm text-ink-soft">
        API Key 通过 Electron safeStorage 加密存储，明文不落库。
      </p>

      <div className="mb-4 rounded-md border border-line bg-bg-soft px-4 py-3 text-xs">
        safeStorage 加密可用：
        <span className={encAvailable ? 'text-emerald-400' : 'text-rose-400'}>
          {encAvailable ? ' 是' : ' 否'}
        </span>
      </div>

      {/* ── 添加 API 配置 ── */}
      <div className="mb-8 rounded-lg border border-line bg-bg-soft p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-soft">添加 API 配置</h2>

        <div className="mb-3 flex flex-wrap gap-2">
          <span className="text-xs text-ink-faint">快捷预设：</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:bg-bg-softer"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="mb-3 flex gap-2">
          {(['llm', 'embedding', 'both'] as UsageType[]).map((u) => (
            <button
              key={u}
              onClick={() => setForm({ ...form, usage: u })}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                form.usage === u
                  ? 'bg-emerald-600 text-white'
                  : 'bg-bg-softer text-ink-soft hover:bg-bg'
              }`}
            >
              {u === 'llm' ? '🧠 LLM 专用' : u === 'embedding' ? '📊 Embedding 专用' : '🔀 两者都用'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider">
            <input
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Base URL">
            <input
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              className={inputCls}
            />
          </Field>
          {(form.usage === 'llm' || form.usage === 'both') && (
            <Field label="LLM 模型">
              <input
                value={form.llm_model}
                onChange={(e) => setForm({ ...form, llm_model: e.target.value })}
                className={inputCls}
              />
            </Field>
          )}
          {(form.usage === 'llm' || form.usage === 'both') && (
            <Field label="模型 Tier">
              <select
                value={form.model_tier}
                onChange={(e) => setForm({ ...form, model_tier: e.target.value as ModelTier })}
                className={inputCls}
              >
                <option value="flash">Flash</option>
                <option value="pro">Pro</option>
              </select>
            </Field>
          )}
          {(form.usage === 'embedding' || form.usage === 'both') && (
            <Field label="Embedding 模型">
              <input
                value={form.embedding_model}
                onChange={(e) => setForm({ ...form, embedding_model: e.target.value })}
                className={inputCls}
              />
            </Field>
          )}
          <div className="col-span-2">
            <Field label={needsApiKey ? 'API Key' : 'API Key（本地 Ollama 无需填写）'}>
              <input
                type="password"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={needsApiKey ? 'sk-...' : '留空即可'}
                className={inputCls}
              />
            </Field>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={needsApiKey && !form.api_key.trim()}
          className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          保存
        </button>
      </div>

      {/* ── LLM 提供商 ── */}
      <h2 className="mb-3 text-sm font-medium text-ink-soft">
        🧠 LLM 提供商（{llmProviders.length}）
      </h2>
      {llmProviders.length === 0 ? (
        <div className="mb-6 rounded-lg border border-dashed border-line p-4 text-center text-xs text-ink-faint">
          暂无 LLM 配置
        </div>
      ) : (
        <div className="mb-6 flex flex-col gap-2">
          {llmProviders.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              isActive={p.is_active === 1}
              isEmbeddingActive={p.is_embedding_active === 1}
              onSetActive={() => handleSetActive(p.id)}
              onSetEmbeddingActive={() => handleSetEmbeddingActive(p.id)}
              onDelete={() => handleDelete(p.id)}
              showEmbedding={p.embedding_model !== ''}
            />
          ))}
        </div>
      )}

      {/* ── Embedding 提供商 ── */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink-soft">
          📊 Embedding 提供商（{embeddingProviders.length}）
        </h2>
        <button
          onClick={async () => {
            try {
              const r = await api.config.testEmbedding()
              alert(r.ok ? `✅ 连接成功\n模型: ${r.model}\n维度: ${r.dims}` : `❌ 连接失败\n${r.message}`)
            } catch (e) { alert(`❌ 测试异常: ${(e as Error).message}`) }
          }}
          className="rounded border border-line px-3 py-1 text-xs text-ink-soft hover:text-ink hover:border-[#d46b2c]"
        >
          测试连接
        </button>
      </div>
      {embeddingProviders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-ink-faint">
          暂无 Embedding 配置
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {embeddingProviders.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              isActive={p.is_active === 1}
              isEmbeddingActive={p.is_embedding_active === 1}
              onSetActive={() => handleSetActive(p.id)}
              onSetEmbeddingActive={() => handleSetEmbeddingActive(p.id)}
              onDelete={() => handleDelete(p.id)}
              showLLM={p.llm_model !== ''}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ProviderRow({
  provider: p,
  isActive,
  isEmbeddingActive,
  onSetActive,
  onSetEmbeddingActive,
  onDelete,
  showLLM,
  showEmbedding
}: {
  provider: ApiProvider
  isActive: boolean
  isEmbeddingActive: boolean
  onSetActive: () => void
  onSetEmbeddingActive: () => void
  onDelete: () => void
  showLLM?: boolean
  showEmbedding?: boolean
}): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border border-line bg-bg-soft px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">{p.provider}</span>
        {p.llm_model && (showLLM === undefined || showLLM) && (
          <span className="rounded bg-bg-softer px-1.5 py-0.5 text-[10px] text-ink-faint">
            LLM: {p.llm_model}{p.model_tier ? ` · ${p.model_tier}` : ''}
          </span>
        )}
        {p.embedding_model && (showEmbedding === undefined || showEmbedding) && (
          <span className="rounded bg-bg-softer px-1.5 py-0.5 text-[10px] text-ink-faint">
            EMB: {p.embedding_model}
          </span>
        )}
        {isActive && (
          <span className="rounded bg-blue-600/20 px-1.5 py-0.5 text-[10px] text-blue-400">
            LLM 活跃
          </span>
        )}
        {isEmbeddingActive && (
          <span className="rounded bg-purple-600/20 px-1.5 py-0.5 text-[10px] text-purple-400">
            Embedding 活跃
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {p.llm_model && !isActive && (
          <button
            onClick={onSetActive}
            className="rounded px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/10"
          >
            设为 LLM
          </button>
        )}
        {p.embedding_model && !isEmbeddingActive && (
          <button
            onClick={onSetEmbeddingActive}
            className="rounded px-2 py-1 text-xs text-purple-400 hover:bg-purple-500/10"
          >
            设为 EMB
          </button>
        )}
        <button
          onClick={onDelete}
          className="rounded px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
        >
          删除
        </button>
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-emerald-600'

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-faint">{label}</span>
      {children}
    </label>
  )
}
