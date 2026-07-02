/** Bottom-sheet chrome shared by Legend/Settings/TaskEditor: scrim, dialog role, focus on
 *  open, and a Tab trap (DESIGN §18 — sheets trap focus; Esc is handled by the global map,
 *  and App returns focus to the invoker on close). */

import { useEffect, useRef, type ReactNode } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SheetContainer(props: {
  label: string
  onScrimClick(): void
  children: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const root = ref.current
    if (!root) return
    const focusables = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusables.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="sheet-scrim" onClick={props.onScrimClick}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    </div>
  )
}
