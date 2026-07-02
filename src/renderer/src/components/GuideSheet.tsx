/** "How to use DeskMate" — the always-available guide (··· menu / F1). Compact reference in
 *  the app's own voice; ends with a replay of the welcome tour. */

import '../styles/briefing.css'
import type { GuideSheetProps } from './props'

function Kbd({ combo }: { combo: string }): React.JSX.Element {
  return (
    <span className="tour__keys">
      {combo.split('+').map((k, i) => (
        <span key={`${k}-${i}`}>
          {i > 0 && <span className="tour__plus">+</span>}
          <kbd>{k === 'Control' ? 'Ctrl' : k}</kbd>
        </span>
      ))}
    </span>
  )
}

const KEY_ROWS: ReadonlyArray<[string, string]> = [
  ['N', 'capture inside DeskMate'],
  ['1 – 5', 'Today · Week · Later · Done · Desk'],
  ['↑ ↓ / j k', 'move between cards'],
  ['Enter', 'open a card'],
  ['Space / D', 'done'],
  ['E · S · T · P', 'edit · snooze · move to today · priority'],
  ['A', 'answer open questions rapid-fire'],
  ['/', 'search'],
  ['?', 'legend'],
  ['F1', 'this guide'],
  ['Esc', 'close → collapse → clear → shade']
]

export function GuideSheet(props: GuideSheetProps): React.JSX.Element {
  return (
    <div className="guide" role="region" aria-label="How to use DeskMate">
      <div className="sheetbody__head">
        <h2 className="guide__title">How to use DeskMate</h2>
        <button type="button" className="sheetbody__close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </div>

      <section className="guide__section">
        <h3 className="briefing__label">Capture a task</h3>
        <p>
          From anywhere: <Kbd combo={props.captureHotkey} /> → paste the message → <kbd>Enter</kbd>. The
          card appears instantly; the assistant fills in the deadline, subtasks, and priority a few
          seconds later. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> keeps the box open for rapid capture.
        </p>
        <p>
          Lock your own calls with hints: <code>!today</code> <code>!week</code> <code>!hard</code>{' '}
          <code>!soft</code> <code>#tag</code> — the assistant never overrides them.
        </p>
      </section>

      <section className="guide__section">
        <h3 className="briefing__label">Trust what you see</h3>
        <p>
          ✦ means the assistant organized it — hover for the source phrase. A dotted underline is a
          guess: tap to confirm. A small lock means you edited it and the assistant will never change
          it. The raw pasted message is always kept on the card.
        </p>
        <p>
          <span className="tour__mark tour__mark--loop">◌</span> means the assistant has a question —
          answer inline, or press <kbd>A</kbd> to clear them all like unread DMs.
        </p>
      </section>

      <section className="guide__section">
        <h3 className="briefing__label">Live with it</h3>
        <p>
          The floating dot opens and closes DeskMate from anywhere (drag it where you like). Closing the
          window keeps it in the tray. Double-click the header for the one-line shade. Every morning it
          greets you with a briefing; hard deadlines get one quiet reminder 30 minutes ahead.
        </p>
        <p>
          <strong>Desk</strong> (key <kbd>5</kbd>) stores your frequently used commands, links, and
          secrets — one-click copy, secrets encrypted and wiped from the clipboard after 30 seconds.
        </p>
        <p>
          On Teams or Zoom screen shares, DeskMate is invisible to your audience. Want a screenshot?
          Flip &ldquo;Invisible to screen capture&rdquo; off in the tray for a moment.
        </p>
      </section>

      <section className="guide__section">
        <h3 className="briefing__label">Keyboard</h3>
        <table className="guide__keys">
          <tbody>
            <tr>
              <td>
                <Kbd combo={props.captureHotkey} />
              </td>
              <td>quick capture — works everywhere</td>
            </tr>
            <tr>
              <td>
                <Kbd combo={props.toggleHotkey} />
              </td>
              <td>show / hide DeskMate — works everywhere</td>
            </tr>
            {KEY_ROWS.map(([keys, what]) => (
              <tr key={keys}>
                <td>
                  <kbd>{keys}</kbd>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="guide__footer">
        <button type="button" className="ghost" onClick={props.onReplayTour}>
          Replay the welcome tour
        </button>
      </footer>
    </div>
  )
}
