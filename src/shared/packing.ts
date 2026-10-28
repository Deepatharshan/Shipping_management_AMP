/**
 * The packing / weight list: the same shipment as a commercial invoice, printed with cartons, units,
 * weights and carton sizes instead of prices. It starts from a proforma invoice (items) and/or a saved
 * commercial invoice (invoice no, vessel, container …). Weights and carton sizes are typed by hand.
 *
 * CBM of a line = length × width × height (cm) ÷ 1,000,000 × cartons
 *   e.g. 52.50 × 35.00 × 45.00 cm, 136 cartons → 0.0826875 × 136 = 11.25
 * Total nett / gross weight = Σ (weight per carton × cartons).
 */
import { invoiceSums, lineId, num, todayIso, unitWord, type CiDefaults, type CiLine, type CommercialInvoice, type CiUnit, DEFAULT_CI } from './invoice'

export interface PlLine {
  id: string
  /** proforma / invoice line this came from (null when typed by hand) */
  sourceId: string | null
  itemNo: string // our item no  Y39AZPE44/E035 SPHC
  colour: string // PEACH
  customerItemNo: string // 161930493
  ctnNo: string // carton numbers 046-181
  packing: string // 2/ 12  (pieces per box / pieces per carton)
  ctns: string // 136
  units: string // 1632
  unit: CiUnit
  nettCtn: string // kg per carton 3.3
  grossCtn: string // 6.1
  length: string // cm 52.50
  width: string // 35.00
  height: string // 45.00
  /** typed over the automatic value when cbmEdited */
  cbm: string
  cbmEdited: boolean
}

export interface PackingList {
  id: string | null
  /** the saved commercial invoice it was made from, if any */
  invoiceId: string | null
  piNo: string
  piId: string | null
  invoiceNo: string
  date: string
  consignee: string
  shippingMarks: string
  vessel: string
  voyage: string
  etd: string
  eta: string
  containerNo: string
  sealNo: string
  paymentTerms: string
  asnNo: string
  // the PI block
  goodsTitle: string
  piLabel: string
  poNo: string
  pod: string
  type: string
  currency: string
  /** printed under AMOUNT; blank = taken from the invoice / proforma when fetched */
  amount: string
  incoterms: string
  terms: string
  lines: PlLine[]
}

export function newPackingList(d: CiDefaults = DEFAULT_CI, date = todayIso()): PackingList {
  return {
    id: null, invoiceId: null, piNo: '', piId: null, invoiceNo: '', date, consignee: '', shippingMarks: '',
    vessel: '', voyage: '', etd: '', eta: '', containerNo: '', sealNo: '', paymentTerms: d.paymentTerms, asnNo: '',
    goodsTitle: d.goodsTitle, piLabel: '', poNo: '', pod: '', type: d.type, currency: d.currency, amount: '',
    incoterms: d.incoterms, terms: d.terms, lines: []
  }
}

export function blankPlLine(): PlLine {
  return {
    id: lineId(), sourceId: null, itemNo: '', colour: '', customerItemNo: '', ctnNo: '', packing: '', ctns: '', units: '', unit: 'PCS',
    nettCtn: '', grossCtn: '', length: '', width: '', height: '', cbm: '', cbmEdited: false
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** CBM of one line, from the carton size and the number of cartons ('' when something is missing). */
export function autoCbm(l: Pick<PlLine, 'length' | 'width' | 'height' | 'ctns'>): string {
  const v = (num(l.length) * num(l.width) * num(l.height)) / 1e6
  const c = num(l.ctns)
  if (!v || !c) return ''
  return round2(v * c).toFixed(2)
}

export const lineCbm = (l: PlLine): number => num(l.cbmEdited ? l.cbm : autoCbm(l))

/** "2 pc/box,12 pcs/ctn." → "2/ 12"; only pieces per carton → "12". */
export function packingCode(packing: string, pcsCtn = ''): string {
  const box = /(\d+(?:\.\d+)?)\s*pcs?\s*\/\s*box/i.exec(packing)
  const ctn = /(\d+(?:\.\d+)?)\s*pcs?\s*\/\s*ctn/i.exec(packing)
  const perCtn = ctn?.[1] ?? pcsCtn.trim()
  if (box && perCtn) return `${box[1]}/ ${perCtn}`
  return perCtn
}

/** "Y39AZPE44/E035 S" + colour "PEACH-PN/40+B/251" → colour printed "PEACH". */
const colourName = (c: string) => {
  const t = c.trim()
  const i = t.indexOf('-')
  return i > 0 ? t.slice(0, i) : t
}

export function plLineFromInvoiceLine(l: CiLine): PlLine {
  return {
    ...blankPlLine(),
    sourceId: l.sourceId ?? l.id,
    itemNo: l.ourItem,
    colour: colourName(l.colour),
    customerItemNo: l.yourItemNo,
    packing: packingCode(l.packing, l.pcsCtn),
    ctns: l.ctns,
    units: l.qty,
    unit: l.unit
  }
}

const lineKey = (l: { customerItemNo: string; itemNo: string }) => `${l.customerItemNo.trim().toUpperCase()}|${l.itemNo.trim().toUpperCase()}`

/**
 * New lines from an invoice / proforma, keeping what was typed by hand on the old lines of the same
 * item (carton numbers, weights, sizes, a typed CBM).
 */
export function mergeLines(fresh: PlLine[], old: PlLine[]): PlLine[] {
  const byKey = new Map(old.map((l) => [lineKey(l), l]))
  return fresh.map((n) => {
    const o = byKey.get(lineKey(n))
    if (!o) return n
    return { ...n, ctnNo: o.ctnNo || n.ctnNo, nettCtn: o.nettCtn, grossCtn: o.grossCtn, length: o.length, width: o.width, height: o.height, cbm: o.cbm, cbmEdited: o.cbmEdited }
  })
}

const invoiceAmount = (ci: CommercialInvoice) => invoiceSums(ci).total

/** Every shipment detail and item from a saved commercial invoice. Hand-typed weights and sizes are kept. */
export function packingFromInvoice(ci: CommercialInvoice, base: PackingList): PackingList {
  return {
    ...base,
    invoiceId: ci.id,
    piNo: ci.piNo || base.piNo,
    piId: ci.piId ?? base.piId,
    invoiceNo: ci.invoiceNo,
    date: ci.date || base.date,
    consignee: ci.consignee,
    shippingMarks: ci.shippingMarks || base.shippingMarks,
    vessel: ci.vessel,
    voyage: ci.voyage,
    etd: ci.etd,
    eta: ci.eta,
    containerNo: ci.containerNo,
    sealNo: ci.sealNo,
    paymentTerms: ci.paymentTerms,
    asnNo: ci.asnNo,
    goodsTitle: ci.goodsTitle,
    piLabel: ci.piLabel || ci.piNo,
    poNo: ci.poNo,
    pod: ci.pod,
    type: ci.type,
    currency: ci.currency,
    amount: invoiceAmount(ci).toFixed(2),
    incoterms: ci.incoterms,
    terms: ci.terms,
    lines: mergeLines(ci.lines.map(plLineFromInvoiceLine), base.lines)
  }
}

/** The items, customer and port from a proforma (already turned into a commercial invoice). */
export function packingFromProforma(fromPi: CommercialInvoice, base: PackingList): PackingList {
  return {
    ...base,
    piNo: fromPi.piNo,
    piId: fromPi.piId,
    piLabel: base.piLabel || fromPi.piLabel,
    consignee: fromPi.consignee || base.consignee,
    pod: fromPi.pod || base.pod,
    amount: invoiceAmount(fromPi).toFixed(2),
    lines: mergeLines(fromPi.lines.map(plLineFromInvoiceLine), base.lines)
  }
}

/** Carton numbers one after the other from `start`: 001-136, 137-261 … (lines without cartons are left as they are). */
export function numberCartons(lines: PlLine[], start = 1): PlLine[] {
  let n = start
  const pad = (x: number) => String(x).padStart(3, '0')
  return lines.map((l) => {
    const c = Math.round(num(l.ctns))
    if (c <= 0) return l
    const from = n
    n += c
    return { ...l, ctnNo: c === 1 ? pad(from) : `${pad(from)}-${pad(from + c - 1)}` }
  })
}

export interface PlTotals {
  ctns: number
  byUnit: { unit: CiUnit; qty: number }[]
  nett: number
  gross: number
  difference: number
  cbm: number
}

export function packingTotals(lines: PlLine[]): PlTotals {
  let ctns = 0
  let nett = 0
  let gross = 0
  let cbm = 0
  const by = new Map<CiUnit, number>()
  for (const l of lines) {
    const c = num(l.ctns)
    ctns += c
    nett += num(l.nettCtn) * c
    gross += num(l.grossCtn) * c
    cbm += lineCbm(l)
    if (l.units.trim()) by.set(l.unit, (by.get(l.unit) ?? 0) + num(l.units))
  }
  return {
    ctns: round2(ctns),
    byUnit: (['PCS', 'DOZ', 'SETS'] as CiUnit[]).filter((u) => by.has(u)).map((u) => ({ unit: u, qty: by.get(u)! })),
    nett: round2(nett),
    gross: round2(gross),
    difference: round2(gross - nett),
    cbm: round2(cbm)
  }
}

export const unitsText = (l: Pick<PlLine, 'units' | 'unit'>) => (l.units.trim() ? `${l.units.trim()} ${unitWord(l.unit, true)}` : '')

/** "52.5" "35" "45" → "52.50x 35.00x 45.00" */
export function measureText(l: Pick<PlLine, 'length' | 'width' | 'height'>): string {
  const parts = [l.length, l.width, l.height].map((v) => (v.trim() ? num(v).toFixed(2) : ''))
  return parts.some(Boolean) ? parts.join('x ') : ''
}

export function checkPackingList(x: unknown): asserts x is PackingList {
  const p = x as PackingList
  if (!p || typeof p !== 'object' || !Array.isArray(p.lines) || typeof p.invoiceNo !== 'string') throw new Error('Not a packing list.')
}

/** Fill fields an older version did not have. */
export function normalizePackingList(p: PackingList, d: CiDefaults = DEFAULT_CI): PackingList {
  const base = newPackingList(d, p.date)
  return { ...base, ...p, lines: Array.isArray(p.lines) ? p.lines.map((l) => ({ ...blankPlLine(), ...l })) : [] }
}

export interface PackingSummary {
  id: string
  invoiceNo: string
  piNo: string
  customer: string
  date: string
  vessel: string
  containerNo: string
  ctns: number
  nett: number
  gross: number
  cbm: number
  lineCount: number
  invoiceId: string | null
  updatedAt: number
}

