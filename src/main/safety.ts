/**
 * Write guard. Every file the app writes (settings, PDFs, backups, the proforma copy) goes through
 * safeWriteFile / isProtected, which refuse:
 *   - the FoxPro shipping table and the files next to it with the same name (.FPT memo, .CDX),
 *     and its .IDX files: those are changed ONLY by dbf/writer.ts and dbf/idx.ts;
 *   - the folder of the Product Management App database: this app only reads it (from a copy).
 * The app's own data folder (%APPDATA%\Shipping Management AMP) is always allowed.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'

let protectedFiles: string[] = []
let protectedDirs: string[] = []
let appDataDir = ''

const norm = (p: string) => resolve(p).toLowerCase()

function inside(dir: string, target: string): boolean {
  const rel = relative(dir, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function setAppDataDir(dir: string) {
  appDataDir = dir ? norm(dir) : ''
}

export function setProtectedPaths(s: { shippingPath: string; shippingIndexes: string[]; pmaDbPath: string }) {
  const files: string[] = []
  if (s.shippingPath) {
    const f = norm(s.shippingPath)
    const stem = f.slice(0, f.length - extname(f).length)
    files.push(f, `${stem}.fpt`, `${stem}.cdx`, `${stem}.dbt`)
  }
  for (const i of s.shippingIndexes ?? []) if (i) files.push(norm(i))
  protectedFiles = files
  protectedDirs = s.pmaDbPath ? [norm(dirname(s.pmaDbPath))] : []
}

export function isProtected(target: string): boolean {
  const t = norm(target)
  if (protectedFiles.includes(t)) return true
  if (/\.(dbf|fpt|cdx|idx)$/i.test(t) && protectedFiles.some((f) => dirname(f) === dirname(t))) return true
  if (appDataDir && inside(appDataDir, t)) return false
  return protectedDirs.some((d) => inside(d, t))
}

export async function safeWriteFile(target: string, data: string | Uint8Array): Promise<void> {
  if (isProtected(target)) {
    throw new Error(
      `For safety, the app does not write this file (${basename(target)} in ${basename(dirname(target)) || dirname(target)}): ` +
        'it belongs to the FoxPro data or the Product Management App. Choose another folder.'
    )
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, data)
}
