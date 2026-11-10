import type { ProviderKind } from './providers'

/**
 * Known model backends. Used for one-click setup in the UI and for
 * auto-discovery: local entries are port-scanned, cloud entries are
 * offered automatically when their API-key env var is set.
 *
 * Every cloud entry here speaks OpenAI-style `/chat/completions` + `/models`.
 */
export interface CatalogEntry {
  id: string
  label: string
  kind: ProviderKind
  /** 'local' = runs on this machine (scanned), 'cloud' = hosted API (needs a key). */
  scope: 'local' | 'cloud'
  baseUrl: string
  /** Env vars checked for an API key, first hit wins. */
  keyEnv?: string[]
  /** Where the operator can create a key. */
  keyUrl?: string
  /** Key prefix shown as an input placeholder. */
  keyPlaceholder?: string
}

export const CATALOG: CatalogEntry[] = [
  // ── Local runtimes (scanned on their default ports) ──────────────────
  { id: 'ollama', label: 'Ollama', kind: 'ollama', scope: 'local', baseUrl: 'http://127.0.0.1:11434' },
  { id: 'lmstudio', label: 'LM Studio', kind: 'openai', scope: 'local', baseUrl: 'http://127.0.0.1:1234/v1' },
  { id: 'llamacpp', label: 'llama.cpp / LocalAI', kind: 'openai', scope: 'local', baseUrl: 'http://127.0.0.1:8080/v1' },
  { id: 'vllm', label: 'vLLM', kind: 'openai', scope: 'local', baseUrl: 'http://127.0.0.1:8000/v1' },
  { id: 'jan', label: 'Jan', kind: 'openai', scope: 'local', baseUrl: 'http://127.0.0.1:1337/v1' },
  { id: 'koboldcpp', label: 'KoboldCpp', kind: 'openai', scope: 'local', baseUrl: 'http://127.0.0.1:5001/v1' },
  { id: 'textgen', label: 'text-generation-webui', kind: 'openai', scope: 'local', baseUrl: 'http://127.0.0.1:5000/v1' },
  { id: 'gpt4all', label: 'GPT4All', kind: 'openai', scope: 'local', baseUrl: 'http://127.0.0.1:4891/v1' },

  // ── Hosted APIs ───────────────────────────────────────────────────────
  {
    id: 'openai', label: 'OpenAI', kind: 'openai', scope: 'cloud', baseUrl: 'https://api.openai.com/v1',
    keyEnv: ['OPENAI_API_KEY'], keyUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-…',
  },
  {
    id: 'anthropic', label: 'Anthropic', kind: 'openai', scope: 'cloud', baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: ['ANTHROPIC_API_KEY'], keyUrl: 'https://console.anthropic.com/settings/keys', keyPlaceholder: 'sk-ant-…',
  },
  {
    id: 'gemini', label: 'Google Gemini', kind: 'openai', scope: 'cloud',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: ['GEMINI_API_KEY'], keyUrl: 'https://aistudio.google.com/apikey', keyPlaceholder: 'AIza…',
  },
  {
    id: 'openrouter', label: 'OpenRouter', kind: 'openai', scope: 'cloud', baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: ['OPENROUTER_API_KEY'], keyUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-…',
  },
  {
    id: 'groq', label: 'Groq', kind: 'openai', scope: 'cloud', baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: ['GROQ_API_KEY'], keyUrl: 'https://console.groq.com/keys', keyPlaceholder: 'gsk_…',
  },
  {
    id: 'mistral', label: 'Mistral', kind: 'openai', scope: 'cloud', baseUrl: 'https://api.mistral.ai/v1',
    keyEnv: ['MISTRAL_API_KEY'], keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'deepseek', label: 'DeepSeek', kind: 'openai', scope: 'cloud', baseUrl: 'https://api.deepseek.com/v1',
    keyEnv: ['DEEPSEEK_API_KEY'], keyUrl: 'https://platform.deepseek.com/api_keys', keyPlaceholder: 'sk-…',
  },
  {
    id: 'xai', label: 'xAI', kind: 'openai', scope: 'cloud', baseUrl: 'https://api.x.ai/v1',
    keyEnv: ['XAI_API_KEY'], keyUrl: 'https://console.x.ai', keyPlaceholder: 'xai-…',
  },
  {
    id: 'together', label: 'Together AI', kind: 'openai', scope: 'cloud', baseUrl: 'https://api.together.xyz/v1',
    keyEnv: ['TOGETHER_API_KEY'], keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'fireworks', label: 'Fireworks', kind: 'openai', scope: 'cloud', baseUrl: 'https://api.fireworks.ai/inference/v1',
    keyEnv: ['FIREWORKS_API_KEY'], keyUrl: 'https://fireworks.ai/account/api-keys', keyPlaceholder: 'fw_…',
  },
]

export function catalogEntry(id?: string | null): CatalogEntry | undefined {
  return id ? CATALOG.find((c) => c.id === id) : undefined
}

/** Match a base URL back to a catalog entry (by host + port). */
export function catalogForUrl(baseUrl: string): CatalogEntry | undefined {
  try {
    const host = new URL(baseUrl).host.replace(/^localhost/, '127.0.0.1')
    return CATALOG.find((c) => new URL(c.baseUrl).host === host)
  } catch {
    return undefined
  }
}

/** First env var that holds a key for this entry. */
export function envKeyFor(entry: CatalogEntry): { name: string; value: string } | undefined {
  for (const name of entry.keyEnv ?? []) {
    const value = process.env[name]?.trim()
    if (value) return { name, value }
  }
  return undefined
}
