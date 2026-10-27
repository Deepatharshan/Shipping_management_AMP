/**
 * A commercial invoice (the shipping report) as the user edits it. Every printed value is plain text
 * the user can change. Values fetched from a proforma invoice are only the starting point.
 *
 * Page 1: exporter + consignee + shipment block, the PI block and the item table.
 * Last page: totals, amount in words, shipping marks, order reference, the certificate, the HS note
 * and the beneficiary / bank blocks. The header (company, invoice no, consignee, vessel …, ASN no and
 * the column titles) repeats on every page.
 */

export type CiUnit = 'PCS' | 'DOZ' | 'SETS'
export const CI_UNITS: CiUnit[] = ['PCS', 'DOZ', 'SETS']

export interface CiLine {
  id: string
  /** proforma line this came from (null when typed by hand) */
  sourceId: string | null
  yourItemNo: string // 161930493
  ourItem: string // Y39AZPE44/E035 S
  factory: string // (AMP)
  description: string // MIX ROSE & POM POM IN WOVEN VASE 18X18X20CM H
  packing: string // 2 pc/box,12 pcs/ctn.
  hsCode: string // 6702
  colour: string // PEACH-PN/40+B/251+B/252  (printed split at the first "-" when long)
  barcode: string // 6292467281823 (printed as BARCODE#…)
  pcsCtn: string // pieces per carton (helper for the carton count, not printed)
  ctns: string // 136
  qty: string // 1632
  unit: CiUnit
  price: string // 4.12
  total: string // 6723.84 (qty × price unless typed over)
  totalEdited: boolean
}

/** Fields kept only for the FoxPro shipping table (not printed on the invoice). */
export interface FoxExtra {
  cmbRefNo: string // CMB_REF_NO 23004/M
  custCode: string // CUST_CODE
  custName: string // CUST_NAME
  street1: string
  street2: string
  city: string
  country: string
  shipTerms: string // SHIP_TERMS  FOB COLOMBO
  shipLine: string // SHIP_LINE  MAERSK LANKA
  contNo2: string // CONT_NO_2
  contSize: string // CONT_SIZE 01X40HQ
  conType: string // CON_TYPE HQ
  conHeight: string // CON_HEIGHT 9.50
  conLength: string // CON_LENGTH 40.00
  lcNo: string // LC_NO
  lcExpDate: string // LC_EXP_DTE
  billLading: string // BILL_LADIN (date)
  bankCode: string // BANK_CODE
  creditTo: string // CREDIT_TO  AMP
  creditAmt: string // CREDIT_AMT
  commAmt: string // COMM_AMT
  gstAmt: string // GST_AMT
  invNoAmp: string // INV_NO_AMP
  courNo: string // COUR_NO
  courDate: string // COUR_DATE
  portDel: string // PORTDEL  JEBEL ALI, UAE
  desGoods: string // DES_GOODS
  remark: string // COM_REMARK
}

export interface CommercialInvoice {
  id: string | null
  /** the proforma invoice it was made from */
  piNo: string
  piId: string | null
  invoiceNo: string // COMMERCIAL INVOICE NO  M/23/002
  date: string // YYYY-MM-DD
  consignee: string // multi-line, printed after "To : "
  vessel: string
  voyage: string
  etd: string // YYYY-MM-DD
  eta: string
  containerNo: string
  sealNo: string
  paymentTerms: string
  asnNo: string
  // the PI block on page 1
  goodsTitle: string // ARTIFICIAL FLOWERS
  piLabel: string // the value printed under "PI NO" (defaults to piNo)
  poNo: string
  pod: string // port of discharge, JEBEL ALI
  type: string // FOB
  currency: string // USD
  incoterms: string // INCOTERMS 2010
  terms: string // TERMS FOB COLOMBO, SRI LANKA
  lines: CiLine[]
  // last page
  totalsLabel: string // FOB COLOMBO, SRI LANKA
  amountWords: string // typed over the automatic text when not blank
  shippingMarks: string
  orderReference: string
  certify: string // a) … b) … c) …  one per line
  hsNote: string
  beneficiary: string
  bank: string
  fox: FoxExtra
  /** record number in the FoxPro shipping table, once saved there */
  foxRecno: number | null
  /** the COM_INV_NO that record had when it was last read or written (checked before writing again) */
  foxKey: string | null
}

export interface CiDefaults {
  goodsTitle: string
  type: string
  currency: string
  incoterms: string
  terms: string
  totalsLabel: string
  paymentTerms: string
  hsCode: string
  factory: string
  certify: string
  hsNote: string
  beneficiary: string
  bank: string
  shipTerms: string
  creditTo: string
}

export const DEFAULT_CI: CiDefaults = {
  goodsTitle: 'ARTIFICIAL FLOWERS',
  type: 'FOB',
  currency: 'USD',
  incoterms: 'INCOTERMS 2010',
  terms: 'TERMS FOB COLOMBO, SRI LANKA',
  totalsLabel: 'FOB COLOMBO, SRI LANKA',
  paymentTerms: 'T/T',
  hsCode: '6702',
  factory: '(AMP)',
  certify: [
    'The Goods Country are of Sri Lanka Origin',
    "All cartons and each items are marked with the words 'MADE IN SRI LANKA'",
    'Country of Origin is printed/stitched on each item.'
  ].join('\n'),
  hsNote: 'HS CODE 6702 ARE APPLICABLE TO THE PRODUCTS SHIPPED UNDER THIS CREDIT',
  beneficiary: [
    'AMP CEYLON (PVT) LTD',
    'RING ROAD 3, PHASE 2, EXPORT PROCESSING ZONE',
    'KATUNAYAKE,',
    'SRI LANKA.',
    'TEL : 94-11-2251026   FAX :94-11-2251029'
  ].join('\n'),
  bank: [
    'SEYLAN BANK PLC',
    'LEVEL5, SEYLAN TOWERS, P.O.BOX 400, NO.90',
    'GALLE ROAD, COLOMBO 3 SRI LANKA',
    'TEL :94-11-2456789/2456434/2456442',
    'FAX :94-11-2452528',
    'F.C.B.U. A/C NO :9911-00089520-001',
    'SWIFT CODE :SEYBLKLX'
  ].join('\n'),
  shipTerms: 'FOB COLOMBO',
  creditTo: 'AMP'
}

let seq = 0
export function lineId(): string {
  seq = (seq + 1) % 1e6
  return `l${Date.now().toString(36)}-${seq.toString(36)}`
}

export const todayIso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function emptyFox(d: CiDefaults = DEFAULT_CI): FoxExtra {
  return {
    cmbRefNo: '', custCode: '', custName: '', street1: '', street2: '', city: '', country: '',
    shipTerms: d.shipTerms, shipLine: '', contNo2: '', contSize: '', conType: '', conHeight: '', conLength: '',
    lcNo: '', lcExpDate: '', billLading: '', bankCode: '', creditTo: d.creditTo, creditAmt: '', commAmt: '', gstAmt: '',
    invNoAmp: '', courNo: '', courDate: '', portDel: '', desGoods: '', remark: ''
  }
}

export function newInvoice(d: CiDefaults = DEFAULT_CI, date = todayIso()): CommercialInvoice {
  return {
    id: null,
    piNo: '',
    piId: null,
    invoiceNo: '',
    date,
    consignee: '',
    vessel: '',
    voyage: '',
    etd: '',
    eta: '',
    containerNo: '',
    sealNo: '',
    paymentTerms: d.paymentTerms,
    asnNo: '',
    goodsTitle: d.goodsTitle,
    piLabel: '',
    poNo: '',
    pod: '',
    type: d.type,
    currency: d.currency,
    incoterms: d.incoterms,
    terms: d.terms,
    lines: [],
    totalsLabel: d.totalsLabel,
    amountWords: '',
    shippingMarks: '',
    orderReference: '',
    certify: d.certify,
    hsNote: d.hsNote,
    beneficiary: d.beneficiary,
    bank: d.bank,
    fox: emptyFox(d),
    foxRecno: null,
    foxKey: null
  }
}

export function blankLine(d: CiDefaults = DEFAULT_CI): CiLine {
  return {
    id: lineId(), sourceId: null, yourItemNo: '', ourItem: '', factory: d.factory, description: '', packing: '',
    hsCode: d.hsCode, colour: '', barcode: '', pcsCtn: '', ctns: '', qty: '', unit: 'PCS', price: '', total: '', totalEdited: false
  }
}

export const num = (s: string | number | null | undefined): number => {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0
  const n = Number(String(s ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export const money = (n: number): string => (Math.round(n * 100) / 100).toFixed(2)

/** 32301.12 → "32,301.12" */
export const moneyGrouped = (n: number): string =>
  money(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export function lineTotal(l: Pick<CiLine, 'qty' | 'price'>): string {
  return money(num(l.qty) * num(l.price))
}

/** Number of cartons = quantity ÷ pieces per carton (blank when either is missing). */
export function computeCtns(qty: string, pcsCtn: string): string {
  const q = num(qty)
  const p = num(pcsCtn)
  if (!q || !p) return ''
  const c = q / p
  return Number.isInteger(c) ? String(c) : String(Math.round(c * 100) / 100)
}

export interface CiTotals {
  ctns: number
  byUnit: { unit: CiUnit; qty: number }[]
  amount: number
}

export function invoiceTotals(lines: CiLine[]): CiTotals {
  const by = new Map<CiUnit, number>()
  let ctns = 0
  let amount = 0
  for (const l of lines) {
    ctns += num(l.ctns)
    if (l.qty.trim()) by.set(l.unit, (by.get(l.unit) ?? 0) + num(l.qty))
    amount += num(l.total)
  }
  return {
    ctns: Math.round(ctns * 100) / 100,
    byUnit: CI_UNITS.filter((u) => by.has(u)).map((u) => ({ unit: u, qty: by.get(u)! })),
    amount: Math.round(amount * 100) / 100
  }
}

/** "pcs" / "pc" as printed after the quantity and the price. */
export function unitWord(u: CiUnit, plural: boolean): string {
  if (u === 'DOZ') return 'doz'
  if (u === 'SETS') return plural ? 'sets' : 'set'
  return plural ? 'pcs' : 'pc'
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function under1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  const parts: string[] = []
  if (h) parts.push(`${ONES[h]} Hundred`)
  if (r) {
    const words = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ' ' + ONES[r % 10] : ''}`
    parts.push(h ? `and ${words}` : words)
  }
  return parts.join(' ')
}

/** 32301 → "Thirty Two Thousand Three Hundred and One" (the old program's style, no hyphens). */
export function numberWords(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'Zero'
  const scales = ['', 'Thousand', 'Million', 'Billion']
  const parts: string[] = []
  for (let i = 0; n > 0 && i < scales.length; i++) {
    const chunk = n % 1000
    if (chunk) parts.unshift(`${under1000(chunk)}${scales[i] ? ' ' + scales[i] : ''}`)
    n = Math.floor(n / 1000)
  }
  return parts.join(' ')
}

/** "U.S.Dollars Thirty  Two Thousand Three Hundred and One and Cents Twelve Only." */
export function amountInWords(amount: number, currency = 'USD'): string {
  const cents = Math.round(amount * 100) % 100
  const whole = Math.floor(Math.round(amount * 100) / 100)
  const name = /^US/i.test(currency) || currency === '' ? 'U.S.Dollars' : currency
  return `${name} ${numberWords(whole)}${cents ? ` and Cents ${numberWords(cents)}` : ''} Only.`
}

/** "2023-03-23" → "Mar 23rd 2023" (the date line of the sample invoice). */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const d = Number(m[3])
  const sfx = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'
  return `${months[Number(m[2]) - 1]} ${d}${sfx} ${m[1]}`
}

/** "2023-03-26" → "26/03/2023" */
export function dmy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** How the colour is printed: short colours in the colour column; long ones split at the first "-". */
export function splitColour(colour: string, max = 12): { code: string; detail: string } {
  const c = colour.trim()
  if (c.length <= max) return { code: c, detail: '' }
  const i = c.indexOf('-')
  if (i > 0) return { code: c.slice(0, i), detail: c.slice(i + 1) }
  return { code: c, detail: '' }
}

export function checkInvoice(x: unknown): asserts x is CommercialInvoice {
  const c = x as CommercialInvoice
  if (!c || typeof c !== 'object' || !Array.isArray(c.lines) || typeof c.invoiceNo !== 'string') throw new Error('Not a commercial invoice.')
}

/** Fill fields an older version did not have, so an old saved invoice still opens. */
export function normalizeInvoice(c: CommercialInvoice, d: CiDefaults = DEFAULT_CI): CommercialInvoice {
  const base = newInvoice(d, c.date)
  return {
    ...base,
    ...c,
    fox: { ...base.fox, ...(c.fox ?? {}) },
    lines: Array.isArray(c.lines) ? c.lines.map((l) => ({ ...blankLine(d), ...l })) : []
  }
}
