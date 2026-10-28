/**
 * The ONLY place that knows the FoxPro shipping table's field names (deldem shipping.DBF).
 * Fields are looked up by name; widths come from the file's header at run time.
 *
 * Field (width)        Commercial invoice
 * COM_INV_NO (15)      invoice no                     ← the key of SHIPPING.IDX
 * DTE_OF_INV (D)       date
 * TOTAL_AMT (N10.2)    total amount (after the discount, if any)
 * VASSEL (20)          vessel
 * SHIP_DATE (D)        ETD          ARIVAL_DTE (D)   ETA
 * CONT_NO (25)         container no                  SEAL_NR (15)  seal no
 * PAY_TERMS (3)        payment terms (first 3 characters, e.g. T/T)
 * PORTDIS (20)         POD (port of discharge)       PORTDEL (20)  port of delivery
 * CUST_CODE … COUNTRY  the customer (from the proforma)
 * the rest             "FoxPro details" in the editor (CMB ref, ship line, container size/type …)
 *
 * Never written: the memo fields (SHIPPING, S_EXPENSES), and the expense / charge fields
 * (FREIGHT, GCEC_CHGS, …, FRGHT_CHG1 … FUMIG_CHG7, ADV_TAKEN, BALANCE, BNK_CHGS): those belong to the
 * old program's expense screens and are left exactly as they are.
 */
import { emptyFox, invoiceSums, newInvoice, type CiDefaults, type CommercialInvoice, type FoxExtra } from './invoice'

export const KEY_FIELD = 'COM_INV_NO'

/** FoxExtra key → FoxPro field */
export const FOX_EXTRA_FIELDS: Record<keyof FoxExtra, string> = {
  cmbRefNo: 'CMB_REF_NO',
  custCode: 'CUST_CODE',
  custName: 'CUST_NAME',
  street1: 'STREET_1',
  street2: 'STREET_2',
  city: 'CITY',
  country: 'COUNTRY',
  shipTerms: 'SHIP_TERMS',
  shipLine: 'SHIP_LINE',
  contNo2: 'CONT_NO_2',
  contSize: 'CONT_SIZE',
  conType: 'CON_TYPE',
  conHeight: 'CON_HEIGHT',
  conLength: 'CON_LENGTH',
  lcNo: 'LC_NO',
  lcExpDate: 'LC_EXP_DTE',
  billLading: 'BILL_LADIN',
  bankCode: 'BANK_CODE',
  creditTo: 'CREDIT_TO',
  creditAmt: 'CREDIT_AMT',
  commAmt: 'COMM_AMT',
  gstAmt: 'GST_AMT',
  invNoAmp: 'INV_NO_AMP',
  courNo: 'COUR_NO',
  courDate: 'COUR_DATE',
  portDel: 'PORTDEL',
  desGoods: 'DES_GOODS',
  remark: 'COM_REMARK'
}

/** Invoice field → FoxPro field, for the printed values that also go into the table. */
export const FOX_MAIN_FIELDS = {
  invoiceNo: 'COM_INV_NO',
  date: 'DTE_OF_INV',
  vessel: 'VASSEL',
  etd: 'SHIP_DATE',
  eta: 'ARIVAL_DTE',
  containerNo: 'CONT_NO',
  sealNo: 'SEAL_NR',
  paymentTerms: 'PAY_TERMS',
  pod: 'PORTDIS'
} as const

/** Every field the app writes. Anything else in the record is never touched. */
export const WRITTEN_FIELDS = [...Object.values(FOX_MAIN_FIELDS), 'TOTAL_AMT', ...Object.values(FOX_EXTRA_FIELDS)]

/** Fields that are never written, even from the FoxPro records editor. */
export const NEVER_WRITTEN = new Set(['SHIPPING', 'S_EXPENSES'])

/** Labels for the FoxPro records screen. */
export const FIELD_LABELS: Record<string, string> = {
  COM_INV_NO: 'Commercial invoice no', CMB_REF_NO: 'CMB ref no', CUST_CODE: 'Customer code', DTE_OF_INV: 'Invoice date',
  TOTAL_AMT: 'Total amount', GST_AMT: 'GST amount', COMM_AMT: 'Commission', ADD_LESS: 'Add / less', COM_REMARK: 'Remark',
  TO_BNK_DTE: 'To bank date', DUE_DTE: 'Due date', PAID: 'Paid', BANK_CODE: 'Bank code', SHIPPING: 'Shipping (memo)',
  SHIP_TERMS: 'Ship terms', SHIP_DATE: 'Ship date (ETD)', ARIVAL_DTE: 'Arrival date (ETA)', VASSEL: 'Vessel', CONT_NO: 'Container no',
  CONT_NO_2: 'Container no 2', CON_HEIGHT: 'Container height', CON_LENGTH: 'Container length', CON_TYPE: 'Container type',
  LC_NO: 'LC no', SHIP_LINE: 'Shipping line', S_EXPENSES: 'Expenses (memo)', FREIGHT: 'Freight', SEAL_NR: 'Seal no',
  CUST_NAME: 'Customer name', STREET_1: 'Street 1', STREET_2: 'Street 2', CITY: 'City', COUNTRY: 'Country',
  DES_GOODS: 'Description of goods', CREDIT_TO: 'Credit to', CONT_SIZE: 'Container size', BILL_LADIN: 'Bill of lading date',
  LC_EXP_DTE: 'LC expiry date', CREDIT_AMT: 'Credit amount', CREDIT_DTE: 'Credit date', INV_NO_AMP: 'Invoice no AMP',
  COUR_NO: 'Courier no', COUR_DATE: 'Courier date', PAY_TERMS: 'Payment terms', BNK_CHGS: 'Bank charges',
  PORTDIS: 'Port of discharge', PORTDEL: 'Port of delivery'
}

export type FoxValue = string | number | null

/** The values to write for an invoice: field → value (text, number or YYYY-MM-DD date). */
export function foxValues(ci: CommercialInvoice): Record<string, FoxValue> {
  const out: Record<string, FoxValue> = {}
  for (const [k, f] of Object.entries(FOX_MAIN_FIELDS)) out[f] = (ci as unknown as Record<string, string>)[k] ?? ''
  // an old shipment opened from the table has no item lines: its total is then left as it is.
  // The total written is what the customer pays (after the discount, if any).
  if (ci.lines.length) out.TOTAL_AMT = invoiceSums(ci).total
  for (const [k, f] of Object.entries(FOX_EXTRA_FIELDS)) out[f] = ci.fox[k as keyof FoxExtra] ?? ''
  if (!String(out.INV_NO_AMP ?? '').trim()) out.INV_NO_AMP = ci.invoiceNo
  return out
}

/** Text of a FoxPro value as the editor shows it. */
const txt = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v))

/**
 * An invoice from a FoxPro record (opening an old shipment). The table has no item lines, so the
 * lines start empty (fetch the proforma to fill them). rec: field → decoded value.
 */
export function invoiceFromFox(rec: Record<string, unknown>, recno: number, d: CiDefaults): CommercialInvoice {
  const ci = newInvoice(d, txt(rec.DTE_OF_INV) || undefined)
  for (const [k, f] of Object.entries(FOX_MAIN_FIELDS)) (ci as unknown as Record<string, string>)[k] = txt(rec[f])
  if (!ci.date) ci.date = newInvoice(d).date
  const fox = emptyFox(d)
  for (const [k, f] of Object.entries(FOX_EXTRA_FIELDS)) fox[k as keyof FoxExtra] = txt(rec[f])
  ci.fox = fox
  ci.consignee = [fox.custName, fox.street1, fox.street2, fox.city, fox.country].map((x) => x.trim()).filter(Boolean).join('\n')
  ci.foxRecno = recno
  ci.foxKey = txt(rec[KEY_FIELD]).trimEnd()
  return ci
}

/**
 * Link an invoice to an existing FoxPro record (the invoice no is already in the table, e.g. made by
 * the old invoicing program). Values the record has fill what the invoice leaves blank, so saving
 * never blanks out a value that is in FoxPro.
 */
export function linkToFox(ci: CommercialInvoice, rec: Record<string, unknown>, recno: number): CommercialInvoice {
  const out: CommercialInvoice = { ...ci, fox: { ...ci.fox }, foxRecno: recno, foxKey: txt(rec[KEY_FIELD]).trimEnd() }
  const o = out as unknown as Record<string, string>
  for (const [k, f] of Object.entries(FOX_MAIN_FIELDS)) if (!String(o[k] ?? '').trim() && txt(rec[f]).trim()) o[k] = txt(rec[f])
  for (const [k, f] of Object.entries(FOX_EXTRA_FIELDS)) {
    const key = k as keyof FoxExtra
    const v = txt(rec[f])
    // the record's own value wins for FoxPro-only fields, except where the user already typed one
    if (v.trim() && (!out.fox[key].trim() || out.fox[key] === emptyFox()[key])) out.fox[key] = v
  }
  if (!out.consignee.trim()) out.consignee = [out.fox.custName, out.fox.street1, out.fox.street2, out.fox.city, out.fox.country].filter((x) => x.trim()).join('\n')
  return out
}

/** The fields of the table whose width a typed value may exceed, for warnings in the editor. */
export interface FieldInfo {
  name: string
  type: string
  length: number
  decimals: number
}
