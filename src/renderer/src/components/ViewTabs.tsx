/** DESIGN §9 tabs: `Today · Week · Later · Done`, 11px superscript counts, 2px accent
 *  underline sliding 200ms, `◌ n` loops chip (only when loops exist), '/' search morph. */

import { useLayoutEffect, useRef, useState } from 'react'
import type { ViewId, ViewTabsProps } from './props'

const TABS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'later', label: 'Later' },
  { id: 'done', label: 'Done' },
  { id: 'snippets', label: 'Desk' }
]

export function ViewTabs(props: ViewTabsProps): React.JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [underline, setUnderline] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    if (props.searchOpen) return
    const row = rowRef.current
    if (!row) return
    const measure = (): void => {
      const active = row.querySelector<HTMLElement>(`[data-view="${props.view}"]`)
      if (!active) return
      setUnderline({ left: active.offsetLeft, width: active.offsetWidth })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    // Observe each tab too: superscript counts change tab WIDTHS without resizing the row,
    // which would otherwise leave the underline drifting off the active tab.
    for (const tab of row.querySelectorAll<HTMLElement>('[data-view]')) ro.observe(tab)
    return () => ro.disconnect()
  }, [props.view, props.searchOpen, props.counts, props.loopsCount])

  useLayoutEffect(() => {
    if (props.searchOpen) inputRef.current?.focus()
  }, [props.searchOpen])

  if (props.searchOpen) {
    return (
      <div className="tabs tabs--search" role="search">
        <input
          ref={inputRef}
          className="tabs__searchfield"
          type="text"
          placeholder="Search tasks…"
          aria-label="Search tasks"
          value={props.searchQuery}
          onChange={(e) => props.onSearchChange(e.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className="tabs__searchclose"
          aria-label="Close search"
          onClick={props.onSearchClose}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div className="tabs" ref={rowRef} role="tablist" aria-label="Views">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          data-view={tab.id}
          aria-selected={props.view === tab.id}
          className={`tabs__tab${props.view === tab.id ? ' tabs__tab--active' : ''}`}
          onClick={() => props.onSelectView(tab.id)}
        >
          {tab.label}
          {(props.counts[tab.id] ?? 0) > 0 && (
            <sup className="tabs__count" aria-label={`${props.counts[tab.id]} tasks`}>
              {props.counts[tab.id]}
            </sup>
          )}
        </button>
      ))}
      <span
        className="tabs__underline"
        aria-hidden="true"
        style={{ left: underline.left, width: underline.width }}
      />
      <span className="tabs__spacer" />
      {props.loopsCount > 0 && (
        <button
          type="button"
          className={`tabs__loops${props.loopsActive ? ' tabs__loops--active' : ''}`}
          aria-pressed={props.loopsActive}
          aria-label={`${props.loopsCount} open questions — answer them`}
          title="Quick questions (A)"
          onClick={props.onToggleLoops}
        >
          <span aria-hidden="true">◌</span> {props.loopsCount}
        </button>
      )}
      <button
        type="button"
        className="tabs__searchbtn"
        aria-label="Search"
        title="Search (/)"
        onClick={props.onSearchOpen}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
          <circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8.6 8.6l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
