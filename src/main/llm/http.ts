/** Shared HTTP plumbing for LLM clients (Ollama local, OpenAI remote).
 *  One AbortController covers connect + full body read; bodies are size-capped before
 *  parsing. Extracted verbatim from OllamaClient when the remote provider was added —
 *  both providers must fail identically (timeout/network/http/toolarge) because the
 *  enrichment pipeline branches on these kinds. */

export type LlmErrorKind = 'timeout' | 'network' | 'http' | 'toolarge'

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  readonly status?: number

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

export interface HttpInit {
  method: string
  headers?: Record<string, string>
  body?: string
}

export interface HttpResult {
  ok: boolean
  status: number
  text: string
}

export async function llmRequest(
  url: string,
  init: HttpInit,
  timeoutMs: number,
  maxBytes: number,
  external?: AbortSignal
): Promise<HttpResult> {
  const ctrl = new AbortController()
  const timeoutErr = new LlmError('timeout', `request timed out after ${Math.round(timeoutMs / 1000)}s`)
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
    const text = await readCapped(res, maxBytes)
    return { ok: res.ok, status: res.status, text }
  } catch (err) {
    if (err instanceof LlmError) throw err
    if (ctrl.signal.aborted) {
      const reason: unknown = ctrl.signal.reason
      if (reason instanceof LlmError) throw reason
      throw reason instanceof Error ? reason : new Error('aborted')
    }
    throw new LlmError('network', err instanceof Error ? err.message : 'network error')
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onExternalAbort)
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined)
    throw new LlmError('toolarge', `response of ${declared} bytes exceeds ${maxBytes}-byte cap`)
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new LlmError('toolarge', `response exceeded ${maxBytes}-byte cap`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
