/** Rolling backups (ARCHITECTURE.md §2.5): keep the BACKUPS_RECENT_KEEP most recent plus the
 *  newest per day for BACKUPS_DAILY_KEEP days; restore helper walks newest→oldest until one parses. */

import { copyFile, mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { BACKUPS_DAILY_KEEP, BACKUPS_RECENT_KEEP } from '../../shared/constants'

const BACKUP_NAME_RE = /^(.+)-(\d{8})-(\d{9})\.json$/

export function backupDirFor(dataDir: string): string {
  return join(dataDir, 'backups')
}

/** 'tasks' from '…/tasks.json'. */
export function baseNameOf(filePath: string): string {
  const name = basename(filePath)
  return name.toLowerCase().endsWith('.json') ? name.slice(0, -'.json'.length) : name
}

function stamp(now: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}${p(now.getMilliseconds(), 3)}`
  )
}

interface BackupEntry {
  path: string
  day: string
  sortKey: string
}

async function listBackups(backupDir: string, base?: string): Promise<BackupEntry[]> {
  let names: string[]
  try {
    names = await readdir(backupDir)
  } catch {
    return []
  }
  const entries: BackupEntry[] = []
  for (const name of names) {
    const m = BACKUP_NAME_RE.exec(name)
    if (!m || (base !== undefined && m[1] !== base)) continue
    entries.push({ path: join(backupDir, name), day: m[2], sortKey: `${m[2]}${m[3]}` })
  }
  entries.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0)) // newest first
  return entries
}

/** Copy `sourceFile` into `backupDir`, then prune. Returns the backup path, or null when the
 *  source file does not exist yet. */
export async function writeBackup(sourceFile: string, backupDir: string, now: Date): Promise<string | null> {
  await mkdir(backupDir, { recursive: true })
  const base = baseNameOf(sourceFile)
  const target = join(backupDir, `${base}-${stamp(now)}.json`)
  try {
    await copyFile(sourceFile, target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  await pruneBackups(backupDir, base)
  return target
}

/** Keep the BACKUPS_RECENT_KEEP most recent + the newest per day for the BACKUPS_DAILY_KEEP most
 *  recent distinct days; delete the rest. */
export async function pruneBackups(backupDir: string, base: string): Promise<void> {
  const entries = await listBackups(backupDir, base)
  const keep = new Set(entries.slice(0, BACKUPS_RECENT_KEEP).map((e) => e.path))
  const days: string[] = []
  for (const e of entries) {
    if (!days.includes(e.day)) days.push(e.day)
  }
  for (const day of days.slice(0, BACKUPS_DAILY_KEEP)) {
    const newest = entries.find((e) => e.day === day) // entries are newest-first
    if (newest) keep.add(newest.path)
  }
  await Promise.all(entries.filter((e) => !keep.has(e.path)).map((e) => unlink(e.path).catch(() => undefined)))
}

/** Walk backups newest→oldest and return the first that `parse` accepts.
 *  `dir` may be the data dir (its `backups/` child is used) or the backups dir itself.
 *  Optional `baseName` restricts the walk to one store's backups. */
export async function restoreNewestValid<T>(
  dir: string,
  parse: (raw: string) => T | null,
  baseName?: string
): Promise<{ data: T; file: string } | null> {
  const backupDir = basename(dir) === 'backups' ? dir : join(dir, 'backups')
  for (const entry of await listBackups(backupDir, baseName)) {
    try {
      const data = parse(await readFile(entry.path, 'utf8'))
      if (data !== null) return { data, file: entry.path }
    } catch {
      // unreadable backup — try the next older one
    }
  }
  return null
}
