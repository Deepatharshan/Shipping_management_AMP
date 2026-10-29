/**
 * The app's own database (shipments.db in the app-data folder): every commercial invoice with its
 * lines, and a log of every change made in the app or in the FoxPro table. Not disposable: back it up.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { invoiceSums, type CommercialInvoice } from '@shared/invoice'
import type { ChangeEntry, InvoiceSummary } from '@shared/types'
import { packingTotals, type PackingList, type PackingSummary } from '@shared/packing'
import { recordTotals, type RecordSummary, type ShippingRecord } from '@shared/shippingRecord'
import { tx, userVersion, type OpenDb, type SqlDb } from './sql'

const SCHEMA_VERSION = 3

const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

export class ShipStore {
  private db: SqlDb

  constructor(readonly file: string, openDb: OpenDb) {
    mkdirSync(dirname(file), { recursive: true })
    this.db = openDb(file)
    this.db.exec('PRAGMA journal_mode = WAL')
    const v = userVersion(this.db)
    if (v > SCHEMA_VERSION) throw new Error('The shipments database was made by a newer version of the app. Please update the app.')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL, pi_no TEXT, customer TEXT, inv_date TEXT, etd TEXT, eta TEXT,
        vessel TEXT, container TEXT, amount REAL, line_count INTEGER, fox_recno INTEGER,
        created_at INTEGER, updated_at INTEGER, pdf_path TEXT, search TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS invoices_updated ON invoices(updated_at DESC);
      CREATE INDEX IF NOT EXISTS invoices_no ON invoices(invoice_no);
      CREATE TABLE IF NOT EXISTS changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
        invoice_no TEXT NOT NULL, recno INTEGER, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS packing_lists (
        id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL, pi_no TEXT, customer TEXT, pl_date TEXT, vessel TEXT, container TEXT,
        ctns REAL, nett REAL, gross REAL, cbm REAL, line_count INTEGER, invoice_id TEXT,
        created_at INTEGER, updated_at INTEGER, search TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS packing_updated ON packing_lists(updated_at DESC);
      CREATE TABLE IF NOT EXISTS shipping_records (
        id TEXT PRIMARY KEY, month TEXT NOT NULL, report_date TEXT, row_count INTEGER, total REAL,
        created_at INTEGER, updated_at INTEGER, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_month ON shipping_records(month);
    `)
    if (v < SCHEMA_VERSION) this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  close() {
    this.db.close()
  }

  /** Another saved invoice (not `id`) with the same commercial invoice no. */
  duplicateOf(invoiceNo: string, id: string | null): string | null {
    const r = this.db
      .prepare('SELECT id FROM invoices WHERE upper(trim(invoice_no)) = upper(trim(?)) AND id <> ?')
      .get(invoiceNo, id ?? '') as { id: string } | undefined
    return r?.id ?? null
  }

  save(ci: CommercialInvoice, now = Date.now(), pdfPath?: string): CommercialInvoice {
    const id = ci.id ?? randomUUID()
    const doc: CommercialInvoice = { ...ci, id }
    const t = invoiceSums(doc)
    const customer = doc.fox.custName || doc.consignee.split('\n')[0] || ''
    const search = fold(
      [doc.invoiceNo, doc.piNo, customer, doc.consignee, doc.vessel, doc.containerNo, doc.sealNo, doc.asnNo, doc.poNo, doc.date, doc.pod,
        ...doc.lines.map((l) => `${l.ourItem} ${l.yourItemNo}`)].join(' ')
    )
    tx(this.db, () => {
      const existing = this.db.prepare('SELECT created_at, pdf_path FROM invoices WHERE id = ?').get(id) as
        | { created_at: number; pdf_path: string | null }
        | undefined
      this.db
        .prepare(
          `INSERT INTO invoices (id, invoice_no, pi_no, customer, inv_date, etd, eta, vessel, container, amount, line_count, fox_recno,
             created_at, updated_at, pdf_path, search, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET invoice_no = excluded.invoice_no, pi_no = excluded.pi_no, customer = excluded.customer,
             inv_date = excluded.inv_date, etd = excluded.etd, eta = excluded.eta, vessel = excluded.vessel, container = excluded.container,
             amount = excluded.amount, line_count = excluded.line_count, fox_recno = excluded.fox_recno, updated_at = excluded.updated_at,
             pdf_path = excluded.pdf_path, search = excluded.search, data = excluded.data`
        )
        .run(id, doc.invoiceNo.trim(), doc.piNo, customer, doc.date, doc.etd, doc.eta, doc.vessel, doc.containerNo, t.total, doc.lines.length,
          doc.foxRecno, existing?.created_at ?? now, now, pdfPath ?? existing?.pdf_path ?? null, search, JSON.stringify(doc))
    })
    return doc
  }

  setPdfPath(id: string, pdfPath: string) {
    this.db.prepare('UPDATE invoices SET pdf_path = ? WHERE id = ?').run(pdfPath, id)
  }

  get(id: string): CommercialInvoice | null {
    const r = this.db.prepare('SELECT data FROM invoices WHERE id = ?').get(id) as { data: string } | undefined
    return r ? (JSON.parse(r.data) as CommercialInvoice) : null
  }

  /** The saved invoice linked to a FoxPro record, if any. */
  byRecno(recno: number): string | null {
    const r = this.db.prepare('SELECT id FROM invoices WHERE fox_recno = ? ORDER BY updated_at DESC').get(recno) as { id: string } | undefined
    return r?.id ?? null
  }

  linkedRecnos(): Map<number, string> {
    const rows = this.db.prepare('SELECT id, fox_recno FROM invoices WHERE fox_recno IS NOT NULL').all() as { id: string; fox_recno: number }[]
    return new Map(rows.map((r) => [r.fox_recno, r.id]))
  }

  list(query = '', limit = 1000): InvoiceSummary[] {
    const words = fold(query).split(' ').filter(Boolean)
    const where = words.map(() => "search LIKE ? ESCAPE '!'").join(' AND ')
    const rows = this.db
      .prepare(
        `SELECT id, invoice_no, pi_no, customer, inv_date, etd, eta, vessel, container, amount, line_count, fox_recno, updated_at, pdf_path
         FROM invoices ${where ? `WHERE ${where}` : ''} ORDER BY updated_at DESC LIMIT ?`
      )
      .all(...words.map((w) => `%${w.replace(/[!%_]/g, (c) => '!' + c)}%`), limit) as Record<string, unknown>[]
    return rows.map(toSummary)
  }

  delete(id: string) {
    this.db.prepare('DELETE FROM invoices WHERE id = ?').run(id)
  }

  log(e: Omit<ChangeEntry, 'id'>) {
    this.db
      .prepare('INSERT INTO changes (at, action, target, invoice_no, recno, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.at, e.action, e.target, e.invoiceNo, e.recno, JSON.stringify(e.detail))
  }

  changes(limit = 500): ChangeEntry[] {
    return (this.db.prepare('SELECT * FROM changes ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      at: r.at as number,
      action: r.action as ChangeEntry['action'],
      target: r.target as ChangeEntry['target'],
      invoiceNo: r.invoice_no as string,
      recno: (r.recno as number | null) ?? null,
      detail: JSON.parse(r.detail as string)
    }))
  }

  stats(monthStart: number) {
    const one = <T>(sql: string, ...a: unknown[]) => this.db.prepare(sql).get(...a) as T
    const month = monthStart
    const ym = new Date(month)
    const prefix = `${ym.getFullYear()}-${String(ym.getMonth() + 1).padStart(2, '0')}`
    return {
      invoices: one<{ n: number }>('SELECT COUNT(*) AS n FROM invoices').n,
      thisMonth: one<{ n: number }>('SELECT COUNT(*) AS n FROM invoices WHERE inv_date LIKE ?', `${prefix}%`).n,
      amountThisMonth: one<{ s: number | null }>('SELECT SUM(amount) AS s FROM invoices WHERE inv_date LIKE ?', `${prefix}%`).s ?? 0,
      amountTotal: one<{ s: number | null }>('SELECT SUM(amount) AS s FROM invoices').s ?? 0,
      inFoxPro: one<{ n: number }>('SELECT COUNT(*) AS n FROM invoices WHERE fox_recno IS NOT NULL').n
    }
  }

  /** Shipments by ETD for the dashboard timeline: from `fromIso`, earliest first. */
  timeline(fromIso: string, limit = 12): InvoiceSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, invoice_no, pi_no, customer, inv_date, etd, eta, vessel, container, amount, line_count, fox_recno, updated_at, pdf_path
         FROM invoices WHERE (eta >= ? OR etd >= ?) ORDER BY etd ASC LIMIT ?`
      )
      .all(fromIso, fromIso, limit) as Record<string, unknown>[]
    return rows.map(toSummary)
  }

  /**
   * Barcodes typed on earlier invoices, by "your item no|our item no" (newest wins), so a new invoice
   * for the same items fills them in.
   */
  barcodes(): Record<string, string> {
    const out: Record<string, string> = {}
    const rows = this.db.prepare('SELECT data FROM invoices ORDER BY updated_at ASC').all() as { data: string }[]
    for (const r of rows) {
      try {
        for (const l of (JSON.parse(r.data) as CommercialInvoice).lines ?? [])
          if (l.barcode?.trim()) out[barcodeKey(l.yourItemNo, l.ourItem)] = l.barcode.trim()
      } catch {
        /* skip a damaged row */
      }
    }
    return out
  }

  // ---------- packing / weight lists ----------

  /** Another saved packing list (not `id`) for the same commercial invoice no. */
  packingDuplicateOf(invoiceNo: string, id: string | null): string | null {
    const r = this.db
      .prepare('SELECT id FROM packing_lists WHERE upper(trim(invoice_no)) = upper(trim(?)) AND id <> ?')
      .get(invoiceNo, id ?? '') as { id: string } | undefined
    return r?.id ?? null
  }

  packingSave(pl: PackingList, now = Date.now()): PackingList {
    const id = pl.id ?? randomUUID()
    const doc: PackingList = { ...pl, id }
    const t = packingTotals(doc.lines)
    const customer = doc.consignee.split('\n')[0] || ''
    const search = fold(
      [doc.invoiceNo, doc.piNo, doc.consignee, doc.vessel, doc.containerNo, doc.sealNo, doc.asnNo, doc.poNo, doc.date,
        ...doc.lines.map((l) => `${l.itemNo} ${l.customerItemNo}`)].join(' ')
    )
    tx(this.db, () => {
      const existing = this.db.prepare('SELECT created_at FROM packing_lists WHERE id = ?').get(id) as { created_at: number } | undefined
      this.db
        .prepare(
          `INSERT INTO packing_lists (id, invoice_no, pi_no, customer, pl_date, vessel, container, ctns, nett, gross, cbm, line_count, invoice_id,
             created_at, updated_at, search, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET invoice_no = excluded.invoice_no, pi_no = excluded.pi_no, customer = excluded.customer,
             pl_date = excluded.pl_date, vessel = excluded.vessel, container = excluded.container, ctns = excluded.ctns, nett = excluded.nett,
             gross = excluded.gross, cbm = excluded.cbm, line_count = excluded.line_count, invoice_id = excluded.invoice_id,
             updated_at = excluded.updated_at, search = excluded.search, data = excluded.data`
        )
        .run(id, doc.invoiceNo.trim(), doc.piNo, customer, doc.date, doc.vessel, doc.containerNo, t.ctns, t.nett, t.gross, t.cbm,
          doc.lines.length, doc.invoiceId, existing?.created_at ?? now, now, search, JSON.stringify(doc))
    })
    return doc
  }

  packingGet(id: string): PackingList | null {
    const r = this.db.prepare('SELECT data FROM packing_lists WHERE id = ?').get(id) as { data: string } | undefined
    return r ? (JSON.parse(r.data) as PackingList) : null
  }

  packingList(query = '', limit = 1000): PackingSummary[] {
    const words = fold(query).split(' ').filter(Boolean)
    const where = words.map(() => "search LIKE ? ESCAPE '!'").join(' AND ')
    const rows = this.db
      .prepare(
        `SELECT id, invoice_no, pi_no, customer, pl_date, vessel, container, ctns, nett, gross, cbm, line_count, invoice_id, updated_at
         FROM packing_lists ${where ? `WHERE ${where}` : ''} ORDER BY updated_at DESC LIMIT ?`
      )
      .all(...words.map((w) => `%${w.replace(/[!%_]/g, (c) => '!' + c)}%`), limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      invoiceNo: (r.invoice_no as string) ?? '',
      piNo: (r.pi_no as string) ?? '',
      customer: (r.customer as string) ?? '',
      date: (r.pl_date as string) ?? '',
      vessel: (r.vessel as string) ?? '',
      containerNo: (r.container as string) ?? '',
      ctns: (r.ctns as number) ?? 0,
      nett: (r.nett as number) ?? 0,
      gross: (r.gross as number) ?? 0,
      cbm: (r.cbm as number) ?? 0,
      lineCount: (r.line_count as number) ?? 0,
      invoiceId: (r.invoice_id as string | null) ?? null,
      updatedAt: r.updated_at as number
    }))
  }

  packingDelete(id: string) {
    this.db.prepare('DELETE FROM packing_lists WHERE id = ?').run(id)
  }

  // ---------- monthly shipping records ----------

  /** The saved record (not `id`) for the same month. */
  recordForMonth(month: string, id: string | null = null): string | null {
    const r = this.db.prepare('SELECT id FROM shipping_records WHERE month = ? AND id <> ?').get(month, id ?? '') as { id: string } | undefined
    return r?.id ?? null
  }

  recordSave(rec: ShippingRecord, now = Date.now()): ShippingRecord {
    const id = rec.id ?? randomUUID()
    const doc: ShippingRecord = { ...rec, id }
    const t = recordTotals(doc.rows)
    tx(this.db, () => {
      const existing = this.db.prepare('SELECT created_at FROM shipping_records WHERE id = ?').get(id) as { created_at: number } | undefined
      this.db
        .prepare(
          `INSERT INTO shipping_records (id, month, report_date, row_count, total, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET month = excluded.month, report_date = excluded.report_date, row_count = excluded.row_count,
             total = excluded.total, updated_at = excluded.updated_at, data = excluded.data`
        )
        .run(id, doc.month, doc.reportDate, doc.rows.length, t.total, existing?.created_at ?? now, now, JSON.stringify(doc))
    })
    return doc
  }

  recordGet(id: string): ShippingRecord | null {
    const r = this.db.prepare('SELECT data FROM shipping_records WHERE id = ?').get(id) as { data: string } | undefined
    return r ? (JSON.parse(r.data) as ShippingRecord) : null
  }

  recordList(): RecordSummary[] {
    return (this.db.prepare('SELECT id, month, report_date, row_count, total, updated_at FROM shipping_records ORDER BY month DESC').all() as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      month: r.month as string,
      reportDate: (r.report_date as string) ?? '',
      rowCount: (r.row_count as number) ?? 0,
      total: (r.total as number) ?? 0,
      updatedAt: r.updated_at as number
    }))
  }

  recordDelete(id: string) {
    this.db.prepare('DELETE FROM shipping_records WHERE id = ?').run(id)
  }

  /** A consistent copy of the database for a backup (VACUUM INTO works on both SQLite drivers). */
  backupTo(dest: string) {
    this.db.prepare('VACUUM INTO ?').run(dest)
  }
}

export const barcodeKey = (yourItemNo: string, ourItem: string) => `${yourItemNo.trim().toUpperCase()}|${ourItem.trim().toUpperCase()}`

function toSummary(r: Record<string, unknown>): InvoiceSummary {
  return {
    id: r.id as string,
    invoiceNo: (r.invoice_no as string) ?? '',
    piNo: (r.pi_no as string) ?? '',
    customer: (r.customer as string) ?? '',
    date: (r.inv_date as string) ?? '',
    etd: (r.etd as string) ?? '',
    eta: (r.eta as string) ?? '',
    vessel: (r.vessel as string) ?? '',
    containerNo: (r.container as string) ?? '',
    amount: (r.amount as number) ?? 0,
    lineCount: (r.line_count as number) ?? 0,
    foxRecno: (r.fox_recno as number | null) ?? null,
    updatedAt: r.updated_at as number,
    pdfPath: (r.pdf_path as string | null) ?? null
  }
}
