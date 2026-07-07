/** The Desk vault: frequently used commands, doc links, notes, and secrets with one-click
 *  copy. Secrets are encrypted at rest (DPAPI) and their plaintext never reaches this window —
 *  copy happens in main and the clipboard auto-clears. Calm contract: no red, no nagging. */

import { useEffect, useRef, useState } from 'react'
import type { Snippet, SnippetKind } from '@shared/types/snippet'
import { deriveSnippet } from '@shared/snippetDerive'
import { useApi } from '../state/store'
import { relativeTime } from '../lib/format'
import '../styles/snippets.css'

const KIND_LABEL: Record<SnippetKind, string> = {
  command: 'cmd',
  url: 'link',
  note: 'note',
  secret: 'secret'
}

const KIND_OPTIONS: ReadonlyArray<{ id: SnippetKind; label: string }> = [
  { id: 'command', label: 'Command' },
  { id: 'url', label: 'Link' },
  { id: 'note', label: 'Note' },
  { id: 'secret', label: 'Secret' }
]

interface FormState {
  editingId: string | null
  kind: SnippetKind
  label: string
  value: string
}

const EMPTY_FORM: FormState = { editingId: null, kind: 'command', label: '', value: '' }

export function SnippetsView(): React.JSX.Element {
  const api = useApi()
  const [snippets, setSnippets] = useState<Snippet[] | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedNote, setCopiedNote] = useState('')
  const copyTimer = useRef<number | undefined>(undefined)
  // Quick add: ONE box + a Secret toggle. Kind and label are derived; only a secret asks
  // for a name (the name is what shows on the desk — the value stays masked).
  const [quick, setQuick] = useState('')
  const [quickSecret, setQuickSecret] = useState(false)
  const [quickName, setQuickName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let disposed = false
    api
      .invoke('snippets:list', undefined)
      .then((list) => {
        if (!disposed) setSnippets(list)
      })
      .catch(() => setSnippets([]))
    const unsub = api.on('snippets:changed', (list) => setSnippets(list))
    return () => {
      disposed = true
      unsub()
      window.clearTimeout(copyTimer.current)
    }
  }, [api])

  const copy = (s: Snippet): void => {
    void api
      .invoke('snippets:copy', { id: s.id })
      .then(({ clearAfterSeconds }) => {
        setCopiedId(s.id)
        setCopiedNote(clearAfterSeconds ? `Copied — clears in ${clearAfterSeconds}s` : 'Copied ✓')
        window.clearTimeout(copyTimer.current)
        copyTimer.current = window.setTimeout(() => setCopiedId(null), 2200)
      })
      .catch(() => setError("couldn't copy that one"))
  }

  const submit = (): void => {
    setError(null)
    const done = (): void => {
      setForm(EMPTY_FORM)
      setFormOpen(false)
    }
    const fail = (err: unknown): void => {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.replace(/^.*deskmate ipc: /, '').replace(/^Error invoking remote method .*?: /, ''))
    }
    if (form.editingId) {
      void api
        .invoke('snippets:update', {
          id: form.editingId,
          patch: { kind: form.kind, label: form.label, value: form.value }
        })
        .then(done)
        .catch(fail)
    } else {
      void api
        .invoke('snippets:create', { kind: form.kind, label: form.label, value: form.value })
        .then(done)
        .catch(fail)
    }
  }

  const startEdit = (s: Snippet): void => {
    setError(null)
    setFormOpen(true)
    // Secrets never round-trip: editing one means typing a fresh value.
    setForm({ editingId: s.id, kind: s.kind, label: s.label, value: s.kind === 'secret' ? '' : s.value })
  }

  const quickAdd = (): void => {
    setError(null)
    const value = quickSecret ? quick : quick.trim()
    if (!value) return
    let kind: SnippetKind
    let label: string
    if (quickSecret) {
      label = quickName.trim()
      if (!label) {
        setError('Give it a name — the name is what appears on the desk.')
        nameRef.current?.focus()
        return
      }
      kind = 'secret'
    } else {
      const derived = deriveSnippet(value)
      kind = derived.kind
      label = derived.label
    }
    void api
      .invoke('snippets:create', { kind, label, value })
      .then(() => {
        setQuick('')
        setQuickName('')
        setQuickSecret(false)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg.replace(/^.*deskmate ipc: /, '').replace(/^Error invoking remote method .*?: /, ''))
      })
  }

  const onQuickKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      quickAdd()
    }
  }

  const preview = (s: Snippet): string => {
    if (s.kind === 'secret') return '••••••••'
    const oneLine = s.value.replace(/\s+/g, ' ').trim()
    return oneLine.length > 64 ? `${oneLine.slice(0, 64)}…` : oneLine
  }

  if (snippets === null) return <div className="snips" aria-busy="true" />

  return (
    <div className="snips" role="region" aria-label="Desk snippets">
      {!formOpen && (
        <div className="snips__quick">
          <div className="snips__quickrow">
            {quickSecret ? (
              <input
                type="password"
                className="snips__quickfield"
                placeholder="Paste the secret…"
                aria-label="Secret value"
                autoComplete="off"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                onKeyDown={onQuickKeyDown}
              />
            ) : (
              <textarea
                className="snips__quickfield"
                rows={quick.includes('\n') || quick.length > 80 ? 3 : 1}
                placeholder="Paste anything — a command, a link, a note…"
                aria-label="Add to the desk"
                spellCheck={false}
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                onKeyDown={onQuickKeyDown}
              />
            )}
            <button
              type="button"
              className={`snips__secrettoggle${quickSecret ? ' snips__secrettoggle--on' : ''}`}
              aria-pressed={quickSecret}
              title={quickSecret ? 'This is a secret — value stays masked' : 'Mark as a secret'}
              onClick={() => {
                setQuickSecret((v) => {
                  const on = !v
                  if (on) window.setTimeout(() => nameRef.current?.focus(), 50)
                  return on
                })
              }}
            >
              Secret
            </button>
          </div>
          {quickSecret && (
            <input
              ref={nameRef}
              type="text"
              className="snips__quickname"
              placeholder="Name it — e.g. Gmail password"
              aria-label="Secret name"
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
              onKeyDown={onQuickKeyDown}
            />
          )}
          {quickSecret && (
            <p className="snips__hint">
              Only the name shows on the desk. Encrypted on this machine; Copy clears after 30s.
            </p>
          )}
          {!formOpen && error && <p className="snips__error">{error}</p>}
          <div className="snips__quickhint" aria-hidden="true">
            Enter to add · Shift+Enter new line
          </div>
        </div>
      )}
      {formOpen && (
        <form
          className="snips__form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="snips__formrow">
            <select
              className="snips__kind"
              aria-label="Kind"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as SnippetKind }))}
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              className="snips__label"
              placeholder="Label — e.g. Prod DB tunnel"
              aria-label="Label"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          {form.kind === 'secret' ? (
            <input
              type="password"
              className="snips__value"
              placeholder={form.editingId ? 'Type a new secret value…' : 'Secret value…'}
              aria-label="Secret value"
              autoComplete="off"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />
          ) : (
            <textarea
              className="snips__value"
              rows={form.kind === 'note' ? 3 : 1}
              placeholder={form.kind === 'url' ? 'https://…' : 'Value to copy…'}
              aria-label="Value"
              spellCheck={false}
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />
          )}
          {form.kind === 'secret' && (
            <p className="snips__hint">
              Encrypted on this machine (Windows DPAPI). A convenience vault — keep real credentials in a
              password manager.
            </p>
          )}
          {error && <p className="snips__error">{error}</p>}
          <div className="snips__formactions">
            <button type="submit" className="primary">
              Save
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setForm(EMPTY_FORM)
                setFormOpen(false)
                setError(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {snippets.length === 0 && !formOpen ? (
        <p className="list__empty">Nothing on the desk yet.</p>
      ) : (
        <ul className="snips__list" role="list">
          {snippets.map((s) => (
            <li key={s.id} className="snips__row">
              <span className={`snips__kindchip snips__kindchip--${s.kind}`}>{KIND_LABEL[s.kind]}</span>
              <span className="snips__body">
                {s.kind === 'url' ? (
                  <button
                    type="button"
                    className="snips__rowlabel snips__rowlabel--link"
                    title="Open in browser"
                    onClick={() => void api.invoke('snippets:open', { id: s.id })}
                  >
                    {s.label}
                  </button>
                ) : (
                  <span className="snips__rowlabel">{s.label}</span>
                )}
                <span className="snips__preview">{preview(s)}</span>
              </span>
              {copiedId === s.id ? (
                <span className="snips__copied" role="status">
                  {copiedNote}
                </span>
              ) : (
                <button type="button" className="snips__copy" onClick={() => copy(s)}>
                  Copy
                </button>
              )}
              <span className="snips__rowactions">
                <button
                  type="button"
                  className="snips__mini"
                  aria-pressed={s.pinned}
                  title={s.pinned ? 'Unpin' : 'Pin to top'}
                  onClick={() => void api.invoke('snippets:update', { id: s.id, patch: { pinned: !s.pinned } })}
                >
                  {s.pinned ? '★' : '☆'}
                </button>
                <button type="button" className="snips__mini" title="Edit" onClick={() => startEdit(s)}>
                  ✎
                </button>
                <button
                  type="button"
                  className="snips__mini snips__mini--letgo"
                  title="Let go"
                  onClick={() => void api.invoke('snippets:delete', { id: s.id })}
                >
                  ×
                </button>
              </span>
              {s.lastCopiedAt && (
                <span className="snips__stamp">copied {relativeTime(s.lastCopiedAt, new Date())}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="snips__whisper">Copy lands on your clipboard · secrets wipe themselves after 30s.</p>
    </div>
  )
}
