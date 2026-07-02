/** Snippets vault — frequently used commands, doc URLs, notes, and secrets.
 *  Pure — no Electron/Node imports. */

export type SnippetKind = 'command' | 'url' | 'note' | 'secret'

export interface Snippet {
  id: string
  kind: SnippetKind
  label: string
  /** Plaintext for command/url/note. For 'secret' this is ALWAYS '' outside the main process —
   *  ciphertext lives on disk (DPAPI via safeStorage) and plaintext only ever reaches the
   *  clipboard, which auto-clears. */
  value: string
  pinned: boolean
  createdAt: string
  updatedAt: string
  lastCopiedAt?: string
}

export interface SnippetPatch {
  label?: string
  value?: string
  kind?: SnippetKind
  pinned?: boolean
}

/** Seconds before a copied secret is wiped from the clipboard (if still there). */
export const SECRET_CLIPBOARD_CLEAR_SECONDS = 30
