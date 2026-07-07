/** DESIGN §11 settings sheet. All writes go through onUpdate(Partial<Settings>) except the
 *  OpenAI key, which rides its own one-way channel (assistant:setApiKey) so the secret never
 *  lives in settings state. Base URL edits are validated loopback-only here (and again in main). */

import { useEffect, useRef, useState } from 'react'
import { invoke } from '../lib/api'
import type { Settings, SettingsSheetProps } from './props'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function isLoopbackUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

function acceleratorFrom(e: React.KeyboardEvent): string | null {
  const key = e.key
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  if (mods.length === 0) return null
  const main =
    key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key.replace(/^Arrow/, '')
  return [...mods, main].join('+')
}

function HotkeyField(props: {
  label: string
  value: string
  onCommit(accelerator: string): void
}): React.JSX.Element {
  return (
    <label className="settings__row">
      <span className="settings__label">{props.label}</span>
      <input
        type="text"
        className="settings__hotkey"
        value={props.value}
        readOnly
        aria-label={`${props.label} — press a new shortcut`}
        title="Press a new shortcut"
        onKeyDown={(e) => {
          if (e.key === 'Tab') return
          e.preventDefault()
          e.stopPropagation()
          const accel = acceleratorFrom(e)
          if (accel) props.onCommit(accel)
        }}
      />
    </label>
  )
}

function trapTab(e: React.KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return
  const focusables = root.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select, [tabindex]:not([tabindex="-1"])'
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

export function SettingsSheet(props: SettingsSheetProps): React.JSX.Element {
  const { settings, ollama } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [baseUrl, setBaseUrl] = useState(settings.ollama.baseUrl)
  const [urlError, setUrlError] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)

  /** One-way: the key goes to main for DPAPI encryption and is never readable back. */
  const saveApiKey = (): void => {
    const key = apiKey.trim()
    if (!key) return
    void invoke('assistant:setApiKey', { key }).then(() => {
      setApiKey('')
      setKeySaved(true)
      window.setTimeout(() => setKeySaved(false), 1800)
    })
  }

  const removeApiKey = (): void => {
    void invoke('assistant:setApiKey', { key: '' })
  }

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('input, button.sheetbody__close')?.focus()
  }, [])

  const patchOllama = (patch: Partial<Settings['ollama']>): void =>
    props.onUpdate({ ollama: { ...settings.ollama, ...patch } })

  const commitBaseUrl = (): void => {
    const value = baseUrl.trim()
    if (!isLoopbackUrl(value)) {
      setUrlError(true)
      return
    }
    setUrlError(false)
    if (value !== settings.ollama.baseUrl) patchOllama({ baseUrl: value })
  }

  const models = [...settings.ollama.preferredModels]
  for (const m of ollama.models) if (!models.includes(m)) models.push(m)
  const chosen = settings.ollama.selectedModel ?? ollama.activeModel

  const paused = settings.ollama.paused
  const remote = settings.assistantProvider === 'openai'
  const healthDot = paused || !ollama.reachable ? 'dot dot--hollow' : ollama.queued > 0 ? 'dot dot--pulse pulse' : 'dot dot--ready'
  const healthText = paused
    ? 'Assistant is paused'
    : remote
      ? ollama.remoteConfigured
        ? ollama.reachable
          ? `gpt-5-nano (cloud) · ${ollama.queued > 0 ? 'working' : 'ready'}`
          : "OpenAI isn't reachable — check the key or your connection"
        : 'Paste your OpenAI API key below to turn this on'
      : ollama.reachable
        ? `${ollama.activeModel ?? 'no model installed'} · ${ollama.queued > 0 ? 'working' : 'ready'}`
        : `Ollama isn't reachable at ${settings.ollama.baseUrl.replace(/^https?:\/\//, '')}`

  return (
    <div
      className="settings sheetbody"
      ref={rootRef}
      onKeyDown={(e) => trapTab(e, rootRef.current)}
      aria-label="Settings"
    >
      <header className="sheetbody__head">
        <h2>Settings</h2>
        <button type="button" className="sheetbody__close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </header>

      <section className="settings__section">
        <h3 className="settings__heading">General</h3>
        <div className="settings__row" role="radiogroup" aria-label="Theme">
          <span className="settings__label">Theme</span>
          <div className="editor__segments">
            {/* Dark is the default; light is an intentional choice. No 'system' — see appStateRepo. */}
            {(['dark', 'light', 'brutalist', 'sticky'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={settings.theme === t}
                className={`editor__segment${settings.theme === t ? ' editor__segment--active' : ''}`}
                onClick={() => props.onUpdate({ theme: t })}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <label className="settings__row settings__row--toggle">
          <span className="settings__label">Launch at login</span>
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => props.onUpdate({ launchAtLogin: e.target.checked })}
          />
        </label>
        <label className="settings__row settings__row--toggle">
          <span className="settings__label">Start hidden</span>
          <input
            type="checkbox"
            checked={settings.startHidden}
            onChange={(e) => props.onUpdate({ startHidden: e.target.checked })}
          />
        </label>
        <label className="settings__row settings__row--toggle">
          <span className="settings__label">Floating bubble</span>
          <input
            type="checkbox"
            checked={settings.bubbleEnabled}
            aria-describedby="bubble-hint"
            onChange={(e) => props.onUpdate({ bubbleEnabled: e.target.checked })}
          />
        </label>
        <p id="bubble-hint" className="settings__hint">
          A small DeskMate dot that floats over every app — click it to open, drag it anywhere.
        </p>
        <label className="settings__row settings__row--toggle">
          <span className="settings__label">Invisible to screen sharing</span>
          <input
            type="checkbox"
            checked={settings.privateToScreenShare}
            aria-describedby="private-hint"
            onChange={(e) => props.onUpdate({ privateToScreenShare: e.target.checked })}
          />
        </label>
        <p id="private-hint" className="settings__hint">
          Teams and Zoom viewers can&apos;t see DeskMate — it stays visible only to you.
        </p>
        <label className="settings__row settings__row--toggle">
          <span className="settings__label">Prefill capture from clipboard</span>
          <input
            type="checkbox"
            checked={settings.captureClipboardPrefill}
            aria-describedby="prefill-hint"
            onChange={(e) => props.onUpdate({ captureClipboardPrefill: e.target.checked })}
          />
        </label>
        <p id="prefill-hint" className="settings__hint">
          Copy → hotkey → Enter. The clipboard is read only at that moment, never in the background.
        </p>
        <HotkeyField
          label="Quick capture"
          value={settings.hotkeyCapture}
          onCommit={(hotkeyCapture) => props.onUpdate({ hotkeyCapture })}
        />
        <HotkeyField
          label="Show or hide DeskMate"
          value={settings.hotkeyToggle}
          onCommit={(hotkeyToggle) => props.onUpdate({ hotkeyToggle })}
        />
      </section>

      <section className="settings__section">
        <h3 className="settings__heading">Assistant</h3>
        <div className="settings__row" role="radiogroup" aria-label="Where the assistant runs">
          <span className="settings__label">Runs</span>
          <div className="editor__segments">
            {(
              [
                ['ollama', 'On this machine'],
                ['openai', 'OpenAI cloud']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={settings.assistantProvider === value}
                className={`editor__segment${settings.assistantProvider === value ? ' editor__segment--active' : ''}`}
                onClick={() => props.onUpdate({ assistantProvider: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings__row">
          <span className={healthDot} aria-hidden="true" />
          <span className="settings__health">{healthText}</span>
          {!ollama.reachable && !paused && (remote ? ollama.remoteConfigured : true) && (
            <button type="button" className="ghost" onClick={props.onRetryOllama}>
              Retry
            </button>
          )}
        </div>
        {remote && (
          <>
            <div className="settings__row">
              <span className="settings__label">API key</span>
              <input
                type="password"
                className="settings__url"
                value={apiKey}
                spellCheck={false}
                placeholder={ollama.remoteConfigured ? 'saved — paste a new key to replace' : 'sk-…'}
                aria-label="OpenAI API key"
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveApiKey()
                  }
                }}
              />
              <button type="button" className="ghost" disabled={apiKey.trim().length === 0} onClick={saveApiKey}>
                {keySaved ? 'Saved ✓' : 'Save'}
              </button>
              {ollama.remoteConfigured && apiKey.trim().length === 0 && (
                <button type="button" className="ghost" onClick={removeApiKey}>
                  Remove key
                </button>
              )}
            </div>
            <p className="settings__note">
              Captured messages are sent to OpenAI while this is on. The key is encrypted on this
              machine and only gpt-5-nano — the cheapest model — is ever used.
            </p>
          </>
        )}
        {!remote && (
        <div className="settings__models" role="radiogroup" aria-label="Model">
          {models.map((m) => {
            const installed = ollama.models.includes(m)
            return (
              <div key={m} className={`settings__model${installed ? '' : ' settings__model--missing'}`}>
                <label>
                  <input
                    type="radio"
                    name="model"
                    checked={chosen === m}
                    disabled={!installed}
                    onChange={() => patchOllama({ selectedModel: m })}
                  />
                  <span className="settings__modelname">{m}</span>
                </label>
                {!installed && (
                  <span className="settings__pull selectable">
                    not installed — ollama pull {m}
                    <button
                      type="button"
                      className="ghost"
                      aria-label={`Copy "ollama pull ${m}"`}
                      onClick={() => {
                        void navigator.clipboard.writeText(`ollama pull ${m}`)
                        setCopied(m)
                        window.setTimeout(() => setCopied(null), 1500)
                      }}
                    >
                      {copied === m ? 'Copied ✓' : 'Copy'}
                    </button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
        )}
        <label className="settings__row settings__row--toggle">
          <span className="settings__label">Pause assistant</span>
          <input
            type="checkbox"
            checked={paused}
            onChange={(e) => patchOllama({ paused: e.target.checked })}
          />
        </label>
        {!remote && (
          <>
            <label className="settings__row">
              <span className="settings__label">Ollama address</span>
              <input
                type="text"
                className={`settings__url${urlError ? ' settings__url--error' : ''}`}
                value={baseUrl}
                spellCheck={false}
                onChange={(e) => {
                  setBaseUrl(e.target.value)
                  setUrlError(false)
                }}
                onBlur={commitBaseUrl}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitBaseUrl()
                  }
                }}
              />
            </label>
            {urlError && <p className="settings__error">Only a localhost address works — the local assistant never leaves this machine.</p>}
          </>
        )}
      </section>

      <section className="settings__section">
        <h3 className="settings__heading">Reminders</h3>
        <label className="settings__row settings__row--toggle">
          <span className="settings__label">Remind me before hard deadlines</span>
          <input
            type="checkbox"
            checked={settings.remindersEnabled}
            onChange={(e) => props.onUpdate({ remindersEnabled: e.target.checked })}
          />
        </label>
        <label className="settings__row">
          <span className="settings__label">Lead time (minutes)</span>
          <input
            type="number"
            className="settings__minutes"
            min={5}
            max={240}
            step={5}
            value={settings.dueSoonLeadMinutes}
            disabled={!settings.remindersEnabled}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v >= 5 && v <= 240) {
                props.onUpdate({ dueSoonLeadMinutes: v })
              }
            }}
          />
        </label>
        <div className="settings__row">
          <span className="settings__label">Morning briefing</span>
          <span className="settings__value">Always on · after 4:00am</span>
        </div>
      </section>

      <section className="settings__section">
        <h3 className="settings__heading">Data</h3>
        <div className="settings__row">
          <button type="button" className="ghost" onClick={props.onOpenDataFolder}>
            Open data folder
          </button>
          <button type="button" className="ghost" onClick={props.onExportAll}>
            Export everything (JSON)
          </button>
        </div>
        <p className="settings__note">Backups: 10 recent + 7 daily, automatic.</p>
      </section>

      <footer className="settings__footer">
        <span>DeskMate {props.version}</span>
        <span>Your data never leaves this machine. No accounts, no telemetry — updates come quietly from GitHub.</span>
      </footer>
    </div>
  )
}
