/** Single-box Desk capture derivation (src/shared/snippetDerive.ts). */

import { describe, expect, it } from 'vitest'
import { deriveSnippet } from '../../src/shared/snippetDerive'

describe('deriveSnippet', () => {
  it('derives links from lone URLs with a readable label', () => {
    expect(deriveSnippet('https://github.com/vamsikrishna2421/deskmate')).toEqual({
      kind: 'url',
      label: 'github.com/vamsikrishna2421/deskmate'
    })
    expect(deriveSnippet('https://www.tableau.staples.com/')).toEqual({
      kind: 'url',
      label: 'tableau.staples.com'
    })
  })

  it('derives commands from CLI starters, flags, and SQL', () => {
    expect(deriveSnippet('git log --oneline -20').kind).toBe('command')
    expect(deriveSnippet('ollama pull qwen2.5:3b').kind).toBe('command')
    expect(deriveSnippet('SELECT * FROM vendor_spend WHERE quarter = 2').kind).toBe('command')
    expect(deriveSnippet('some.exe --verbose --output out.txt').kind).toBe('command')
  })

  it('derives notes from everything else, labeled by first line', () => {
    const d = deriveSnippet('Wifi guest code is STAPLES-2026\nask reception if rotated')
    expect(d.kind).toBe('note')
    expect(d.label).toBe('Wifi guest code is STAPLES-2026')
  })

  it('does not call prose with a URL inside a link', () => {
    expect(deriveSnippet('the dashboard lives at https://bi.example.com now').kind).toBe('note')
  })

  it('truncates long labels with an ellipsis', () => {
    const d = deriveSnippet('git commit --amend --no-edit && git push --force-with-lease origin feature/very-long-branch')
    expect(d.kind).toBe('command')
    expect(d.label.length).toBeLessThanOrEqual(44)
    expect(d.label.endsWith('…')).toBe(true)
  })

  it('multi-line command-ish text stays a note unless SQL', () => {
    expect(deriveSnippet('git status\ngit push').kind).toBe('note')
    expect(deriveSnippet('SELECT id\nFROM tasks').kind).toBe('command')
  })

  it('never returns an empty label', () => {
    expect(deriveSnippet('   \n  ').label).toBe('Untitled note')
  })
})
