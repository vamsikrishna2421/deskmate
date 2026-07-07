/** OpenAI chat-completions client — the optional REMOTE assistant.
 *  OPT-IN only: while active, captured message text is sent to OpenAI (Settings → Assistant
 *  says so in plain words). The model is pinned to OPENAI_MODEL (gpt-5-nano, the cheapest
 *  tier) by owner's rule — no UI path may select a pricier model. The API key is stored
 *  safeStorage(DPAPI)-encrypted and decrypted only in main, per call.
 *  Mirrors OllamaClient's public surface so LlmRouter can swap providers freely. */

import {
  OLLAMA_RESPONSE_MAX_BYTES,
  OPENAI_BASE_URL,
  OPENAI_HEALTH_TIMEOUT_MS,
  OPENAI_MODEL
} from '@shared/constants'
import type { ChatOptions, OllamaClientStatus } from './ollamaClient'
import { LlmError, llmRequest } from './http'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** gpt-5* / o* reasoning models reject temperature and want reasoning kept minimal for
 *  latency-bound extraction work. */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model)
}

/** OpenAI strict json_schema requires every object node to close additionalProperties and
 *  list every property in required. Our Ollama-format schemas already satisfy the required
 *  rule; this enforces both defensively on a deep copy. */
export function toStrictSchema(schema: object): object {
  const clone = JSON.parse(JSON.stringify(schema)) as unknown
  const walk = (node: unknown): void => {
    if (!isRecord(node)) return
    if (node.type === 'object' && isRecord(node.properties)) {
      node.additionalProperties = false
      node.required = Object.keys(node.properties)
      for (const child of Object.values(node.properties)) walk(child)
    }
    if (isRecord(node.items)) walk(node.items)
  }
  walk(clone)
  return clone as object
}

export class OpenAiClient {
  /** Returns the decrypted API key, or '' when not configured. */
  private readonly getApiKey: () => string
  private current: OllamaClientStatus = { reachable: false, models: [] }
  private readonly listeners = new Set<(s: OllamaClientStatus) => void>()

  constructor(getApiKey: () => string) {
    this.getApiKey = getApiKey
  }

  /** GET /v1/models — proves both connectivity and key validity. */
  async health(): Promise<boolean> {
    const key = this.getApiKey()
    if (!key) {
      this.setStatus({ reachable: false, models: [] })
      return false
    }
    try {
      const res = await llmRequest(
        `${OPENAI_BASE_URL}/v1/models?limit=1`,
        { method: 'GET', headers: { authorization: `Bearer ${key}` } },
        OPENAI_HEALTH_TIMEOUT_MS,
        OLLAMA_RESPONSE_MAX_BYTES
      )
      this.setStatus({ reachable: res.ok, models: res.ok ? [OPENAI_MODEL] : [] })
      return res.ok
    } catch {
      this.setStatus({ reachable: false })
      return false
    }
  }

  /** The pinned model — no remote model marketplace on purpose. */
  async listModels(): Promise<string[]> {
    return this.getApiKey() ? [OPENAI_MODEL] : []
  }

  async pickModel(): Promise<string | undefined> {
    if (!this.getApiKey()) {
      this.setStatus({ reachable: false, activeModel: undefined })
      return undefined
    }
    // Optimistic: a stored key means usable until a call says otherwise — pickModel runs
    // before every job and must not add a network round-trip to each enrichment.
    this.setStatus({ activeModel: OPENAI_MODEL, models: [OPENAI_MODEL] })
    return OPENAI_MODEL
  }

  /** POST /v1/chat/completions — same ChatOptions contract as OllamaClient.chat. */
  async chat(opts: ChatOptions): Promise<string> {
    const key = this.getApiKey()
    if (!key) {
      this.setStatus({ reachable: false })
      throw new LlmError('network', 'no OpenAI API key configured')
    }
    const reasoning = isReasoningModel(opts.model)
    const body = JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ],
      ...(opts.format
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'result', strict: true, schema: toStrictSchema(opts.format) }
            }
          }
        : {}),
      // Reasoning models reject sampling params; minimal effort keeps nano fast and cheap.
      // No max_completion_tokens: reasoning tokens count against it and a truncated JSON
      // body is worse than a longer wait (the transport cap + timeout still bound us).
      ...(reasoning ? { reasoning_effort: 'minimal' } : { temperature: opts.temperature })
    })
    let res: { ok: boolean; status: number; text: string }
    try {
      res = await llmRequest(
        `${OPENAI_BASE_URL}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body
        },
        opts.timeoutMs,
        OLLAMA_RESPONSE_MAX_BYTES,
        opts.signal
      )
    } catch (err) {
      if (err instanceof LlmError && err.kind === 'network') this.setStatus({ reachable: false })
      throw err
    }
    this.setStatus({ reachable: true })
    if (!res.ok) {
      throw new LlmError('http', `OpenAI returned ${res.status}: ${extractApiError(res.text)}`, res.status)
    }
    const message = firstChoiceMessage(res.text)
    if (typeof message.refusal === 'string' && message.refusal.length > 0) {
      throw new LlmError('http', `model refused: ${message.refusal}`, res.status)
    }
    if (typeof message.content !== 'string' || message.content.length === 0) {
      throw new LlmError('http', 'chat response missing message content', res.status)
    }
    return message.content
  }

  status(): OllamaClientStatus {
    return {
      reachable: this.current.reachable,
      models: [...this.current.models],
      activeModel: this.current.activeModel
    }
  }

  onStatusChange(cb: (s: OllamaClientStatus) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private setStatus(patch: { reachable?: boolean; models?: string[]; activeModel?: string | undefined }): void {
    const prev = this.current
    const next: OllamaClientStatus = {
      reachable: patch.reachable ?? prev.reachable,
      models: patch.models ?? prev.models,
      activeModel: 'activeModel' in patch ? patch.activeModel : prev.activeModel
    }
    this.current = next
    const changed =
      next.reachable !== prev.reachable ||
      next.activeModel !== prev.activeModel ||
      next.models.length !== prev.models.length ||
      next.models.some((m, i) => m !== prev.models[i])
    if (!changed) return
    const snapshot = this.status()
    for (const cb of this.listeners) cb(snapshot)
  }
}

function extractApiError(text: string): string {
  try {
    const json: unknown = JSON.parse(text)
    if (isRecord(json) && isRecord(json.error) && typeof json.error.message === 'string') {
      return json.error.message.slice(0, 200)
    }
  } catch {
    /* fall through */
  }
  return text.slice(0, 200) || 'no error body'
}

function firstChoiceMessage(text: string): { content?: unknown; refusal?: unknown } {
  try {
    const json: unknown = JSON.parse(text)
    if (isRecord(json) && Array.isArray(json.choices) && isRecord(json.choices[0])) {
      const message: unknown = json.choices[0].message
      if (isRecord(message)) return message
    }
  } catch {
    /* fall through */
  }
  throw new LlmError('http', 'malformed chat completion response')
}
