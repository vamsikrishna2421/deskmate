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

/** Poster palette — the CARD is a poster, not the app: it competes in a Teams channel.
 *  Bolder than the in-app tokens on purpose; still DeskMate's family of hues. */
interface Palette {
  bgTop: string
  bgBottom: string
  glow: string
  ink1: string
  ink2: string
  accent: string
  accentDeep: string
  ochre: string
  violet: string
  pill: string
  grain: string
}

const DARK: Palette = {
  bgTop: '#0E1F1A', bgBottom: '#141312', glow: 'rgba(131,196,176,0.32)',
  ink1: '#F4F1EA', ink2: '#B9B3A8', accent: '#8FDCC2', accentDeep: '#3E8A72',
  ochre: '#E8B86A', violet: '#C2A9F0', pill: 'rgba(255,255,255,0.06)', grain: 'rgba(255,255,255,0.02)'
}
const LIGHT: Palette = {
  bgTop: '#F2EFE8', bgBottom: '#E4EFEA', glow: 'rgba(47,109,95,0.18)',
  ink1: '#20302B', ink2: '#5E6B64', accent: '#2F6D5F', accentDeep: '#1F4D42',
  ochre: '#9A6B14', violet: '#6E5AA0', pill: 'rgba(47,109,95,0.08)', grain: 'rgba(38,35,32,0.02)'
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

  // ── background: deep vertical gradient + two soft glows + grain ──
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, p.bgTop)
  bg.addColorStop(1, p.bgBottom)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow1 = ctx.createRadialGradient(W - 120, 180, 0, W - 120, 180, 620)
  glow1.addColorStop(0, p.glow)
  glow1.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow1
  ctx.fillRect(0, 0, W, H)
  const glow2 = ctx.createRadialGradient(80, H - 200, 0, 80, H - 200, 520)
  glow2.addColorStop(0, dark ? 'rgba(194,169,240,0.10)' : 'rgba(110,90,160,0.08)')
  glow2.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow2
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = p.grain
  for (let i = 0; i < 2600; i++) {
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2)
  }

  // ── constellation of DeskMate marks, upper right ──
  const stars: Array<[number, number, number, string]> = [
    [880, 300, 34, p.accent], [975, 420, 22, p.violet], [800, 470, 18, p.ink2],
    [940, 560, 26, p.ochre], [860, 640, 16, p.accent]
  ]
  for (const [x, y, size, color] of stars) {
    ctx.fillStyle = color
    ctx.globalAlpha = 0.85
    ctx.font = `400 ${size * 2}px ${sans}`
    ctx.fillText('✦', x, y)
  }
  ctx.globalAlpha = 1

  // ── dateline in a hairline pill ──
  const start = new Date(`${s.weekOf}T00:00:00`)
  const dateline = `WEEK OF ${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toUpperCase()}`
  ctx.font = `600 30px ${sans}`
  const dlW = ctx.measureText(dateline).width
  ctx.strokeStyle = p.accentDeep
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.roundRect(90, 96, dlW + 56, 66, 999)
  ctx.stroke()
  ctx.fillStyle = p.accent
  ctx.fillText(dateline, 118, 140)

  // ── serif headline, big ──
  ctx.fillStyle = p.ink1
  ctx.font = `500 132px ${serif}`
  ctx.fillText(headline(s.doneCount), 84, 320)

  // ── hero number with glow + accent, baseline-aligned label ──
  ctx.save()
  ctx.shadowColor = p.glow
  ctx.shadowBlur = 90
  ctx.fillStyle = p.accent
  ctx.font = `650 400px ${sans}`
  ctx.fillText(String(s.doneCount), 76, 740)
  ctx.restore()
  const numW = ctx.measureText(String(s.doneCount)).width
  ctx.fillStyle = p.ink1
  ctx.font = `500 56px ${sans}`
  ctx.fillText('things', 150 + numW, 660)
  ctx.fillText('finished', 150 + numW, 730)

  // ── stat pills: tinted rounded rows, glyphs in their semantic colors ──
  interface Pill { glyph: string; glyphColor: string; text: string }
  const pills: Pill[] = []
  if (s.hardDeadlinesHit > 0)
    pills.push({ glyph: '●', glyphColor: p.ochre, text: `${s.hardDeadlinesHit} hard deadline${s.hardDeadlinesHit === 1 ? '' : 's'} hit` })
  if (s.peopleHelped.length > 0)
    pills.push({ glyph: '→', glyphColor: p.accent, text: `unblocked ${s.peopleHelped.join(', ')}` })
  if (s.focusedMinutes >= 60)
    pills.push({ glyph: '◔', glyphColor: p.violet, text: `${Math.round(s.focusedMinutes / 30) / 2}h of focused work` })
  if (s.questionsAnswered > 0)
    pills.push({ glyph: '◌', glyphColor: p.violet, text: `${s.questionsAnswered} question${s.questionsAnswered === 1 ? '' : 's'} settled` })
  else if (s.organizedByAssistant > 0)
    pills.push({ glyph: '✦', glyphColor: p.accent, text: `${s.organizedByAssistant} organized by the assistant` })
  if (pills.length === 0) pills.push({ glyph: '○', glyphColor: p.accent, text: 'a clear desk is also an achievement' })
  ctx.font = `500 44px ${sans}`
  pills.slice(0, 3).forEach((pill, i) => {
    const y = 788 + i * 98
    const textW = ctx.measureText(pill.text).width
    ctx.fillStyle = p.pill
    ctx.beginPath()
    ctx.roundRect(84, y, textW + 150, 84, 999)
    ctx.fill()
    ctx.fillStyle = pill.glyphColor
    ctx.fillText(pill.glyph, 122, y + 58)
    ctx.fillStyle = p.ink1
    ctx.fillText(pill.text, 196, y + 58)
  })

  // ── Mon–Sun bars: gradient fills, busiest glows, caption above ──
  const chartY = 1218
  const barMax = Math.max(...s.byDay, 1)
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  if (s.busiestDay) {
    // floats right of the (short) weekend bars, mid-chart — clear of pills and tall weekday bars
    ctx.fillStyle = p.ink2
    ctx.font = `italic 400 42px ${serif}`
    const caption = `${s.busiestDay} carried the week.`
    ctx.fillText(caption, W - 96 - ctx.measureText(caption).width, chartY - 60)
  }
  for (let i = 0; i < 7; i++) {
    const x = 90 + i * 90
    const h = s.byDay[i] === 0 ? 8 : 30 + (s.byDay[i] / barMax) * 120
    const grad = ctx.createLinearGradient(0, chartY - h, 0, chartY)
    grad.addColorStop(0, p.accent)
    grad.addColorStop(1, p.accentDeep)
    ctx.save()
    if (s.byDay[i] === barMax && barMax > 0) {
      ctx.shadowColor = p.glow
      ctx.shadowBlur = 40
    }
    ctx.fillStyle = s.byDay[i] === 0 ? p.pill : grad
    ctx.beginPath()
    ctx.roundRect(x, chartY - h, 58, h, 10)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = p.ink2
    ctx.font = `500 30px ${sans}`
    ctx.fillText(dayLabels[i], x + 20, chartY + 46)
  }

  // ── wordmark, bottom right ──
  ctx.strokeStyle = p.ink2
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect(W - 300, H - 106, 44, 44, 12)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(W - 288, H - 76)
  ctx.lineTo(W - 268, H - 76)
  ctx.stroke()
  ctx.fillStyle = p.ink2
  ctx.font = `500 36px ${sans}`
  ctx.fillText('DeskMate', W - 240, H - 72)
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
