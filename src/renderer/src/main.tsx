/** Companion window entry: fonts, tokens, theme wiring, providers, App. */

import '@fontsource-variable/inter'
// Editorial serif for greetings + empty-state whispers (--font-display) — the app's most-seen
// emotional moments deserve better than fallback Georgia. Both files bundle locally (offline).
import '@fontsource-variable/newsreader/wght.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import './styles/tokens.css'
import './styles/themes.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './state/store'
import App from './app/App'
import { invoke, on } from './lib/api'

type ThemeMode = 'system' | 'light' | 'dark' | 'brutalist' | 'sticky'

function startThemeSync(): void {
  let mode: ThemeMode = 'system'
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (): void => {
    const dark = mode === 'dark' || (mode === 'system' && mq.matches)
    document.documentElement.dataset.theme =
      mode === 'brutalist' || mode === 'sticky' ? mode : dark ? 'dark' : 'light'
  }
  mq.addEventListener('change', apply) // 'system' follows nativeTheme via prefers-color-scheme
  try {
    on('settings:changed', (s) => {
      mode = s.theme
      apply()
    })
    void invoke('settings:get', undefined)
      .then((s) => {
        mode = s.theme
        apply()
      })
      .catch(apply)
  } catch (err) {
    console.error(err) // bridge missing — fall back to system theme
  }
  apply()
}

startThemeSync()

const root = document.getElementById('root')
if (!root) throw new Error('DeskMate: #root element missing in index.html')

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>
)
