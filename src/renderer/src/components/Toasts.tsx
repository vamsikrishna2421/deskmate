/** Bottom-stacked quiet toasts (`Done · Undo`, hotkey conflicts). Auto-dismiss after
 *  toast.durationMs (default 5000; 0 = sticky). */

import { useEffect, useRef } from 'react'
import type { Toast, ToastsProps } from './props'

function ToastRow(props: {
  toast: Toast
  onAction(id: string): void
  onDismiss(id: string): void
}): React.JSX.Element {
  const { toast } = props
  const dismissRef = useRef(props.onDismiss)
  dismissRef.current = props.onDismiss

  useEffect(() => {
    const ms = toast.durationMs ?? 5000
    if (ms <= 0) return
    const t = window.setTimeout(() => dismissRef.current(toast.id), ms)
    return () => window.clearTimeout(t)
  }, [toast.id, toast.durationMs])

  return (
    <div className="toast">
      <span className="toast__text">{toast.text}</span>
      {toast.actionLabel && (
        <button type="button" className="toast__action" onClick={() => props.onAction(toast.id)}>
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        className="toast__dismiss"
        aria-label="Dismiss"
        onClick={() => props.onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  )
}

export function Toasts(props: ToastsProps): React.JSX.Element | null {
  if (props.toasts.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {props.toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onAction={props.onAction} onDismiss={props.onDismiss} />
      ))}
    </div>
  )
}
