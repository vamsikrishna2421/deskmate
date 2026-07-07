/** OpenAI remote client (src/main/llm/openaiClient.ts): request shaping (strict json_schema,
 *  reasoning params, pinned model), response parsing, error mapping, and the no-key path.
 *  Plus LlmRouter provider delegation. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiClient, toStrictSchema } from '../../src/main/llm/openaiClient'
import { LlmRouter } from '../../src/main/llm/router'
import { OllamaError } from '../../src/main/llm/ollamaClient'
import { OPENAI_MODEL } from '../../src/shared/constants'
import type { AssistantProvider } from '../../src/shared/types/appState'

const CHAT_DEFAULTS = {
  system: 'sys',
  user: 'usr',
  temperature: 0.15,
  numPredict: 800,
  timeoutMs: 5_000
}

function okCompletion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
}

function lastFetchBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls.at(-1)?.[1] as { body: string }
  return JSON.parse(init.body) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toStrictSchema', () => {
  it('closes every object node and requires every property, recursively', () => {
    const strict = toStrictSchema({
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
            required: ['title']
          }
        }
      },
      required: ['tasks']
    }) as Record<string, any>
    expect(strict.additionalProperties).toBe(false)
    expect(strict.required).toEqual(['tasks'])
    const item = strict.properties.tasks.items
    expect(item.additionalProperties).toBe(false)
    expect(item.required).toEqual(['title', 'tags'])
  })

  it('does not mutate the input schema', () => {
    const input = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }
    toStrictSchema(input)
    expect('additionalProperties' in input).toBe(false)
  })
})

describe('OpenAiClient.chat', () => {
  it('sends bearer auth, strict json_schema, reasoning_effort minimal and NO temperature for gpt-5*', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okCompletion('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)
    const client = new OpenAiClient(() => 'sk-test')
    const out = await client.chat({
      ...CHAT_DEFAULTS,
      model: OPENAI_MODEL,
      format: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
    })
    expect(out).toBe('{"ok":true}')
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.authorization).toBe('Bearer sk-test')
    const body = lastFetchBody(fetchMock)
    expect(body.model).toBe(OPENAI_MODEL)
    expect(body.reasoning_effort).toBe('minimal')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_completion_tokens')
    const rf = body.response_format as Record<string, any>
    expect(rf.type).toBe('json_schema')
    expect(rf.json_schema.strict).toBe(true)
    expect(rf.json_schema.schema.additionalProperties).toBe(false)
  })

  it('sends temperature (and no reasoning_effort) for non-reasoning models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okCompletion('hi'))
    vi.stubGlobal('fetch', fetchMock)
    const client = new OpenAiClient(() => 'sk-test')
    await client.chat({ ...CHAT_DEFAULTS, model: 'gpt-4.1-nano' })
    const body = lastFetchBody(fetchMock)
    expect(body.temperature).toBe(0.15)
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('response_format')
  })

  it('throws a network-kind error without calling fetch when no key is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = new OpenAiClient(() => '')
    await expect(client.chat({ ...CHAT_DEFAULTS, model: OPENAI_MODEL })).rejects.toMatchObject({
      kind: 'network'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps API errors to http-kind with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 })
      )
    )
    const client = new OpenAiClient(() => 'sk-bad')
    await expect(client.chat({ ...CHAT_DEFAULTS, model: OPENAI_MODEL })).rejects.toMatchObject({
      kind: 'http',
      status: 401,
      message: expect.stringContaining('Incorrect API key')
    })
  })

  it('maps refusals and connection failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { refusal: 'no' } }] }), { status: 200 })
      )
    )
    const client = new OpenAiClient(() => 'sk-test')
    await expect(client.chat({ ...CHAT_DEFAULTS, model: OPENAI_MODEL })).rejects.toMatchObject({ kind: 'http' })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const client2 = new OpenAiClient(() => 'sk-test')
    await expect(client2.chat({ ...CHAT_DEFAULTS, model: OPENAI_MODEL })).rejects.toMatchObject({
      kind: 'network'
    })
    expect(client2.status().reachable).toBe(false)
    // Both providers throw the same class — the pipeline's instanceof checks must hold.
    await client2.chat({ ...CHAT_DEFAULTS, model: OPENAI_MODEL }).catch((err) => {
      expect(err).toBeInstanceOf(OllamaError)
    })
  })

  it('pins the model list to the single cheapest model', async () => {
    const withKey = new OpenAiClient(() => 'sk-test')
    const without = new OpenAiClient(() => '')
    expect(await withKey.listModels()).toEqual([OPENAI_MODEL])
    expect(await withKey.pickModel()).toBe(OPENAI_MODEL)
    expect(await without.listModels()).toEqual([])
    expect(await without.pickModel()).toBeUndefined()
  })
})

describe('LlmRouter', () => {
  function fakeClient(name: string) {
    const listeners = new Set<(s: unknown) => void>()
    return {
      name,
      health: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([name]),
      pickModel: vi.fn().mockResolvedValue(name),
      chat: vi.fn().mockResolvedValue(name),
      status: vi.fn(() => ({ reachable: true, models: [name], activeModel: name })),
      onStatusChange: (cb: (s: unknown) => void) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      emit: (s: unknown) => listeners.forEach((cb) => cb(s))
    }
  }

  it('delegates to the active provider and follows setting flips', async () => {
    const ollama = fakeClient('qwen2.5:3b')
    const openai = fakeClient(OPENAI_MODEL)
    let provider: AssistantProvider = 'ollama'
    const router = new LlmRouter(ollama as never, openai as never, () => provider)
    expect(await router.pickModel()).toBe('qwen2.5:3b')
    provider = 'openai'
    expect(await router.pickModel()).toBe(OPENAI_MODEL)
    expect(await router.chat({ ...CHAT_DEFAULTS, model: OPENAI_MODEL })).toBe(OPENAI_MODEL)
    expect(ollama.chat).not.toHaveBeenCalled()
  })

  it('only forwards status events from the active provider', () => {
    const ollama = fakeClient('qwen2.5:3b')
    const openai = fakeClient(OPENAI_MODEL)
    let provider: AssistantProvider = 'ollama'
    const router = new LlmRouter(ollama as never, openai as never, () => provider)
    const seen: unknown[] = []
    router.onStatusChange((s) => seen.push(s))
    openai.emit({ reachable: true, models: [], activeModel: undefined })
    expect(seen).toHaveLength(0)
    ollama.emit({ reachable: false, models: [], activeModel: undefined })
    expect(seen).toHaveLength(1)
    provider = 'openai'
    openai.emit({ reachable: true, models: [OPENAI_MODEL], activeModel: OPENAI_MODEL })
    expect(seen).toHaveLength(2)
  })

  it('providerChanged emits the new active status and re-checks health', () => {
    const ollama = fakeClient('qwen2.5:3b')
    const openai = fakeClient(OPENAI_MODEL)
    let provider: AssistantProvider = 'openai'
    const router = new LlmRouter(ollama as never, openai as never, () => provider)
    const seen: Array<{ activeModel?: string }> = []
    router.onStatusChange((s) => seen.push(s))
    router.providerChanged()
    expect(seen[0]?.activeModel).toBe(OPENAI_MODEL)
    expect(openai.health).toHaveBeenCalled()
  })
})
