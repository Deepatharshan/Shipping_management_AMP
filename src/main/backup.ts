/**
 * Backups.
 *  - safetyCopy: before the FIRST write to the FoxPro table each day, the table, its memo file and its
 *    index files are copied to %APPDATA%\Shipping Management AMP\foxpro-safety\YYYY-MM-DD\. The last
 *    14 days are kept. Nothing to do for the user; it is there if a write ever needs undoing.
 *  - backupNow (Settings → Backup): a new folder ShippingAMP-backup-YYYY-MM-DD_HHMMSS in the chosen
 *    folder with the FoxPro files and the app's database (shipments.db) and settings.
 * Source files are only read; every copy is compared with its source by size.
 */
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { findMemoPath } from './dbf/reader'

const pad = (n: number) => String(n).padStart(2, '0')
const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function foxFiles(shippingPath: string, indexes: string[]): string[] {
  const memo = findMemoPath(shippingPath)
  return [shippingPath, ...(memo ? [memo] : []), ...indexes].filter((f) => existsSync(f))
}

async function copyChecked(src: string, dest: string) {
  await copyFile(src, dest)
  const [a, b] = await Promise.all([stat(src), stat(dest)])
  if (a.size !== b.size) throw new Error(`The copy of ${basename(src)} is incomplete.`)
}

export async function safetyCopy(appData: string, shippingPath: string, indexes: string[]): Promise<string | null> {
  const root = join(appData, 'foxpro-safety')
  const dir = join(root, day())
  if (existsSync(join(dir, 'done.txt'))) return null
  await mkdir(dir, { recursive: true })
  for (const f of foxFiles(shippingPath, indexes)) await copyChecked(f, join(dir, basename(f)))
  await writeFile(join(dir, 'done.txt'), `Copied before the first FoxPro write on ${new Date().toString()}\nFrom: ${shippingPath}\n`)
  // keep the last 14 days
  const days = (await readdir(root)).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort()
  for (const old of days.slice(0, Math.max(0, days.length - 14))) await rm(join(root, old), { recursive: true, force: true })
  return dir
}

export async function backupNow(opts: {
  target: string
  shippingPath: string
  indexes: string[]
  storeBackup: (dest: string) => void
  settingsFile: string
}): Promise<string> {
  if (!opts.target) throw new Error('Choose a backup folder first.')
  const d = new Date()
  const name = `ShippingAMP-backup-${day(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const dir = join(opts.target, name)
  try {
    await mkdir(join(dir, 'foxpro'), { recursive: true })
    await mkdir(join(dir, 'app'), { recursive: true })
    const copied: string[] = []
    if (opts.shippingPath) {
      for (const f of foxFiles(opts.shippingPath, opts.indexes)) {
        await copyChecked(f, join(dir, 'foxpro', basename(f)))
        copied.push(`foxpro\\${basename(f)}  ←  ${f}`)
      }
    }
    opts.storeBackup(join(dir, 'app', 'shipments.db'))
    copied.push('app\\shipments.db  ←  the app database')
    if (existsSync(opts.settingsFile)) {
      await copyChecked(opts.settingsFile, join(dir, 'app', 'settings.json'))
      copied.push('app\\settings.json')
    }
    await writeFile(
      join(dir, 'README.txt'),
      [`Shipping Management AMP backup, ${d.toString()}`, '', ...copied, '', 'To restore the FoxPro table, close every program using it and copy the files in foxpro\\ back over the originals.',
        'To restore the app database, close the app and copy app\\shipments.db to %APPDATA%\\Shipping Management AMP\\.'].join('\r\n')
    )
    return dir
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw e
  }
}
