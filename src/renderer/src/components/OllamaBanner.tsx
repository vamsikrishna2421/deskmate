/** DESIGN §12 degraded strip — quiet hairline strip under the header, never a modal, never red. */

import type { OllamaBannerProps } from './props'

export function OllamaBanner(props: OllamaBannerProps): React.JSX.Element | null {
  if (props.reachable && !props.paused) return null
  const offline = !props.reachable
  return (
    <div className="banner" role="status">
      <span className="dot dot--hollow" aria-hidden="true" />
      <span className="banner__text">
        {offline ? 'Assistant is offline — everything still works.' : 'Assistant is paused.'}
      </span>
      <button type="button" className="banner__action" onClick={offline ? props.onRetry : props.onResume}>
        {offline ? 'Retry' : 'Resume'}
      </button>
      <button type="button" className="banner__dismiss" aria-label="Dismiss" onClick={props.onDismiss}>
        ×
      </button>
    </div>
  )
}
