import type { LoopsApi } from '../shared/types/ipc'

declare global {
  interface Window {
    /** The frozen preload bridge — DeskMate's only renderer↔main surface. */
    loops: LoopsApi
  }
}

export {}
