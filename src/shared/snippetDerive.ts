/** Single-box Desk capture: the user pastes ONE thing and kind + label are derived here —
 *  no kind picker, no label field (owner's rule: adding is one box, everything derived;
 *  the detailed edit form stays for corrections). Pure — no Electron/Node imports. */

import type { SnippetKind } from './types/snippet'

const LABEL_MAX = 44

/** Common CLI starters — one word is enough; flags/pipes catch the rest. */
const COMMAND_STARTERS =
  /^(git|npm|npx|pnpm|yarn|node|python|python3|pip|pip3|docker|kubectl|ssh|scp|curl|wget|aws|az|gcloud|ollama|psql|sqlcmd|mysql|dotnet|mvn|gradle|make|terraform|helm|cargo|go|ruby|rails|php|composer|cd|ls|cat|grep|find|rg|sed|awk|tar|unzip|ping|ipconfig|ifconfig|netstat|tracert|nslookup|taskkill|tasklist|powershell|pwsh|winget|choco|code|start|explorer)\b/i

const SQL_STARTERS = /^(select|insert|update|delete|with|create|alter|drop|truncate|merge)\b/i

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Hostname + a hint of path: "github.com/vamsi…/deskmate" style, capped. */
function urlLabel(raw: string): string {
  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : ''
    return truncate(`${host}${path}`, LABEL_MAX)
  } catch {
    return truncate(raw, LABEL_MAX)
  }
}

export interface DerivedSnippet {
  kind: Exclude<SnippetKind, 'secret'>
  label: string
}

export function deriveSnippet(raw: string): DerivedSnippet {
  const text = raw.trim()
  const firstLine = text.split('\n', 1)[0].trim()
  const singleLine = !text.includes('\n')

  // A lone http(s) URL → link, labeled by its address (the row itself opens it).
  if (singleLine && /^https?:\/\/\S+$/i.test(text)) {
    return { kind: 'url', label: urlLabel(text) }
  }

  // Command: starts like a CLI/SQL call, or a single line carrying flags or pipes.
  const looksFlaggy = /\s--?[a-z]/i.test(text) || / \| /.test(text)
  if ((singleLine || SQL_STARTERS.test(firstLine)) && (COMMAND_STARTERS.test(firstLine) || SQL_STARTERS.test(firstLine) || (singleLine && looksFlaggy))) {
    return { kind: 'command', label: truncate(firstLine, LABEL_MAX) }
  }

  return { kind: 'note', label: truncate(firstLine, LABEL_MAX) || 'Untitled note' }
}
