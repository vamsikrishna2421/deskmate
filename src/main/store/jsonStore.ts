/** Generic atomic JSON file store (ARCHITECTURE.md §2.5): debounced saves, tmp+fsync+rename
 *  writes serialized on a per-file promise chain, corrupt-file quarantine with backup restore. */

import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { STORE_DEBOUNCE_MS } from '../../shared/constants'
import { localDateKey } from '../../shared/dates/dayMath'
import { baseNameOf, restoreNewestValid, writeBackup } from './backup'

export class JsonStore<T> {
  private readonly filePath: string
  private readonly tmpPath: string
  private readonly defaults: T
  private readonly backupDir?: string
  private pending: { data: T } | null = null
  private debounce: ReturnType<typeof setTimeout> | undefined
  private chain: Promise<void> = Promise.resolve()
  private lastBackupDay: string | undefined
  private lastError: unknown

  constructor(filePath: string, defaults: T, opts?: { backupDir?: string }) {
    this.filePath = filePath
    this.tmpPath = `${filePath}.tmp`
    this.defaults = defaults
    this.backupDir = opts?.backupDir
  }

  /** Missing file → defaults. Corrupt file → quarantined as *.corrupt-<ts>.json, then the newest
   *  valid backup is restored (written back atomically) or defaults are returned. */
  async load(): Promise<T> {
    await rm(this.tmpPath, { force: true }).catch(() => undefined) // stale tmp from a crash
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(this.defaults)
      throw err
    }
    try {
      return JSON.parse(raw) as T
    } catch {
      await this.quarantine()
      if (this.backupDir) {
        const restored = await restoreNewestValid<T>(
          this.backupDir,
          (text) => {
            try {
              return JSON.parse(text) as T
            } catch {
              return null
            }
          },
          baseNameOf(this.filePath)
        )
        if (restored) {
          await this.writeAtomic(restored.data)
          return restored.data
        }
      }
      return structuredClone(this.defaults)
    }
  }

  /** Debounced write — the latest value wins. */
  save(data: T): void {
    this.pending = { data }
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = undefined
      this.enqueuePending()
    }, STORE_DEBOUNCE_MS)
  }

  /** Write any pending data immediately; rejects if the write failed (data is kept for retry). */
  async flush(): Promise<void> {
    if (this.debounce) {
      clearTimeout(this.debounce)
      this.debounce = undefined
    }
    this.enqueuePending()
    await this.chain
    if (this.lastError !== undefined) {
      throw this.lastError instanceof Error ? this.lastError : new Error(String(this.lastError))
    }
  }

  private enqueuePending(): void {
    const p = this.pending
    if (!p) return
    this.pending = null
    this.chain = this.chain.then(() => this.write(p.data))
  }

  private async write(data: T): Promise<void> {
    try {
      await this.maybeDailyBackup()
      await this.writeAtomic(data)
      this.lastError = undefined
    } catch (err) {
      this.lastError = err
      if (!this.pending) this.pending = { data } // retried on the next save/flush
      console.error(`[jsonStore] write failed: ${this.filePath}`, err)
    }
  }

  private async writeAtomic(data: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const fh = await open(this.tmpPath, 'w')
    try {
      await fh.writeFile(JSON.stringify(data, null, 2), 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    await rename(this.tmpPath, this.filePath)
  }

  /** Back up the previous good file once per local day, before the day's first overwrite.
   *  The day is marked consumed only after the copy succeeds — a failed copy retries on
   *  the next write instead of forfeiting the whole day's backup. */
  private async maybeDailyBackup(): Promise<void> {
    if (!this.backupDir) return
    const day = localDateKey(new Date())
    if (this.lastBackupDay === day) return
    try {
      await writeBackup(this.filePath, this.backupDir, new Date())
      this.lastBackupDay = day
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.lastBackupDay = day // nothing to back up yet (first ever write)
        return
      }
      console.error(`[jsonStore] daily backup failed: ${this.filePath}`, err)
    }
  }

  private async quarantine(): Promise<void> {
    const target = `${this.filePath.replace(/\.json$/i, '')}.corrupt-${Date.now()}.json`
    try {
      await rename(this.filePath, target)
      console.error(`[jsonStore] corrupt store quarantined: ${target}`)
    } catch (err) {
      console.error(`[jsonStore] failed to quarantine ${this.filePath}`, err)
    }
  }
}
