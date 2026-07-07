/** "My week, on a card" — a locally rendered, shareable PNG of the user's own week
 *  (identity, not branding: their wins, their busiest day, who they unblocked). Drawn on a
 *  canvas in DeskMate's paper/charcoal language; Copy puts a real image on the clipboard,
 *  ready to paste into Teams or WhatsApp. Nothing leaves the machine until the user pastes. */

import { useEffect, useRef, useState } from 'react'
import type { Task } from '@shared/types/task'
import { computeWeekStats } from '@shared/weekCard'
import { useApi } from '../state/store'

const W = 1080
const H = 1350

interface Palette {
  canvas: string
  surface: string
  ink1: string
  ink2: string
  ink3: string
  accent: string
  accentTint: string
}

const LIGHT: Palette = {
  canvas: '#F6F4F0', surface: '#FFFFFF', ink1: '#262320', ink2: '#6B665E',
  ink3: '#A39D92', accent: '#2F6D5F', accentTint: '#E4EFEA'
}
const DARK: Palette = {
  canvas: '#161514', surface: '#232220', ink1: '#EDEAE4', ink2: '#A5A099',
  ink3: '#6E6A64', accent: '#83C4B0', accentTint: '#223B34'
}

function headline(done: number): string {
  if (done === 0) return 'A quiet week.'
  if (done < 5) return 'A steady week.'
  if (done < 12) return 'A good week.'
  return 'A big week.'
}

function drawCard(ctx: CanvasRenderingContext2D, tasks: Task[], now: Date, dark: boolean): void {
  const p = dark ? DARK : LIGHT
  const s = computeWeekStats(tasks, now)
  const serif = '"Newsreader Variable", Georgia, serif'
  const sans = '"Inter Variable", "Segoe UI", sans-serif'

  ctx.fillStyle = p.canvas
  ctx.fillRect(0, 0, W, H)

  // dateline
  const start = new Date(`${s.weekOf}T00:00:00`)
  const dateline = `WEEK OF ${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toUpperCase()}`
  ctx.fillStyle = p.ink3
  ctx.font = `500 34px ${sans}`
  ctx.fillText(dateline, 96, 150)

  // serif headline
  ctx.fillStyle = p.ink1
  ctx.font = `500 120px ${serif}`
  ctx.fillText(headline(s.doneCount), 90, 290)
  ctx.fillStyle = p.accent
  ctx.fillRect(96, 330, 120, 5)

  // hero number
  ctx.fillStyle = p.ink1
  ctx.font = `600 300px ${sans}`
  ctx.fillText(String(s.doneCount), 90, 690)
  const numW = ctx.measureText(String(s.doneCount)).width
  ctx.fillStyle = p.ink2
  ctx.font = `400 52px ${sans}`
  ctx.fillText(s.doneCount === 1 ? 'thing finished' : 'things finished', 110 + numW, 685)

  // stat lines
  const lines: string[] = []
  if (s.hardDeadlinesHit > 0) lines.push(`●  ${s.hardDeadlinesHit} hard deadline${s.hardDeadlinesHit === 1 ? '' : 's'} hit`)
  if (s.focusedMinutes >= 60) lines.push(`◔  about ${Math.round(s.focusedMinutes / 30) / 2} hours of focused work`)
  if (s.peopleHelped.length > 0) lines.push(`→  unblocked ${s.peopleHelped.join(', ')}`)
  if (s.organizedByAssistant > 0) lines.push(`✦  ${s.organizedByAssistant} organized by the assistant`)
  if (s.questionsAnswered > 0) lines.push(`◌  ${s.questionsAnswered} question${s.questionsAnswered === 1 ? '' : 's'} settled`)
  if (lines.length === 0) lines.push('A clear desk is also an achievement.')
  ctx.font = `400 46px ${sans}`
  lines.slice(0, 4).forEach((line, i) => {
    ctx.fillStyle = i === 0 ? p.ink1 : p.ink2
    ctx.fillText(line, 100, 810 + i * 84)
  })

  // Mon–Sun bars
  const chartY = 1165
  const barMax = Math.max(...s.byDay, 1)
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  for (let i = 0; i < 7; i++) {
    const x = 100 + i * 92
    const h = s.byDay[i] === 0 ? 6 : 24 + (s.byDay[i] / barMax) * 96
    ctx.fillStyle = s.byDay[i] === barMax && barMax > 0 ? p.accent : p.accentTint
    ctx.beginPath()
    ctx.roundRect(x, chartY - h, 56, h, 8)
    ctx.fill()
    ctx.fillStyle = p.ink3
    ctx.font = `500 30px ${sans}`
    ctx.fillText(dayLabels[i], x + 18, chartY + 44)
  }
  if (s.busiestDay) {
    ctx.fillStyle = p.ink2
    ctx.font = `italic 400 40px ${serif}`
    ctx.fillText(`${s.busiestDay} carried the week.`, 100, chartY - 160)
  }

  // wordmark footer
  ctx.strokeStyle = p.ink3
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect(96, H - 108, 46, 46, 12)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(108, H - 76)
  ctx.lineTo(130, H - 76)
  ctx.stroke()
  ctx.fillStyle = p.ink3
  ctx.font = `500 36px ${sans}`
  ctx.fillText('DeskMate', 160, H - 72)
}

export function WeekCardSheet(props: { tasks: Task[]; dark: boolean; onClose: () => void }): React.JSX.Element {
  const api = useApi()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    // Fonts may still be loading on first open — draw now, redraw when they settle.
    drawCard(ctx, props.tasks, new Date(), props.dark)
    void document.fonts.ready.then(() => {
      const c = canvasRef.current?.getContext('2d')
      if (c) drawCard(c, props.tasks, new Date(), props.dark)
    })
  }, [props.tasks, props.dark])

  const copy = (): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    setError(false)
    void api
      .invoke('week:copyCard', { dataUrl: canvas.toDataURL('image/png') })
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => setError(true))
  }

  return (
    <div className="weekcard sheetbody" aria-label="My week, on a card">
      <header className="sheetbody__head">
        <h2>My week, on a card</h2>
        <button type="button" className="sheetbody__close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </header>
      <canvas ref={canvasRef} width={W} height={H} className="weekcard__canvas" aria-label="Week summary card" />
      <div className="weekcard__actions">
        <button type="button" className="primary" onClick={copy}>
          {copied ? 'Copied ✓ — paste it anywhere' : 'Copy as image'}
        </button>
      </div>
      {error && <p className="weekcard__note">couldn&apos;t copy that one — try again</p>}
      <p className="weekcard__note">Made from your week, on your machine. Share it if you feel like it.</p>
    </div>
  )
}
