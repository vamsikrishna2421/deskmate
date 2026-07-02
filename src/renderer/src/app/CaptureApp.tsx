/** Quick-capture window (DESIGN §4): paste → captured in <3s, zero required decisions.
 *  Local pre-hint parsing only (regex, no LLM); pre-hints lock fields as user-owned.
 *  Self-contained: talks to main via capture:submit / capture:dismiss + capture:submitted push. */

import { useEffect, useRef, useState } from 'react'
import type { CaptureHints } from '@shared/types/enrichment'
import { TAGS_MAX } from '@shared/constants'
import { invoke, on } from '../lib/api'
import '../styles/capture.css'

const BANG_RE = /(?:^|\s)!(today|week|later|hard|soft)\b/gi
const TAG_RE = /(?:^|\s)#([a-z0-9][\w-]*)/gi

type ChipState = 'none' | 'today' | 'week' | 'later'
const CHIP_CYCLE: ChipState[] = ['none', 'today', 'week', 'later']
const CHIP_LABEL: Record<Exclude<ChipState, 'none'>, string> = {
  today: 'Today',
  week: 'This week',
  later: 'Later'
}

interface Submission {
  text: string
  hints?: CaptureHints
}

/** Bang tokens are app syntax — stripped from the stored text. #tags stay (they read as prose). */
function buildSubmission(raw: string, chip: ChipState): Submission {
  let deadline: CaptureHints['deadline']
  let kind: CaptureHints['kind']
  for (const m of raw.matchAll(BANG_RE)) {
    const token = m[1].toLowerCase()
    if (token === 'hard' || token === 'soft') kind = token
    else deadline = token as 'today' | 'week' | 'later'
  }
  if (chip !== 'none') deadline = chip // the visible chip wins over typed tokens

  const tags: string[] = []
  for (const m of raw.matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase()
    if (!tags.includes(tag) && tags.length < TAGS_MAX) tags.push(tag)
  }

  const text = raw.replace(BANG_RE, ' ').replace(/[ \t]{2,}/g, ' ').trim()
  const hints: CaptureHints = {}
  if (deadline) hints.deadline = deadline
  if (kind) hints.kind = kind
  if (tags.length) hints.tags = tags
  return { text, hints: Object.keys(hints).length ? hints : undefined }
}

export default function CaptureApp(): React.JSX.Element {
  const [text, setText] = useState('')
  const [context, setContext] = useState('')
  const [pasted, setPasted] = useState(false)
  const [chip, setChip] = useState<ChipState>('none')
  const [saved, setSaved] = useState(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const savedTimer = useRef<number | undefined>(undefined)
  const grownRef = useRef(false)

  // DESIGN §3: main grows the window 180→300 once the text exceeds ~4 lines. One-way per summon.
  useEffect(() => {
    if (grownRef.current) return
    const lines = text.split('\n').length + Math.floor(text.length / 60)
    if (lines > 4) {
      grownRef.current = true
      void invoke('capture:resize', { grown: true }).catch(() => undefined)
    }
    if (text === '') grownRef.current = false // field cleared (Ctrl+Enter keep-open / reopen)
  }, [text])

  useEffect(() => {
    fieldRef.current?.focus()
  }, [])

  // Ctrl+Enter inline confirmation: 'Saved ✓' for 600ms on the capture:submitted push.
  useEffect(() => {
    let unsub: (() => void) | undefined
    let unsubPrefill: (() => void) | undefined
    try {
      unsub = on('capture:submitted', () => {
        setSaved(true)
        window.clearTimeout(savedTimer.current)
        savedTimer.current = window.setTimeout(() => setSaved(false), 600)
      })
      // Hotkey summon read the clipboard (that moment only) — offer it, fully selected so
      // typing replaces it instantly and Enter accepts it as-is.
      unsubPrefill = on('capture:prefill', (p) => {
        setText((cur) => {
          if (cur.trim()) return cur // never clobber something already typed
          setPasted(true)
          requestAnimationFrame(() => fieldRef.current?.select())
          return p.text
        })
      })
    } catch (err) {
      console.error(err)
    }
    return () => {
      unsub?.()
      unsubPrefill?.()
      window.clearTimeout(savedTimer.current)
    }
  }, [])

  // Window is hidden by main after submit/dismiss — start clean on the next summon.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        setText('')
        setContext('')
        setPasted(false)
        setChip('none')
        setSaved(false)
      } else {
        fieldRef.current?.focus()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const submit = (keepOpen: boolean): void => {
    // Extra context rides along labeled, so the assistant weighs it WITH the pasted message.
    const note = context.trim()
    const combined = note ? `${text}\n\nAdditional context from me: ${note}` : text
    const { text: cleaned, hints } = buildSubmission(combined, chip)
    if (!cleaned) return
    void invoke('capture:submit', {
      text: cleaned,
      sourceKind: pasted ? 'paste' : 'typed',
      hints,
      keepOpen
    })
    if (keepOpen) {
      setText('')
      setContext('')
      setPasted(false)
      setChip('none')
      fieldRef.current?.focus()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Tab') {
      e.preventDefault()
      setChip((c) => CHIP_CYCLE[(CHIP_CYCLE.indexOf(c) + 1) % CHIP_CYCLE.length])
      return
    }
    if (e.key === 'Enter') {
      if (e.shiftKey) return // newline
      e.preventDefault()
      submit(e.ctrlKey || e.metaKey)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      void invoke('capture:dismiss', undefined)
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setText(e.target.value)
    if (e.target.value === '') setPasted(false)
  }

  const willSummarize = text.length > 140 || text.includes('\n')

  return (
    <div className="cap-shell">
      {(willSummarize || chip !== 'none') && (
        <div className="cap-chips">
          {willSummarize && <span className="cap-chip">message — will be summarized</span>}
          {chip !== 'none' && <span className="cap-chip cap-chip-deadline">{CHIP_LABEL[chip]}</span>}
        </div>
      )}
      <textarea
        ref={fieldRef}
        className="cap-field"
        placeholder="Paste a message or jot a task…"
        aria-label="Capture a task"
        value={text}
        onChange={onChange}
        onPaste={() => setPasted(true)}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      {pasted && text.trim().length > 0 && (
        <input
          type="text"
          className="cap-context"
          placeholder="Add context — deadline, who it's for, details… (optional)"
          aria-label="Additional context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit(e.ctrlKey || e.metaKey)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              void invoke('capture:dismiss', undefined)
            }
          }}
          spellCheck={false}
        />
      )}
      <div className="cap-hints" aria-hidden="true">
        {saved ? (
          <span className="cap-saved">Saved ✓</span>
        ) : (
          <span>
            Enter to capture · Shift+Enter new line · Ctrl+Enter capture &amp; keep open · Esc to
            cancel
          </span>
        )}
      </div>
    </div>
  )
}

