/** Quick-capture window entry: fonts, tokens, theme wiring, CaptureApp (no providers —
 *  the capture window only talks capture:submit / capture:dismiss). */

import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/themes.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CaptureApp from './app/CaptureApp'
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
  mq.addEventListener('change', apply)
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
    console.error(err)
  }
  apply()
}

startThemeSync()

const root = document.getElementById('root')
if (!root) throw new Error('DeskMate: #root element missing in capture.html')

createRoot(root).render(
  <StrictMode>
    <CaptureApp />
  </StrictMode>
)
