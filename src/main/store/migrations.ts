/** schemaVersion migration framework (ARCHITECTURE.md §2.5). MIGRATIONS[v] upgrades a document
 *  from version v to v+1; v1 is the first shipped version, so the chain is currently empty. */

import { SCHEMA_VERSION } from '../../shared/constants'
import { writeBackup } from './backup'

/** Thrown when the on-disk schemaVersion is newer than this build supports. Callers keep the
 *  store read-only and surface a banner — protects against downgrade data loss. */
export class ReadOnlyStoreError extends Error {
  readonly foundVersion: number
  readonly supportedVersion: number

  constructor(foundVersion: number) {
    super(
      `store schemaVersion ${foundVersion} is newer than this build supports (${SCHEMA_VERSION}) — opening read-only`
    )
    this.name = 'ReadOnlyStoreError'
    this.foundVersion = foundVersion
    this.supportedVersion = SCHEMA_VERSION
  }
}

export type StoreDoc = Record<string, unknown>
export type MigrationFn = (doc: StoreDoc) => StoreDoc

const MIGRATIONS: Readonly<Record<number, MigrationFn>> = {}

/** Missing/invalid schemaVersion is treated as v1 (the first version ever shipped). */
export function docSchemaVersion(doc: StoreDoc): number {
  const v = doc.schemaVersion
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1
}

export interface MigrateOptions {
  filePath: string
  backupDir?: string
  now?: () => Date
}

/** Run the ordered chain up to SCHEMA_VERSION, backing the file up before migrating.
 *  Future on-disk versions throw ReadOnlyStoreError. */
export async function migrateDoc(
  doc: StoreDoc,
  opts: MigrateOptions
): Promise<{ doc: StoreDoc; migrated: boolean }> {
  let version = docSchemaVersion(doc)
  if (version > SCHEMA_VERSION) throw new ReadOnlyStoreError(version)
  if (version === SCHEMA_VERSION) return { doc, migrated: false }

  if (opts.backupDir) {
    try {
      await writeBackup(opts.filePath, opts.backupDir, (opts.now ?? (() => new Date()))())
    } catch (err) {
      console.error(`[migrations] pre-migration backup failed for ${opts.filePath}`, err)
    }
  }

  let current = doc
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new Error(`no migration registered for schemaVersion ${version} → ${version + 1}`)
    current = step(current)
    version += 1
  }
  current.schemaVersion = SCHEMA_VERSION
  return { doc: current, migrated: true }
}
