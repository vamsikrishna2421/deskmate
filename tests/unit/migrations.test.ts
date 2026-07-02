/** Migration framework behavior (src/main/store/migrations.ts). SCHEMA_VERSION is 1 and the
 *  MIGRATIONS chain is empty by design (v1 = first shipped version), so the reachable surface is:
 *  version detection, current-version passthrough, and the future-version read-only refusal.
 *  The backup-before-migrate hook is verified negatively: no backup may be written on the
 *  passthrough or refusal paths (writeBackup only runs once an actual upgrade starts). */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCHEMA_VERSION } from '../../src/shared/constants'
import { docSchemaVersion, migrateDoc, ReadOnlyStoreError } from '../../src/main/store/migrations'

let dir: string
let filePath: string
let backupDir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sill-migrate-'))
  filePath = join(dir, 'tasks.json')
  backupDir = join(dir, 'backups')
  await writeFile(filePath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, tasks: [] }), 'utf8')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('docSchemaVersion', () => {
  it('reads a valid integer version', () => {
    expect(docSchemaVersion({ schemaVersion: 3 })).toBe(3)
    expect(docSchemaVersion({ schemaVersion: 1 })).toBe(1)
  })

  it('missing / invalid / non-integer / sub-1 versions are treated as v1', () => {
    expect(docSchemaVersion({})).toBe(1)
    expect(docSchemaVersion({ schemaVersion: 'two' })).toBe(1)
    expect(docSchemaVersion({ schemaVersion: 2.5 })).toBe(1)
    expect(docSchemaVersion({ schemaVersion: 0 })).toBe(1)
    expect(docSchemaVersion({ schemaVersion: -4 })).toBe(1)
    expect(docSchemaVersion({ schemaVersion: null })).toBe(1)
  })
})

describe('migrateDoc — current version', () => {
  it('passes the document through untouched, no backup written', async () => {
    const doc = { schemaVersion: SCHEMA_VERSION, tasks: ['x'] }
    const result = await migrateDoc(doc, { filePath, backupDir })
    expect(result.migrated).toBe(false)
    expect(result.doc).toBe(doc) // same reference — no copy, no mutation
    expect(existsSync(backupDir)).toBe(false)
  })

  it('a missing schemaVersion counts as v1 (current) and passes through', async () => {
    const doc = { tasks: [] }
    const result = await migrateDoc(doc, { filePath, backupDir })
    expect(result.migrated).toBe(false)
    expect(result.doc).toBe(doc)
  })
})

describe('migrateDoc — future on-disk version', () => {
  it('throws ReadOnlyStoreError carrying both versions', async () => {
    const doc = { schemaVersion: SCHEMA_VERSION + 1 }
    const err = await migrateDoc(doc, { filePath, backupDir }).then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(ReadOnlyStoreError)
    expect(err).toBeInstanceOf(Error)
    const roe = err as ReadOnlyStoreError
    expect(roe.name).toBe('ReadOnlyStoreError')
    expect(roe.foundVersion).toBe(SCHEMA_VERSION + 1)
    expect(roe.supportedVersion).toBe(SCHEMA_VERSION)
    expect(roe.message).toContain('read-only')
  })

  it('refuses before touching disk — no backup, no write', async () => {
    await expect(migrateDoc({ schemaVersion: 99 }, { filePath, backupDir })).rejects.toBeInstanceOf(
      ReadOnlyStoreError
    )
    expect(existsSync(backupDir)).toBe(false)
  })

  it('a far-future version is refused the same way', async () => {
    await expect(migrateDoc({ schemaVersion: 1000 }, { filePath, backupDir })).rejects.toBeInstanceOf(
      ReadOnlyStoreError
    )
  })
})
