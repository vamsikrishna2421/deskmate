/** Snippets vault over snippets.json. Secrets are encrypted at rest with Electron safeStorage
 *  (DPAPI on Windows — bound to the OS user account) and their plaintext never leaves the main
 *  process except into the clipboard, which auto-clears. This is a convenience vault for wifi
 *  codes and internal tool logins — NOT a substitute for a real password manager. */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { clipboard, safeStorage } from 'electron'
import type { Snippet, SnippetKind, SnippetPatch } from '../../shared/types/snippet'
import { SECRET_CLIPBOARD_CLEAR_SECONDS } from '../../shared/types/snippet'
import { SCHEMA_VERSION } from '../../shared/constants'
import { JsonStore } from './jsonStore'
import { backupDirFor } from './backup'

const LABEL_MAX = 80
const VALUE_MAX = 8000
const KINDS: readonly SnippetKind[] = ['command', 'url', 'note', 'secret']

/** On-disk shape: secrets hold DPAPI ciphertext (base64) in `cipher`, never `value`. */
interface StoredSnippet extends Omit<Snippet, 'value'> {
  value?: string
  cipher?: string
}

interface SnippetsDoc {
  schemaVersion: number
  snippets: StoredSnippet[]
}

function iso(d: Date): string {
  return d.toISOString()
}

export class SnippetsRepo {
  private readonly store: JsonStore<SnippetsDoc>
  private readonly items = new Map<string, StoredSnippet>()
  private readonly listeners = new Set<(list: Snippet[]) => void>()
  private clearTimer: ReturnType<typeof setTimeout> | undefined

  private constructor(store: JsonStore<SnippetsDoc>, items: StoredSnippet[]) {
    this.store = store
    for (const s of items) {
      if (s && typeof s.id === 'string' && typeof s.label === 'string' && KINDS.includes(s.kind)) {
        this.items.set(s.id, s)
      }
    }
  }

  static async load(dataDir: string): Promise<SnippetsRepo> {
    const store = new JsonStore<SnippetsDoc>(
      join(dataDir, 'snippets.json'),
      { schemaVersion: SCHEMA_VERSION, snippets: [] },
      { backupDir: backupDirFor(dataDir) }
    )
    const doc = await store.load()
    return new SnippetsRepo(store, Array.isArray(doc.snippets) ? doc.snippets : [])
  }

  onChange(cb: (list: Snippet[]) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Renderer-safe list: pinned first, then most recently copied; secret values blanked. */
  list(): Snippet[] {
    const toPublic = (s: StoredSnippet): Snippet => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      value: s.kind === 'secret' ? '' : (s.value ?? ''),
      pinned: s.pinned === true,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastCopiedAt: s.lastCopiedAt
    })
    return [...this.items.values()].map(toPublic).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return (b.lastCopiedAt ?? b.createdAt).localeCompare(a.lastCopiedAt ?? a.createdAt)
    })
  }

  create(kind: SnippetKind, label: string, value: string, now: Date): Snippet {
    const cleanLabel = label.trim().slice(0, LABEL_MAX)
    const cleanValue = value.slice(0, VALUE_MAX)
    if (!cleanLabel) throw new Error('label cannot be empty')
    if (!cleanValue.trim()) throw new Error('value cannot be empty')
    if (kind === 'url') this.assertHttpUrl(cleanValue.trim())
    const nowIso = iso(now)
    const stored: StoredSnippet = {
      id: randomUUID(),
      kind,
      label: cleanLabel,
      pinned: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      ...this.encodeValue(kind, cleanValue)
    }
    this.items.set(stored.id, stored)
    this.commit()
    return this.publicOf(stored.id)
  }

  update(id: string, patch: SnippetPatch, now: Date): Snippet {
    const cur = this.items.get(id)
    if (!cur) throw new Error(`snippet ${id} not found`)
    const next: StoredSnippet = { ...cur }
    if (patch.kind !== undefined && KINDS.includes(patch.kind)) next.kind = patch.kind
    if (patch.label !== undefined) {
      const label = patch.label.trim().slice(0, LABEL_MAX)
      if (!label) throw new Error('label cannot be empty')
      next.label = label
    }
    // Kind changes without a fresh value re-encode the existing plaintext.
    const kindChanged = next.kind !== cur.kind
    if (patch.value !== undefined) {
      const value = patch.value.slice(0, VALUE_MAX)
      if (!value.trim()) throw new Error('value cannot be empty')
      if (next.kind === 'url') this.assertHttpUrl(value.trim())
      Object.assign(next, { value: undefined, cipher: undefined }, this.encodeValue(next.kind, value))
    } else if (kindChanged) {
      const plain = this.decodeValue(cur)
      if (next.kind === 'url') this.assertHttpUrl(plain.trim())
      Object.assign(next, { value: undefined, cipher: undefined }, this.encodeValue(next.kind, plain))
    }
    if (patch.pinned !== undefined) next.pinned = patch.pinned
    next.updatedAt = iso(now)
    this.items.set(id, next)
    this.commit()
    return this.publicOf(id)
  }

  delete(id: string): void {
    if (this.items.delete(id)) this.commit()
  }

  /** Copy to clipboard via main. Secrets schedule an auto-clear (only wipes if untouched). */
  copy(id: string, now: Date): { clearAfterSeconds: number | null } {
    const cur = this.items.get(id)
    if (!cur) throw new Error(`snippet ${id} not found`)
    const plain = this.decodeValue(cur)
    clipboard.writeText(plain)
    this.items.set(id, { ...cur, lastCopiedAt: iso(now) })
    this.commit()
    if (cur.kind !== 'secret') return { clearAfterSeconds: null }
    if (this.clearTimer) clearTimeout(this.clearTimer)
    this.clearTimer = setTimeout(() => {
      if (clipboard.readText() === plain) clipboard.clear()
    }, SECRET_CLIPBOARD_CLEAR_SECONDS * 1000)
    return { clearAfterSeconds: SECRET_CLIPBOARD_CLEAR_SECONDS }
  }

  /** The stored URL for kind 'url' (validated at write time; re-validated by the caller). */
  urlOf(id: string): string {
    const cur = this.items.get(id)
    if (!cur || cur.kind !== 'url') throw new Error('not a url snippet')
    const url = this.decodeValue(cur).trim()
    this.assertHttpUrl(url)
    return url
  }

  flush(): Promise<void> {
    return this.store.flush()
  }

  private publicOf(id: string): Snippet {
    const found = this.list().find((s) => s.id === id)
    if (!found) throw new Error(`snippet ${id} not found`)
    return found
  }

  private encodeValue(kind: SnippetKind, plain: string): Pick<StoredSnippet, 'value' | 'cipher'> {
    if (kind !== 'secret') return { value: plain }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('secure storage is unavailable on this machine — secrets cannot be saved')
    }
    return { cipher: safeStorage.encryptString(plain).toString('base64') }
  }

  private decodeValue(s: StoredSnippet): string {
    if (s.kind !== 'secret') return s.value ?? ''
    if (!s.cipher) return ''
    return safeStorage.decryptString(Buffer.from(s.cipher, 'base64'))
  }

  private assertHttpUrl(raw: string): void {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new Error('link must be a valid URL')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('link must be http(s)')
    }
  }

  private commit(): void {
    this.store.save({ schemaVersion: SCHEMA_VERSION, snippets: [...this.items.values()] })
    const list = this.list()
    for (const cb of this.listeners) cb(list)
  }
}
