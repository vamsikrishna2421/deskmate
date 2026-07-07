/** Provider router — the one LLM client the rest of main talks to. Delegates every call to
 *  the active provider (Settings → Assistant): OllamaClient (local, default) or OpenAiClient
 *  (remote, opt-in). Status listeners only hear the ACTIVE provider, so the tray/settings
 *  health row never flickers with the inactive one's state. */

import type { AssistantProvider } from '@shared/types/appState'
import type { ChatOptions, OllamaClient, OllamaClientStatus } from './ollamaClient'
import type { OpenAiClient } from './openaiClient'

/** The structural surface EnrichmentPipeline and the IPC layer depend on.
 *  OllamaClient, OpenAiClient, and LlmRouter all satisfy it. */
export interface LlmClient {
  health(): Promise<boolean>
  listModels(): Promise<string[]>
  pickModel(): Promise<string | undefined>
  chat(opts: ChatOptions): Promise<string>
  status(): OllamaClientStatus
  onStatusChange(cb: (s: OllamaClientStatus) => void): () => void
}

export class LlmRouter implements LlmClient {
  private readonly ollama: OllamaClient
  private readonly openai: OpenAiClient
  private readonly getProvider: () => AssistantProvider
  private readonly listeners = new Set<(s: OllamaClientStatus) => void>()

  constructor(ollama: OllamaClient, openai: OpenAiClient, getProvider: () => AssistantProvider) {
    this.ollama = ollama
    this.openai = openai
    this.getProvider = getProvider
    ollama.onStatusChange((s) => {
      if (this.getProvider() === 'ollama') this.emit(s)
    })
    openai.onStatusChange((s) => {
      if (this.getProvider() === 'openai') this.emit(s)
    })
  }

  provider(): AssistantProvider {
    return this.getProvider()
  }

  health(): Promise<boolean> {
    return this.active().health()
  }

  listModels(): Promise<string[]> {
    return this.active().listModels()
  }

  pickModel(): Promise<string | undefined> {
    return this.active().pickModel()
  }

  chat(opts: ChatOptions): Promise<string> {
    return this.active().chat(opts)
  }

  status(): OllamaClientStatus {
    return this.active().status()
  }

  onStatusChange(cb: (s: OllamaClientStatus) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Call after the provider setting flips: re-checks the new brain and tells listeners
   *  even if its cached status happens to equal the old one's. */
  providerChanged(): void {
    this.emit(this.status())
    void this.health()
  }

  private active(): OllamaClient | OpenAiClient {
    return this.getProvider() === 'openai' ? this.openai : this.ollama
  }

  private emit(s: OllamaClientStatus): void {
    for (const cb of this.listeners) cb(s)
  }
}
