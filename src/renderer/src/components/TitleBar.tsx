/** DESIGN §3 header (40px drag region): glyph · view title · `+` capture, pin, `···`,
 *  minimize, close. Double-click background → shade. When shaded, only glyph + ticker. */

import { useEffect, useRef, useState } from 'react'
import '../styles/components.css'
import type { TitleBarMenuAction, TitleBarProps } from './props'

const MENU_ITEMS: ReadonlyArray<{ action: TitleBarMenuAction; label: string }> = [
  { action: 'guide', label: 'How to use DeskMate' },
  { action: 'tour', label: 'Welcome tour' },
  { action: 'legend', label: 'Legend' },
  { action: 'settings', label: 'Settings' },
  { action: 'briefing', label: 'Morning briefing' },
  { action: 'pauseAssistant', label: 'Pause assistant' },
  { action: 'moveWindow', label: 'Move window' },
  { action: 'quit', label: 'Quit' }
]

function BrandGlyph({ workingCount, shaded }: { workingCount: number; shaded: boolean }): React.JSX.Element {
  // DESIGN §5 microcopy; the pulse suspends while shaded (§3: animations suspended — the
  // ambient dot alone measured 13x idle CPU).
  const working = workingCount > 0
  const label = working ? `Organizing ${workingCount} ${workingCount === 1 ? 'task' : 'tasks'}…` : 'DeskMate'
  return (
    <span className="titlebar__glyph" title={label} aria-label={label}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="3" width="14" height="14" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="5.5" y1="12.5" x2="14.5" y2="12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {working && !shaded && <span className="titlebar__working dot--pulse pulse" aria-hidden="true" />}
    </span>
  )
}

export function TitleBar(props: TitleBarProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector('button')?.focus()
  }, [menuOpen])

  const onHeaderDoubleClick = (e: React.MouseEvent): void => {
    if (e.target instanceof HTMLElement && e.target.closest('button')) return
    props.onToggleShade()
  }

  const pick = (action: TitleBarMenuAction): void => {
    setMenuOpen(false)
    props.onMenu(action)
  }

  const onMenuKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setMenuOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = Array.from(menuRef.current?.querySelectorAll('button') ?? [])
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
      items[next]?.focus()
    }
  }

  if (props.shaded) {
    return (
      <header className="titlebar titlebar--shaded drag" onDoubleClick={onHeaderDoubleClick}>
        <BrandGlyph workingCount={props.assistantWorkingCount} shaded />
        {props.ticker && (
          <span className="titlebar__ticker" aria-label="Day summary">
            Today {props.ticker.todayCount}
            {props.ticker.loopsCount > 0 && <> · ◌{props.ticker.loopsCount}</>}
            {props.ticker.nextHard && (
              <>
                {' '}
                · <span className="titlebar__ticker-dot" aria-hidden="true">●</span>{' '}
                {props.ticker.nextHard.timeLabel} {props.ticker.nextHard.title}
              </>
            )}
          </span>
        )}
        {/* With no hard deadline the 48px band held two words — the date fills the void. */}
        {props.ticker && !props.ticker.nextHard && (
          <span className="titlebar__tickerdate" aria-hidden="true">
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        )}
      </header>
    )
  }

  return (
    <header className="titlebar drag" onDoubleClick={onHeaderDoubleClick}>
      <BrandGlyph workingCount={props.assistantWorkingCount} shaded={false} />
      {/* The tab row already says where you are — this slot carries the brand at rest and
          the one calm, always-true working signal while the assistant reads (UX: the wait
          must be legible somewhere the eye already is, not buried on a bottom card). */}
      {props.assistantWorkingCount > 0 ? (
        <span className="titlebar__title titlebar__title--working" aria-live="polite">
          Organizing {props.assistantWorkingCount}…
        </span>
      ) : (
        <span className="titlebar__title titlebar__title--brand">DeskMate</span>
      )}
      <div className="titlebar__controls no-drag">
        <button type="button" className="titlebar__btn" aria-label="Quick capture" title="Quick capture (N)" onClick={props.onCapture}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar__btn"
          aria-label="How to use DeskMate"
          title="How to use DeskMate (F1)"
          onClick={() => props.onMenu('guide')}
        >
          ?
        </button>
        <button
          type="button"
          className={`titlebar__btn${props.pinned ? ' titlebar__btn--active' : ''}`}
          aria-label="Stay on top"
          aria-pressed={props.pinned}
          title="Stay on top"
          onClick={props.onTogglePin}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M7.5 1.5l3 3-2.2.7-2 2L6 10.5 3.6 8.1 1.5 10.2M3.6 8.1l1.7-2 .7-2.2z"
              fill={props.pinned ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="titlebar__menuwrap">
          <button
            type="button"
            className="titlebar__btn"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="More"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ···
          </button>
          {menuOpen && (
            <>
              <div className="titlebar__backdrop" onClick={() => setMenuOpen(false)} />
              <div className="titlebar__menu" role="menu" ref={menuRef} onKeyDown={onMenuKeyDown}>
                {MENU_ITEMS.map((item) => {
                  const action: TitleBarMenuAction =
                    item.action === 'pauseAssistant' && props.assistantPaused
                      ? 'resumeAssistant'
                      : item.action
                  const label =
                    item.action === 'pauseAssistant' && props.assistantPaused
                      ? 'Resume assistant'
                      : item.label
                  return (
                    <button key={item.action} type="button" role="menuitem" onClick={() => pick(action)}>
                      {label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
        <button type="button" className="titlebar__btn" aria-label="Minimize" title="Minimize" onClick={props.onMinimize}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 8.5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="titlebar__btn" aria-label="Hide to tray" title="Hide to tray" onClick={props.onHide}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  )
}
