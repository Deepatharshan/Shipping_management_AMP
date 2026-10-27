/**
 * Proforma invoices as the Product Management App saves them (its quotations.db, table `proformas`,
 * column `data` = this JSON). Only the parts the shipping app uses are declared; the rest is ignored.
 * This app only READS that database (from a copy, see main/proformaSource.ts).
 */
import { blankLine, computeCtns, lineTotal, newInvoice, type CiDefaults, type CiLine, type CiUnit, type CommercialInvoice } from './invoice'

export interface PmaCustomer {
  code?: string
  name?: string
  street1?: string
  street2?: string
  city?: string
  country?: string
  phone?: string
  email?: string
  attention?: string
}

export interface PmaProformaLine {
  id?: string
  yourItemNo?: string
  ourItem?: string
  ourFactory?: string
  colorCode?: string
  description?: string
  pcsCtn?: string
  noCtns?: string
  qty?: string
  unit?: string
  price?: string
  total?: string
  cft?: string
}

export interface PmaProforma {
  id?: string | null
  header?: { invoiceNo?: string; date?: string; customer?: PmaCustomer; ref?: string }
  lines?: PmaProformaLine[]
  page2?: { container?: string; fromPort?: string; toPort?: string; latestShipment?: string }
}

export interface ProformaSummary {
  id: string
  invoiceNo: string
  customerName: string
  date: string
  updatedAt: number
  lineCount: number
  amount: number
}

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Same invoice number? Ignores case, spaces and the separators people type differently. */
export const sameInvoiceNo = (a: string, b: string) => normInvoiceNo(a) === normInvoiceNo(b)
export const normInvoiceNo = (v: string) => v.toUpperCase().replace(/[\s]+/g, '')

/** The customer block as printed after "To : M/S." */
export function consigneeText(c: PmaCustomer | undefined): string {
  if (!c) return ''
  const lines = [s(c.name), s(c.street1), s(c.street2), s(c.city), s(c.country)].map((x) => x.trim()).filter(Boolean)
  return lines.join('\n')
}

/**
 * The description of a proforma line is "description + size", a newline, then the packing with
 * "(APX. 5.31CFT)". The invoice prints the description and the packing on separate rows, without CFT.
 */
export function splitDescription(text: string): { description: string; packing: string } {
  const rows = s(text).split(/\r?\n/).map((r) => r.trim()).filter(Boolean)
  const description = rows[0] ?? ''
  const packing = rows
    .slice(1)
    .join(' ')
    .replace(/\(?\s*APX\.?\s*[\d.]+\s*CFT\s*\)?/i, '')
    .trim()
  return { description, packing }
}

const unitOf = (u: string | undefined): CiUnit => (u === 'DOZ' || u === 'SETS' ? u : 'PCS')

/** "(AMP/KAT)" → "(AMP)": the invoice prints the company, not the factory. */
export function factoryLabel(f: string | undefined, fallback: string): string {
  const v = s(f).trim()
  if (!v) return fallback
  const m = /^\(?\s*([A-Z0-9]+)/i.exec(v)
  return m ? `(${m[1].toUpperCase()})` : fallback
}

export function invoiceLineFromProforma(l: PmaProformaLine, d: CiDefaults): CiLine {
  const { description, packing } = splitDescription(s(l.description))
  const qty = s(l.qty).trim()
  const price = s(l.price).trim()
  const pcsCtn = s(l.pcsCtn).trim()
  const base = blankLine(d)
  return {
    ...base,
    sourceId: l.id ?? null,
    yourItemNo: s(l.yourItemNo).trim(),
    ourItem: s(l.ourItem).trim(),
    factory: factoryLabel(l.ourFactory, d.factory),
    description,
    packing,
    colour: s(l.colorCode).trim(),
    pcsCtn,
    ctns: s(l.noCtns).trim() || computeCtns(qty, pcsCtn),
    qty,
    unit: unitOf(l.unit),
    price,
    total: s(l.total).trim() || (qty && price ? lineTotal({ qty, price }) : ''),
    totalEdited: false
  }
}

/** The container from the proforma ("1X40HQ CONTAINER") in the FoxPro form ("01X40HQ"). */
export function containerSize(text: string): string {
  const m = /(\d+)\s*X\s*(\d+)\s*([A-Z]{2})?/i.exec(s(text))
  if (!m) return ''
  return `${m[1].padStart(2, '0')}X${m[2]}${(m[3] ?? '').toUpperCase()}`
}

/**
 * A commercial invoice from a proforma. When `keep` is given (fetching again into an invoice the user
 * has started), everything typed by hand is kept; only what comes from the proforma is replaced.
 */
export function invoiceFromProforma(pf: PmaProforma, d: CiDefaults, keep?: CommercialInvoice): CommercialInvoice {
  const base = keep ?? newInvoice(d)
  const h = pf.header ?? {}
  const c = h.customer ?? {}
  const p2 = pf.page2 ?? {}
  const piNo = s(h.invoiceNo).trim()
  const toPort = s(p2.toPort).trim().toUpperCase()
  return {
    ...base,
    piNo,
    piId: pf.id ?? null,
    piLabel: piNo,
    consignee: consigneeText(c),
    pod: toPort || base.pod,
    lines: (pf.lines ?? []).map((l) => invoiceLineFromProforma(l, d)),
    fox: {
      ...base.fox,
      custCode: s(c.code).trim(),
      custName: s(c.name).trim(),
      street1: s(c.street1).trim(),
      street2: s(c.street2).trim(),
      city: s(c.city).trim(),
      country: s(c.country).trim(),
      contSize: base.fox.contSize || containerSize(s(p2.container)),
      portDel: base.fox.portDel || toPort,
      desGoods: base.fox.desGoods || d.goodsTitle
    }
  }
}

export function proformaAmount(pf: PmaProforma): number {
  let t = 0
  for (const l of pf.lines ?? []) {
    const n = Number(String(l.total ?? '').replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(n)) t += n
  }
  return Math.round(t * 100) / 100
}
