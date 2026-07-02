/** Ollama HTTP client — all LLM traffic lives in main (ARCHITECTURE.md §2.6, §5.10).
 *  Base URL is validated loopback-only; non-loopback config is treated as unreachable.
 *  Health is checked lazily by callers — no periodic ping. Status is cached and
 *  onStatusChange fires only on actual flips. */

import type { OllamaSettings } from '@shared/types/appState'
import {
  OLLAMA_HEALTH_TIMEOUT_MS,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_NUM_CTX,
  OLLAMA_RESPONSE_MAX_BYTES,
  PREFERRED_MODELS
} from '@shared/constants'

export type OllamaErrorKind = 'timeout' | 'network' | 'http' | 'toolarge'

export class OllamaError extends Error {
  readonly kind: OllamaErrorKind
  readonly status?: number

  constructor(kind: OllamaErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'OllamaError'
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

export interface OllamaClientStatus {
  reachable: boolean
  models: string[]
  activeModel?: string
}

export interface ChatOptions {
  model: string
  system: string
  user: string
  format?: object
  temperature: number
  numPredict: number
  timeoutMs: number
  signal?: AbortSignal
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TAGS_TIMEOUT_MS = 5_000

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export class OllamaClient {
  private readonly getSettings: () => OllamaSettings
  private current: OllamaClientStatus = { reachable: false, models: [] }
  private readonly listeners = new Set<(s: OllamaClientStatus) => void>()

  constructor(getSettings: () => OllamaSettings) {
    this.getSettings = getSettings
  }

  /** GET /api/version, 2 s timeout; flips + caches reachability. */
  async health(): Promise<boolean> {
    const base = this.resolveBaseUrl()
    if (!base) {
      this.setStatus({ reachable: false })
      return false
    }
    try {
      const res = await this.request(`${base}/api/version`, { method: 'GET' }, OLLAMA_HEALTH_TIMEOUT_MS)
      this.setStatus({ reachable: res.ok })
      return res.ok
    } catch {
      this.setStatus({ reachable: false })
      return false
    }
  }

  /** GET /api/tags → installed model names; updates cached status. */
  async listModels(): Promise<string[]> {
    const base = this.resolveBaseUrl()
    if (!base) {
      this.setStatus({ reachable: false })
      throw new OllamaError('network', 'Ollama base URL must be loopback (localhost / 127.0.0.1 / [::1])')
    }
    let res: { ok: boolean; status: number; text: string }
    try {
      res = await this.request(`${base}/api/tags`, { method: 'GET' }, TAGS_TIMEOUT_MS)
    } catch (err) {
      if (err instanceof OllamaError && (err.kind === 'network' || err.kind === 'timeout')) {
        this.setStatus({ reachable: false })
      }
      throw err
    }
    if (!res.ok) {
      this.setStatus({ reachable: true })
      throw new OllamaError('http', `GET /api/tags returned ${res.status}`, res.status)
    }
    let names: string[]
    try {
      const json: unknown = JSON.parse(res.text)
      if (!isRecord(json) || !Array.isArray(json.models)) throw new Error('missing models array')
      names = json.models
        .map((m) => (isRecord(m) && typeof m.name === 'string' ? m.name : null))
        .filter((n): n is string => n !== null)
    } catch {
      this.setStatus({ reachable: true })
      throw new OllamaError('http', 'malformed /api/tags response', res.status)
    }
    this.setStatus({ reachable: true, models: names })
    return names
  }

  /** selectedModel if installed, else first installed model in preference order. */
  async pickModel(): Promise<string | undefined> {
    let models: string[]
    try {
      models = await this.listModels()
    } catch {
      return undefined
    }
    const settings = this.getSettings()
    const preferred = settings.preferredModels.length > 0 ? settings.preferredModels : [...PREFERRED_MODELS]
    const selected = settings.selectedModel
    const chosen =
      selected && models.includes(selected) ? selected : preferred.find((m) => models.includes(m))
    this.setStatus({ activeModel: chosen })
    return chosen
  }

  /** POST /api/chat, stream:false — returns the assistant message content. */
  async chat(opts: ChatOptions): Promise<string> {
    const base = this.resolveBaseUrl()
    if (!base) {
      this.setStatus({ reachable: false })
      throw new OllamaError('network', 'Ollama base URL must be loopback (localhost / 127.0.0.1 / [::1])')
    }
    const body = JSON.stringify({
      model: opts.model,
      stream: false,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ],
      ...(opts.format ? { format: opts.format } : {}),
      options: { temperature: opts.temperature, num_ctx: OLLAMA_NUM_CTX, num_predict: opts.numPredict },
      keep_alive: OLLAMA_KEEP_ALIVE
    })
    let res: { ok: boolean; status: number; text: string }
    try {
      res = await this.request(
        `${base}/api/chat`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body },
        opts.timeoutMs,
        opts.signal
      )
    } catch (err) {
      if (err instanceof OllamaError && err.kind === 'network') this.setStatus({ reachable: false })
      throw err
    }
    this.setStatus({ reachable: true })
    if (!res.ok) throw new OllamaError('http', `POST /api/chat returned ${res.status}`, res.status)
    let content: unknown
    try {
      const json: unknown = JSON.parse(res.text)
      content = isRecord(json) && isRecord(json.message) ? json.message.content : undefined
    } catch {
      throw new OllamaError('http', 'malformed /api/chat response', res.status)
    }
    if (typeof content !== 'string') {
      throw new OllamaError('http', 'chat response missing message content', res.status)
    }
    return content
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

  /** Settings base URL, validated loopback-only. Invalid → null (treated as unreachable). */
  private resolveBaseUrl(): string | null {
    const raw = this.getSettings().baseUrl
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!LOOPBACK_HOSTS.has(url.hostname)) return null
    return url.origin
  }

  /** One controller covers connect + full body read; body is size-capped before parsing. */
  private async request(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    timeoutMs: number,
    external?: AbortSignal
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const ctrl = new AbortController()
    const timeoutErr = new OllamaError('timeout', `request timed out after ${Math.round(timeoutMs / 1000)}s`)
    const timer = setTimeout(() => ctrl.abort(timeoutErr), timeoutMs)
    const onExternalAbort = (): void => ctrl.abort(external?.reason)
    if (external) {
      if (external.aborted) {
        clearTimeout(timer)
        throw external.reason instanceof Error ? external.reason : new Error('aborted')
      }
      external.addEventListener('abort', onExternalAbort, { once: true })
    }
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal })
      const text = await this.readCapped(res)
      return { ok: res.ok, status: res.status, text }
    } catch (err) {
      if (err instanceof OllamaError) throw err
      if (ctrl.signal.aborted) {
        const reason: unknown = ctrl.signal.reason
        if (reason instanceof OllamaError) throw reason
        throw reason instanceof Error ? reason : new Error('aborted')
      }
      throw new OllamaError('network', err instanceof Error ? err.message : 'network error')
    } finally {
      clearTimeout(timer)
      if (external) external.removeEventListener('abort', onExternalAbort)
    }
  }

  private async readCapped(res: Response): Promise<string> {
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > OLLAMA_RESPONSE_MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined)
      throw new OllamaError('toolarge', `response of ${declared} bytes exceeds ${OLLAMA_RESPONSE_MAX_BYTES}-byte cap`)
    }
    if (!res.body) return ''
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > OLLAMA_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new OllamaError('toolarge', `response exceeded ${OLLAMA_RESPONSE_MAX_BYTES}-byte cap`)
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
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
