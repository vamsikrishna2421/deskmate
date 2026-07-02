/** JsonStore atomicity + corruption recovery against a REAL tmp dir (no fs mocks —
 *  Windows rename semantics matter, ARCHITECTURE.md §7). */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStore } from '../../src/main/store/jsonStore'

interface Doc {
  schemaVersion: number
  items: string[]
}

const DEFAULTS: Doc = { schemaVersion: 1, items: [] }

let dir: string
let file: string
let backups: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sill-store-'))
  file = join(dir, 'tasks.json')
  backups = join(dir, 'backups')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('load', () => {
  it('missing file → a clone of the defaults', async () => {
    const store = new JsonStore<Doc>(file, DEFAULTS)
    const loaded = await store.load()
    expect(loaded).toEqual(DEFAULTS)
    loaded.items.push('mutated')
    expect(DEFAULTS.items).toEqual([]) // defaults must not be shared
  })

  it('cleans up a stale .tmp from a crashed write and keeps the target intact', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, items: ['good'] }), 'utf8')
    await writeFile(`${file}.tmp`, '{"half-written', 'utf8')
    const store = new JsonStore<Doc>(file, DEFAULTS)
    const loaded = await store.load()
    expect(loaded.items).toEqual(['good'])
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})

describe('save / flush', () => {
  it('round-trips through disk', async () => {
    const store = new JsonStore<Doc>(file, DEFAULTS)
    store.save({ schemaVersion: 1, items: ['a', 'b'] })
    await store.flush()
    const reloaded = await new JsonStore<Doc>(file, DEFAULTS).load()
    expect(reloaded).toEqual({ schemaVersion: 1, items: ['a', 'b'] })
  })

  it('save is debounced — nothing hits disk synchronously, flush forces it', async () => {
    const store = new JsonStore<Doc>(file, DEFAULTS)
    store.save({ schemaVersion: 1, items: ['x'] })
    expect(existsSync(file)).toBe(false)
    await store.flush()
    expect(existsSync(file)).toBe(true)
  })

  it('the debounced write fires on its own after ~300ms', async () => {
    const store = new JsonStore<Doc>(file, DEFAULTS)
    store.save({ schemaVersion: 1, items: ['auto'] })
    await new Promise((r) => setTimeout(r, 500))
    expect(JSON.parse(await readFile(file, 'utf8')).items).toEqual(['auto'])
  })

  it('leaves no .tmp file behind after a write', async () => {
    const store = new JsonStore<Doc>(file, DEFAULTS)
    store.save({ schemaVersion: 1, items: ['x'] })
    await store.flush()
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('concurrent saves serialize — the last value wins, output is valid JSON', async () => {
    const store = new JsonStore<Doc>(file, DEFAULTS)
    for (let i = 1; i <= 5; i++) store.save({ schemaVersion: 1, items: [`v${i}`] })
    await store.flush()
    expect(JSON.parse(await readFile(file, 'utf8')).items).toEqual(['v5'])
  })

  it('interleaved save/flush pairs never lose the newest value', async () => {
    const store = new JsonStore<Doc>(file, DEFAULTS)
    store.save({ schemaVersion: 1, items: ['first'] })
    const f1 = store.flush()
    store.save({ schemaVersion: 1, items: ['second'] })
    await Promise.all([f1, store.flush()])
    expect(JSON.parse(await readFile(file, 'utf8')).items).toEqual(['second'])
  })

  it('flush with nothing pending resolves', async () => {
    await expect(new JsonStore<Doc>(file, DEFAULTS).flush()).resolves.toBeUndefined()
  })
})

describe('corruption recovery', () => {
  it('quarantines a corrupt file and falls back to defaults when no backups exist', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await writeFile(file, 'this is not json {{{', 'utf8')
    const store = new JsonStore<Doc>(file, DEFAULTS, { backupDir: backups })
    const loaded = await store.load()
    expect(loaded).toEqual(DEFAULTS)
    const names = await readdir(dir)
    const quarantined = names.find((n) => /^tasks\.corrupt-\d+\.json$/.test(n))
    expect(quarantined).toBeDefined()
    expect(await readFile(join(dir, quarantined as string), 'utf8')).toBe('this is not json {{{')
    expect(existsSync(file)).toBe(false) // renamed away, no valid backup to restore
    expect(errSpy).toHaveBeenCalled()
  })

  it('restores the newest VALID backup, skipping corrupt and foreign-base backups', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mkdir(backups, { recursive: true })
    await writeFile(join(backups, 'tasks-20260629-090000000.json'), JSON.stringify({ schemaVersion: 1, items: ['oldest'] }), 'utf8')
    await writeFile(join(backups, 'tasks-20260630-090000000.json'), JSON.stringify({ schemaVersion: 1, items: ['newest-valid'] }), 'utf8')
    await writeFile(join(backups, 'tasks-20260701-090000000.json'), '{corrupt backup', 'utf8')
    // A newer backup of a DIFFERENT store must be ignored.
    await writeFile(join(backups, 'app-state-20260702-090000000.json'), JSON.stringify({ schemaVersion: 1, items: ['wrong-store'] }), 'utf8')
    await writeFile(file, 'corrupt!!!', 'utf8')

    const store = new JsonStore<Doc>(file, DEFAULTS, { backupDir: backups })
    const loaded = await store.load()
    expect(loaded.items).toEqual(['newest-valid'])
    // Restored data is written back to the target atomically.
    expect(JSON.parse(await readFile(file, 'utf8')).items).toEqual(['newest-valid'])
    const names = await readdir(dir)
    expect(names.some((n) => /^tasks\.corrupt-\d+\.json$/.test(n))).toBe(true)
  })
})

describe('daily backup', () => {
  it('backs up the previous good file before the first overwrite of the day', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, items: ['yesterday'] }), 'utf8')
    const store = new JsonStore<Doc>(file, DEFAULTS, { backupDir: backups })
    store.save({ schemaVersion: 1, items: ['today-1'] })
    await store.flush()
    store.save({ schemaVersion: 1, items: ['today-2'] })
    await store.flush()

    const names = (await readdir(backups)).filter((n) => n.startsWith('tasks-'))
    expect(names).toHaveLength(1) // once per day, not per write
    expect(JSON.parse(await readFile(join(backups, names[0]), 'utf8')).items).toEqual(['yesterday'])
    expect(JSON.parse(await readFile(file, 'utf8')).items).toEqual(['today-2'])
  })

  it('first-ever write (no previous file) creates no backup and still succeeds', async () => {
    const store = new JsonStore<Doc>(file, DEFAULTS, { backupDir: backups })
    store.save({ schemaVersion: 1, items: ['first'] })
    await store.flush()
    expect(JSON.parse(await readFile(file, 'utf8')).items).toEqual(['first'])
    const names = existsSync(backups) ? (await readdir(backups)).filter((n) => n.startsWith('tasks-')) : []
    expect(names).toHaveLength(0)
  })
})
