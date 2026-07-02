/** The floating bubble — deliberately React-free: one image, hover opacity, and a manual
 *  drag that can still tell a click from a drag (4px slop). 50% opacity idle, 100% hovered. */

import { BUBBLE_IDLE_OPACITY } from '@shared/constants'
import bubbleMark from './assets/bubble.png'

const CLICK_SLOP_PX = 4

const root = document.getElementById('root')
if (!root) throw new Error('DeskMate: #root element missing in bubble.html')

const style = document.createElement('style')
style.textContent = `
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  #root { height: 100%; }
  .bubble {
    width: 100%; height: 100%;
    display: grid; place-items: center;
    opacity: ${BUBBLE_IDLE_OPACITY};
    transition: opacity 140ms ease, transform 140ms ease;
    cursor: pointer;
    user-select: none;
    -webkit-user-drag: none;
  }
  .bubble:hover { opacity: 1; transform: scale(1.06); }
  .bubble:active { transform: scale(0.97); }
  .bubble img { width: 100%; height: 100%; pointer-events: none; -webkit-user-drag: none; }
  @media (prefers-reduced-motion: reduce) { .bubble, .bubble:hover, .bubble:active { transition: none; transform: none; } }
`
document.head.appendChild(style)

const el = document.createElement('div')
el.className = 'bubble'
el.title = 'DeskMate — click to open, drag to move'
el.setAttribute('role', 'button')
el.setAttribute('aria-label', 'Open DeskMate')
const img = document.createElement('img')
img.src = bubbleMark
img.alt = ''
el.appendChild(img)
root.appendChild(el)

// Signal ui:ready once the logo is decoded and a frame has painted — main reveals us then.
void img
  .decode()
  .catch(() => undefined)
  .then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => void window.loops.invoke('ui:ready', undefined).catch(() => undefined))
    )
  })

let dragging = false
let moved = false
let grabDx = 0
let grabDy = 0

el.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  dragging = true
  moved = false
  // Offset of the grab point inside the window, in screen coordinates.
  grabDx = e.screenX - window.screenX
  grabDy = e.screenY - window.screenY
  e.preventDefault()
})

window.addEventListener('mousemove', (e) => {
  if (!dragging) return
  const dx = Math.abs(e.screenX - (window.screenX + grabDx))
  const dy = Math.abs(e.screenY - (window.screenY + grabDy))
  if (!moved && dx < CLICK_SLOP_PX && dy < CLICK_SLOP_PX) return
  moved = true
  void window.loops.invoke('bubble:moveTo', { x: e.screenX - grabDx, y: e.screenY - grabDy })
})

window.addEventListener('mouseup', (e) => {
  if (!dragging) return
  dragging = false
  if (moved) {
    void window.loops.invoke('bubble:moveTo', {
      x: e.screenX - grabDx,
      y: e.screenY - grabDy,
      persist: true
    })
  } else {
    void window.loops.invoke('bubble:click', undefined)
  }
})

el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') void window.loops.invoke('bubble:click', undefined)
})
