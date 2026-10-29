/**
 * The monthly shipping record ("Shipping Record for the Month of September 2026"): one row per
 * commercial invoice shipped that month. A row is filled from the saved invoice (or the FoxPro table)
 * when its number is typed; CUSDEC, the US$ rate, BL/ETA and the ports are typed by hand. Every value
 * stays editable.
 *
 *   TOTAL AMT$     invoice total before the discount           2,184.36
 *   AMOUNT         what the factory gets (after the discount)  2,007.36   under FAC (AMP / AMP-1 / AMP-2)
 *   COMM/DISC/VAT  the discount / commission                     177.00
 *   value in Rs    TOTAL AMT$ × US$ RATE                       727,545.44
 */
import { invoiceSums, num, type CommercialInvoice } from './invoice'

export const FACTORIES = ['AMP', 'AMP-1', 'AMP-2'] as const
export type Factory = (typeof FACTORIES)[number]

export interface RecordRow {
  id: string
  /** the saved app invoice it came from (null: FoxPro or typed by hand) */
  invoiceId: string | null
  source: 'app' | 'foxpro' | 'manual'
  invoiceNo: string // INV.NR  M/26/015
  invDate: string // YYYY-MM-DD
  cmbRefNo: string // 26015/M
  orderNo: string // 60704/M/S (the PI / order no)
  customer: string // SCHWARTINSKY GMBH
  notify: string // second name line (consignee)
  totalAmt: string // 2184.36
  creditTo: string // CRD TO  AMP
  cbm: string // TTL CBM 1.60 (also printed under CBM)
  volume: string // LCL, 01X40HQ …
  line: string // ONE TEAM
  vessel: string // OOCL NAGOYA
  totFreight: string // TOT FRT 0.00
  factory: Factory
  amount: string // 2007.36
  freight: string
  freightTo: string // TO  CUS
  commDiscVat: string // 177.00
  usRate: string // 333.0703
  cusdecNo: string
  cusdecDate: string
  payTerms: string
  blDate: string // BL/ETA  28/09/2026 - 20/10/2026
  eta: string
  portDischarge: string // HAMBURG
  portDelivery: string // HAMBURG,GERMANY
}

export interface ShippingRecord {
  id: string | null
  month: string // YYYY-MM
  reportDate: string // YYYY-MM-DD
  rows: RecordRow[]
}

export interface RecordSummary {
  id: string
  month: string
  reportDate: string
  rowCount: number
  total: number
  updatedAt: number
}

let seq = 0
const rowId = () => `r${Date.now().toString(36)}-${(seq = (seq + 1) % 1e6).toString(36)}`

const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function newRecord(month = ymd().slice(0, 7), reportDate = ymd()): ShippingRecord {
  return { id: null, month, reportDate, rows: [] }
}

export function blankRow(invoiceNo = ''): RecordRow {
  return {
    id: rowId(), invoiceId: null, source: 'manual', invoiceNo, invDate: '', cmbRefNo: '', orderNo: '', customer: '', notify: '',
    totalAmt: '', creditTo: 'AMP', cbm: '', volume: '', line: '', vessel: '', totFreight: '0.00', factory: 'AMP', amount: '',
    freight: '', freightTo: '', commDiscVat: '', usRate: '', cusdecNo: '', cusdecDate: '', payTerms: '', blDate: '', eta: '',
    portDischarge: '', portDelivery: ''
  }
}

const m2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

/** A row from a commercial invoice (saved in the app, or opened from FoxPro). `cbm` comes from its packing list. */
export function rowFromInvoice(ci: CommercialInvoice, cbm = '', source: RecordRow['source'] = 'app'): RecordRow {
  const s = invoiceSums(ci)
  const firstLine = ci.consignee.split(/\r?\n/)[0]?.trim() ?? ''
  const country = ci.fox.country.trim()
  const delivery = ci.fox.portDel.trim() || ci.pod.trim()
  return {
    ...blankRow(ci.invoiceNo),
    invoiceId: source === 'app' ? ci.id : null,
    source,
    invDate: ci.date,
    cmbRefNo: ci.fox.cmbRefNo.trim(),
    orderNo: (ci.piNo || ci.poNo).trim(),
    customer: ci.fox.custName.trim() || firstLine,
    notify: firstLine,
    totalAmt: ci.lines.length ? m2(s.subtotal) : '',
    creditTo: ci.fox.creditTo.trim() || 'AMP',
    cbm,
    volume: ci.fox.contSize.trim(),
    line: ci.fox.shipLine.trim(),
    vessel: ci.vessel.trim(),
    amount: ci.lines.length ? m2(s.total) : '',
    commDiscVat: s.hasDiscount ? m2(s.discount) : '',
    payTerms: ci.paymentTerms.trim(),
    blDate: ci.fox.billLading || ci.etd,
    eta: ci.eta,
    portDischarge: ci.pod.trim(),
    portDelivery: delivery && country && !delivery.toUpperCase().includes(country.toUpperCase()) ? `${delivery},${country}` : delivery
  }
}

/** Rupee value of a row: TOTAL AMT$ × US$ RATE (0 until the rate is typed). */
export const rupees = (r: Pick<RecordRow, 'totalAmt' | 'usRate'>) => Math.round(num(r.totalAmt) * num(r.usRate) * 100) / 100

export interface RecordTotals {
  total: number
  byFactory: Record<Factory, number>
  freight: number
  commDiscVat: number
  rupees: number
}

export function recordTotals(rows: RecordRow[]): RecordTotals {
  const byFactory = { AMP: 0, 'AMP-1': 0, 'AMP-2': 0 } as Record<Factory, number>
  let total = 0
  let freight = 0
  let commDiscVat = 0
  let rs = 0
  for (const r of rows) {
    total += num(r.totalAmt)
    byFactory[FACTORIES.includes(r.factory) ? r.factory : 'AMP'] += num(r.amount)
    freight += num(r.totFreight)
    commDiscVat += num(r.commDiscVat)
    rs += rupees(r)
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  return {
    total: r2(total),
    byFactory: { AMP: r2(byFactory.AMP), 'AMP-1': r2(byFactory['AMP-1']), 'AMP-2': r2(byFactory['AMP-2']) },
    freight: r2(freight),
    commDiscVat: r2(commDiscVat),
    rupees: r2(rs)
  }
}

/** "2026-09" → "September 2026" */
export function monthTitle(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return month
  return `${new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleString('en-US', { month: 'long' })} ${m[1]}`
}

export function checkRecord(x: unknown): asserts x is ShippingRecord {
  const r = x as ShippingRecord
  if (!r || typeof r !== 'object' || !Array.isArray(r.rows) || typeof r.month !== 'string') throw new Error('Not a shipping record.')
}

export function normalizeRecord(r: ShippingRecord): ShippingRecord {
  return { ...newRecord(r.month, r.reportDate), ...r, rows: Array.isArray(r.rows) ? r.rows.map((x) => ({ ...blankRow(), ...x })) : [] }
}
