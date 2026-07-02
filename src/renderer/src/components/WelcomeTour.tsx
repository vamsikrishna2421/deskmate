/** First-launch welcome tour — four short steps in DeskMate's calm voice, ending with a
 *  "try it live" moment: capture a sample manager message and watch the assistant organize
 *  it. Skippable at every step; never auto-shows again once finished or skipped. */

import { useEffect, useRef, useState } from 'react'
import '../styles/briefing.css'
import type { WelcomeTourProps } from './props'

function Keys({ combo }: { combo: string }): React.JSX.Element {
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

interface Step {
  kicker: string
  title: string
  body: React.ReactNode
  visual?: React.ReactNode
}

/** Pictorial before→after: a raw message becoming an organized card. */
function CaptureDemo(): React.JSX.Element {
  return (
    <div className="tour__demo" aria-hidden="true">
      <div className="tour__msg">
        &ldquo;Need the Q2 numbers by <mark>Friday</mark> — it&apos;s for the VP deck&rdquo;
      </div>
      <div className="tour__arrow">↓ the assistant reads it</div>
      <div className="tour__minicard">
        <span className="tour__minirail" />
        <div className="tour__minibody">
          <div className="tour__minititle">Pull Q2 numbers for the VP deck</div>
          <div className="tour__minimeta">
            <span className="tour__chip tour__chip--hard">● friday</span>
            <span className="tour__chip">~1h</span>
            <span className="tour__mark">✦</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The three marks, shown as they actually render. */
function MarksDemo(): React.JSX.Element {
  return (
    <div className="tour__demo tour__demo--row" aria-hidden="true">
      <div className="tour__markdemo">
        <span className="tour__chip tour__chip--hard">● today 5pm</span>
        <span className="tour__marklabel">firm deadline</span>
      </div>
      <div className="tour__markdemo">
        <span className="tour__chip">○ Friday</span>
        <span className="tour__marklabel">soft target</span>
      </div>
      <div className="tour__markdemo">
        <span className="tour__chip tour__chip--loop">◌ when?</span>
        <span className="tour__marklabel">has a question</span>
      </div>
    </div>
  )
}

export function WelcomeTour(props: WelcomeTourProps): React.JSX.Element {
  const [step, setStep] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.focus()
  }, [step])

  const steps: Step[] = [
    {
      kicker: 'WELCOME',
      title: 'Meet DeskMate.',
      body: (
        <>
          <p>
            A quiet ledge for the tasks that land on you. Paste a message from your manager or a
            teammate — DeskMate reads it, splits it into tasks, and figures out the deadline.
          </p>
          <p>Everything stays on this machine. No accounts, no cloud.</p>
        </>
      )
    },
    {
      kicker: 'CAPTURE',
      title: 'The one shortcut that matters.',
      body: (
        <>
          <p>
            Copy a message anywhere — Teams, Outlook, your browser — then press{' '}
            <Keys combo={props.captureHotkey} />. Your copied text is already waiting; press{' '}
            <kbd>Enter</kbd> and the assistant organizes it a few seconds later.
          </p>
          <p>
            Want to state something yourself? Add plain words to the text:{' '}
            <code>!today</code> means &ldquo;this is due today&rdquo;, <code>!hard</code> means
            &ldquo;that deadline is firm, not flexible&rdquo;, and <code>#finance</code> adds a topic
            label. Whatever you state this way is yours — the assistant never changes it.
          </p>
        </>
      ),
      visual: <CaptureDemo />
    },
    {
      kicker: 'ALWAYS AROUND',
      title: 'The dot, the tray, the shade.',
      body: (
        <>
          <p>
            The floating dot lives above every app — click it to open DeskMate, click again to tuck it
            away. Drag it anywhere. <Keys combo={props.toggleHotkey} /> does the same from the keyboard.
          </p>
          <p>
            Closing the window keeps DeskMate in the tray. Double-click the header to shade it into a
            one-line ticker. And on screen shares, DeskMate is invisible to your audience.
          </p>
        </>
      )
    },
    {
      kicker: 'THE LANGUAGE',
      title: 'Three marks tell you everything.',
      body: (
        <>
          <p>
            <span className="tour__mark">●</span> a real deadline · <span className="tour__mark">○</span>{' '}
            a soft target · <span className="tour__mark tour__mark--loop">◌</span> the assistant has a
            question — answer it and the task sharpens.
          </p>
          <p>
            Views: <strong>Today · Week · Later · Done · Desk</strong> (keys <kbd>1</kbd>–<kbd>5</kbd>).
            Desk holds your frequently used commands, links, and secrets. Press <kbd>?</kbd> for the full
            legend, <kbd>F1</kbd> for the guide — any time.
          </p>
          <p>Each morning, DeskMate opens with a briefing of what matters today.</p>
        </>
      ),
      visual: <MarksDemo />
    }
  ]

  const last = step === steps.length - 1
  const current = steps[step]

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      if (last) props.onFinish(true)
      else setStep((s) => s + 1)
    } else if (e.key === 'ArrowLeft' && step > 0) {
      e.stopPropagation()
      setStep((s) => s - 1)
    }
  }

  return (
    <div
      ref={rootRef}
      className="briefing tour"
      role="region"
      aria-label="Welcome tour"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="briefing__dateline">{current.kicker}</div>
      <h2 className="briefing__greeting">{current.title}</h2>
      <span className="briefing__rule" aria-hidden="true" />
      <div className="tour__body">{current.body}</div>
      {current.visual}

      <div className="tour__dots" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((_, i) => (
          <span key={i} className={`tour__dot${i === step ? ' tour__dot--active' : ''}`} />
        ))}
      </div>

      <footer className="briefing__footer">
        {last ? (
          <>
            <button type="button" className="primary" onClick={() => props.onFinish(true)}>
              Try it with a sample →
            </button>
            <button type="button" className="ghost" onClick={() => props.onFinish(false)}>
              Start fresh
            </button>
          </>
        ) : (
          <>
            <button type="button" className="primary" onClick={() => setStep((s) => s + 1)}>
              Next →
            </button>
            {step > 0 && (
              <button type="button" className="ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            <button type="button" className="ghost tour__skip" onClick={() => props.onFinish(false)}>
              Skip the tour
            </button>
          </>
        )}
      </footer>
    </div>
  )
}
