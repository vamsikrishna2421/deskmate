/** DESIGN §4.6 inline capture at the top of the current list ('N' / header '+').
 *  Same grammar as the capture window: bang pre-hints + Tab deadline chip lock fields
 *  as user-owned; bang tokens are app syntax and are stripped from the stored text. */

import { useEffect, useRef, useState } from 'react'
import { TAGS_MAX } from '@shared/constants'
import type { CaptureHints } from '@shared/types/enrichment'
import type { CaptureBarProps } from './props'

const BANG_RE = /(?:^|\s)!(today|week|later|hard|soft)\b/gi
const TAG_RE = /(?:^|\s)#([a-z0-9][\w-]*)/gi

type ChipState = 'none' | 'today' | 'week' | 'later'
const CHIP_CYCLE: ChipState[] = ['none', 'today', 'week', 'later']
const CHIP_LABEL: Record<Exclude<ChipState, 'none'>, string> = {
  today: 'Today',
  week: 'This week',
  later: 'Later'
}

function buildHints(raw: string, chip: ChipState): { text: string; hints?: CaptureHints } {
  let deadline: CaptureHints['deadline']
  let kind: CaptureHints['kind']
  for (const m of raw.matchAll(BANG_RE)) {
    const token = m[1].toLowerCase()
    if (token === 'hard' || token === 'soft') kind = token
    else deadline = token as 'today' | 'week' | 'later'
  }
  if (chip !== 'none') deadline = chip
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

export function CaptureBar(props: CaptureBarProps): React.JSX.Element | null {
  const [text, setText] = useState('')
  const [pasted, setPasted] = useState(false)
  const [chip, setChip] = useState<ChipState>('none')
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (props.open) {
      setText('')
      setPasted(false)
      setChip('none')
      fieldRef.current?.focus()
    }
  }, [props.open])

  if (!props.open) return null

  const submit = (keepOpen: boolean): void => {
    const { text: cleaned, hints } = buildHints(text, chip)
    if (!cleaned) return
    props.onSubmit({ sourceText: cleaned, sourceKind: pasted ? 'paste' : 'typed', hints, keepOpen })
    if (keepOpen) {
      setText('')
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(e.ctrlKey || e.metaKey)
    }
  }

  const willSummarize = text.length > 140 || text.includes('\n')

  return (
    <div className="capbar">
      {(willSummarize || chip !== 'none') && (
        <div className="capbar__chips">
          {willSummarize && <span className="capbar__chip">message — will be summarized</span>}
          {chip !== 'none' && (
            <span className="capbar__chip capbar__chip--deadline">{CHIP_LABEL[chip]}</span>
          )}
        </div>
      )}
      <textarea
        ref={fieldRef}
        className="capbar__field"
        rows={text.includes('\n') || text.length > 80 ? 3 : 1}
        placeholder="Paste a message or jot a task…"
        aria-label="Capture a task"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value === '') setPasted(false)
        }}
        onPaste={() => setPasted(true)}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      <div className="capbar__hints" aria-hidden="true">
        Enter to capture · Shift+Enter new line · Ctrl+Enter capture &amp; keep open · Esc to cancel
      </div>
    </div>
  )
}
