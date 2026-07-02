/** Companion window entry: fonts, tokens, theme wiring, providers, App. */

import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './state/store'
import App from './app/App'
import { invoke, on } from './lib/api'

type ThemeMode = 'system' | 'light' | 'dark'

function startThemeSync(): void {
  let mode: ThemeMode = 'system'
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (): void => {
    const dark = mode === 'dark' || (mode === 'system' && mq.matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
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
