/**
 * Proforma invoices from the Product Management App's database (quotations.db, table `proformas`).
 *
 * That database belongs to the other app and may be in use on the product manager's PC. It is never
 * opened in place: the file (and its -wal journal, which holds the newest saves while that app is
 * running) is COPIED into this app's folder and the copy is opened. A copy is taken again only when
 * the source files change. The source is only ever read.
 *
 * On the product manager's PC the database is in
 *   %APPDATA%\Photo Quotation Generator\quotations\quotations.db
 * Share that "quotations" folder (read-only is enough) and choose quotations.db over the network
 * in Settings, e.g. \\PRODUCT-PC\quotations\quotations.db.
 */
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { normInvoiceNo, proformaAmount, type PmaProforma, type ProformaSummary } from '@shared/proforma'
import type { PmaStatus } from '@shared/types'
import type { OpenDb, SqlDb } from './sql'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function sig(path: string): Promise<string> {
  const a = await stat(path)
  const w = await stat(`${path}-wal`).catch(() => null)
  return `${a.size}:${a.mtimeMs}|${w ? `${w.size}:${w.mtimeMs}` : '-'}`
}

export class ProformaSource {
  private db: SqlDb | null = null
  private source = ''
  private sourceSig = ''
  private copiedAt: number | null = null
  private sourceModified: number | null = null
  private lastError = ''

  constructor(private readonly workDir: string, private readonly openDb: OpenDb) {}

  close() {
    this.db?.close()
    this.db = null
  }

  /** Take a fresh copy when the source changed (or force). Throws with a clear message on failure. */
  async refresh(path: string, force = false): Promise<void> {
    if (!path) throw new Error('The Product Management App database is not linked. Choose it in Settings.')
    if (!existsSync(path)) throw new Error(`Cannot reach ${path}. Is the product manager's PC on and the folder shared?`)
    const now = await sig(path)
    if (!force && this.db && path === this.source && now === this.sourceSig) return
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await this.copyAndOpen(path)
        this.lastError = ''
        return
      } catch (e) {
        lastErr = e
        await sleep(250 * (attempt + 1))
      }
    }
    this.lastError = (lastErr as Error)?.message ?? String(lastErr)
    throw new Error(`Could not read the Product Management App database: ${this.lastError}`)
  }

  private async copyAndOpen(path: string) {
    await mkdir(this.workDir, { recursive: true })
    this.close()
    const dest = join(this.workDir, 'pma-copy.db')
    for (const sfx of ['', '-wal', '-shm', '-journal']) await rm(dest + sfx, { force: true })
    const before = await sig(path)
    await copyFile(path, dest)
    if (existsSync(`${path}-wal`)) await copyFile(`${path}-wal`, `${dest}-wal`).catch(() => undefined)
    const after = await sig(path)
    if (before !== after) throw new Error('the database changed while it was being copied')
    const db = this.openDb(dest)
    try {
      const ok = db.prepare('PRAGMA quick_check').get() as Record<string, string> | undefined
      if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('the copy did not pass SQLite’s check')
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'proformas'").get()
      if (!t) throw new Error('this file has no proforma invoices table — is it the Product Management App’s quotations.db?')
    } catch (e) {
      db.close()
      throw e
    }
    this.db = db
    this.source = path
    this.sourceSig = after
    this.copiedAt = Date.now()
    this.sourceModified = (await stat(path)).mtimeMs
  }

  status(path: string): PmaStatus {
    const base: PmaStatus = { configured: !!path, path, ok: false, message: '', proformas: 0, copiedAt: this.copiedAt, sourceModified: this.sourceModified }
    if (!path) return { ...base, message: 'Not linked yet. Choose the Product Management App database in Settings.' }
    if (!this.db || this.source !== path) return { ...base, message: this.lastError || 'Not read yet.' }
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM proformas').get() as { n: number }).n
    return { ...base, ok: true, proformas: n }
  }

  private rows(): { id: string; invoice_no: string; customer_name: string; pf_date: string; updated_at: number; data: string }[] {
    if (!this.db) return []
    return this.db.prepare('SELECT id, invoice_no, customer_name, pf_date, updated_at, data FROM proformas ORDER BY updated_at DESC').all() as never
  }

  list(query = '', limit = 200): ProformaSummary[] {
    const words = query.toUpperCase().split(/\s+/).filter(Boolean)
    const out: ProformaSummary[] = []
    for (const r of this.rows()) {
      const hay = `${r.invoice_no ?? ''} ${r.customer_name ?? ''} ${r.pf_date ?? ''}`.toUpperCase()
      if (!words.every((w) => hay.includes(w))) continue
      let pf: PmaProforma = {}
      try {
        pf = JSON.parse(r.data)
      } catch {
        /* list it anyway */
      }
      out.push({
        id: r.id,
        invoiceNo: r.invoice_no ?? '',
        customerName: r.customer_name ?? '',
        date: r.pf_date ?? '',
        updatedAt: r.updated_at,
        lineCount: pf.lines?.length ?? 0,
        amount: proformaAmount(pf)
      })
      if (out.length >= limit) break
    }
    return out
  }

  get(id: string): PmaProforma | null {
    if (!this.db) return null
    const r = this.db.prepare('SELECT id, data FROM proformas WHERE id = ?').get(id) as { id: string; data: string } | undefined
    if (!r) return null
    const pf = JSON.parse(r.data) as PmaProforma
    return { ...pf, id: r.id }
  }

  /** All proformas with this invoice no (ignoring case and spaces), newest first. */
  findByNo(invoiceNo: string): ProformaSummary[] {
    const want = normInvoiceNo(invoiceNo)
    if (!want) return []
    return this.list('', 100000).filter((p) => normInvoiceNo(p.invoiceNo) === want)
  }
}
