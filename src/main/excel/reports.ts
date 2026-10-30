/**
 * Every report as an Excel workbook (.xlsx), laid out like its printout: the company block, the header
 * details, one row per item and the totals. Totals are live formulas (SUM, cartons × weight,
 * L × W × H ÷ 1,000,000 × cartons, total × rate), so they stay right when a number is changed in Excel.
 * The page set-up (A4, fit to width) prints the sheet on paper too.
 */
import ExcelJS from 'exceljs'
import {
  amountInWords, invoiceSums, longDate, num, type CiUnit, type CommercialInvoice
} from '@shared/invoice'
import { autoCbm, type PackingList } from '@shared/packing'
import { FACTORIES, monthTitle, type ShippingRecord } from '@shared/shippingRecord'
import type { CompanyDetails } from '@shared/types'
import type { PmaProforma } from '@shared/proforma'
import { normalizeProformaForPrint } from '../pdf/proformaTemplate'

const FONT = 'Arial'
const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF808080' } }
const GRID: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF2' } }
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F9' } }
const MONEY = '#,##0.00'
const clean = (s: unknown) => String(s ?? '').trim().replace(/\r\n?/g, '\n')

/** A YYYY-MM-DD date as a real Excel date (shown dd/mm/yyyy), or '' */
function dateValue(iso: string): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : ''
}

/** A typed number as a number (so Excel can add it up), else the text as typed. */
function numOrText(v: string): number | string {
  const t = clean(v)
  if (!t) return ''
  return /^-?\d+(\.\d+)?$/.test(t.replace(/,/g, '')) ? Number(t.replace(/,/g, '')) : t
}

const col = (n: number) => {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

class Sheet {
  ws: ExcelJS.Worksheet
  row = 1
  constructor(
    wb: ExcelJS.Workbook,
    name: string,
    readonly widths: number[],
    landscape = false
  ) {
    this.ws = wb.addWorksheet(name, {
      pageSetup: {
        paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.45, header: 0.2, footer: 0.2 }
      },
      headerFooter: { oddFooter: '&R&8Page &P of &N' }
    })
    this.ws.columns = widths.map((w) => ({ width: w }))
    this.ws.properties.defaultRowHeight = 15
  }
  get last() {
    return this.widths.length
  }
  /** one line of text across the whole width (or from `from` to `to`) */
  line(text: string, o: { bold?: boolean; size?: number; align?: 'left' | 'center' | 'right'; from?: number; to?: number; wrap?: boolean; height?: number } = {}) {
    const r = this.row++
    const from = o.from ?? 1
    const to = o.to ?? this.last
    if (to > from) this.ws.mergeCells(r, from, r, to)
    const c = this.ws.getCell(r, from)
    c.value = text
    c.font = { name: FONT, size: o.size ?? 10, bold: !!o.bold }
    c.alignment = { horizontal: o.align ?? 'left', vertical: 'top', wrapText: o.wrap ?? false }
    if (o.height) this.ws.getRow(r).height = o.height
    return r
  }
  /** label : value pairs, two per row (left half and right half) */
  pairs(items: [string, string | Date][]) {
    const half = Math.floor(this.last / 2)
    for (let i = 0; i < items.length; i += 2) {
      const r = this.row++
      items.slice(i, i + 2).forEach(([label, value], j) => {
        const start = j === 0 ? 1 : half + 1
        const end = j === 0 ? half : this.last
        this.ws.mergeCells(r, start, r, start + 1)
        const lab = this.ws.getCell(r, start)
        lab.value = label
        lab.font = { name: FONT, size: 9, bold: true }
        if (end > start + 2) this.ws.mergeCells(r, start + 2, r, end)
        const v = this.ws.getCell(r, start + 2)
        v.value = value
        v.font = { name: FONT, size: 9.5 }
        if (value instanceof Date) v.numFmt = 'dd/mm/yyyy'
        v.alignment = { horizontal: 'left' }
      })
    }
  }
  gap(n = 1) {
    this.row += n
  }
  /** the column titles of the item table */
  head(titles: string[], height = 44) {
    const r = this.row++
    titles.forEach((t, i) => {
      const c = this.ws.getCell(r, i + 1)
      c.value = t
      c.font = { name: FONT, size: 8.5, bold: true }
      c.fill = HEAD_FILL
      c.border = GRID
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })
    this.ws.getRow(r).height = height
    return r
  }
  /** one item row; numbers right-aligned with the given format */
  cells(values: (ExcelJS.CellValue | { formula: string; result?: number })[], fmts: (string | undefined)[] = [], o: { bold?: boolean; fill?: boolean; wrap?: boolean } = {}) {
    const r = this.row++
    // a totals row runs the full width of the table
    if (o.fill && values.length < this.last) values = [...values, ...Array(this.last - values.length).fill('')]
    values.forEach((v, i) => {
      const c = this.ws.getCell(r, i + 1)
      c.value = v as ExcelJS.CellValue
      c.font = { name: FONT, size: 9, bold: !!o.bold }
      c.border = GRID
      if (o.fill) c.fill = TOTAL_FILL
      const isNum = typeof v === 'number' || (v !== null && typeof v === 'object' && 'formula' in (v as object))
      if (v instanceof Date) c.numFmt = 'dd/mm/yyyy'
      else if (fmts[i]) c.numFmt = fmts[i]!
      c.alignment = { vertical: 'top', horizontal: isNum ? 'right' : 'left', wrapText: o.wrap ?? true }
    })
    return r
  }
  async buffer(wb: ExcelJS.Workbook) {
    return Buffer.from(await wb.xlsx.writeBuffer())
  }
}

function newBook(company: CompanyDetails | null) {
  const wb = new ExcelJS.Workbook()
  wb.creator = company?.name || 'Shipping Management AMP'
  wb.created = new Date()
  return wb
}

function companyBlock(sh: Sheet, company: CompanyDetails) {
  if (company.headerNote.trim()) sh.line(company.headerNote, { bold: true, size: 9, align: 'center' })
  sh.line(company.name, { bold: true, size: 15, align: 'center', height: 22 })
  sh.line(company.address, { size: 9, align: 'center' })
  sh.line(company.telFax, { size: 9, align: 'center' })
  if (company.email?.trim()) sh.line(`Email : ${company.email}`, { size: 9, align: 'center' })
  sh.gap()
}

const unitWord = (u: CiUnit) => (u === 'DOZ' ? 'DOZ' : u === 'SETS' ? 'SETS' : 'PCS')

// ---------------------------------------------------------------------------------------------------
// Commercial invoice
// ---------------------------------------------------------------------------------------------------

export async function invoiceXlsx(company: CompanyDetails, ci: CommercialInvoice): Promise<Buffer> {
  const wb = newBook(company)
  // YOUR ITEM | OUR ITEM | FACTORY | DESCRIPTION | PACKING | COLOUR | BARCODE | HS | CTNS | QTY | UNIT | PRICE | TOTAL
  const sh = new Sheet(wb, 'Commercial Invoice', [12, 18, 8, 34, 18, 16, 15, 8, 8, 10, 7, 10, 13])
  const sums = invoiceSums(ci)
  companyBlock(sh, company)
  sh.line(`COMMERCIAL INVOICE NO : ${ci.invoiceNo}`, { bold: true, size: 11, to: 7 })
  sh.row--
  sh.line(`DATE : ${longDate(ci.date)}`, { bold: true, size: 11, from: 8, align: 'right' })
  sh.gap()
  sh.line('Consignee / Notify', { bold: true, size: 9 })
  sh.line(`To : M/S. ${clean(ci.consignee)}`, { size: 9.5, wrap: true, height: 15 * Math.max(1, clean(ci.consignee).split('\n').length) })
  sh.gap()
  sh.pairs([
    ['Vessel', ci.vessel], ['Voyage', ci.voyage],
    ['ETD', dateValue(ci.etd)], ['ETA', dateValue(ci.eta)],
    ['Container No', ci.containerNo], ['Container seal No', ci.sealNo],
    ['Payment Terms', ci.paymentTerms], ['ASN No', ci.asnNo]
  ])
  sh.gap()
  sh.line(ci.goodsTitle, { bold: true })
  sh.pairs([
    ['PI No', ci.piLabel || ci.piNo], ['PO No', ci.poNo],
    ['POD', ci.pod], ['Type', ci.type],
    ['Currency', ci.currency], ['Amount', sums.total.toFixed(2)]
  ])
  if (ci.incoterms.trim()) sh.line(ci.incoterms, { bold: true, size: 9 })
  if (ci.terms.trim()) sh.line(ci.terms, { bold: true, size: 9 })
  sh.gap()

  sh.head(['YOUR ITEM NO', 'OUR ITEM NO', 'FACTORY', 'DESCRIPTION', 'PACKING', 'COLOR CODE', 'BARCODE', 'H.S CODE', 'NO OF CTNS', 'QUANTITY SHIPPED', 'UNIT', 'PRICE US$ / UNIT', `${ci.totalsLabel || 'FOB'} TOTAL US$`], 48)
  const first = sh.row
  for (const l of ci.lines) {
    const r = sh.row
    // the total is qty × price unless it was typed over on the invoice
    const total = l.totalEdited ? numOrText(l.total) : l.qty.trim() && l.price.trim() ? { formula: `ROUND(J${r}*L${r},2)`, result: num(l.total) } : numOrText(l.total)
    sh.cells(
      [numOrText(l.yourItemNo), l.ourItem, l.factory, l.description, l.packing, l.colour, l.barcode, numOrText(l.hsCode), numOrText(l.ctns), numOrText(l.qty), unitWord(l.unit), numOrText(l.price), total],
      [, , , , , , , , '#,##0', '#,##0', , '0.00##', MONEY]
    )
  }
  const lastItem = sh.row - 1
  const anyItems = lastItem >= first
  const sum = (c: string) => (anyItems ? { formula: `SUM(${c}${first}:${c}${lastItem})` } : 0)
  const tRow = sh.cells(['TOTALS :', '', '', '', '', '', '', '', sum('I'), sum('J'), '', 'US$', sum('M')], [, , , , , , , , '#,##0', '#,##0', , , MONEY], { bold: true, fill: true })
  let netRow = tRow
  if (sums.hasDiscount) {
    const label = `${ci.discountLabel.trim() || 'LESS : DISCOUNT'}${sums.percentText ? ` (${sums.percentText})` : ''}`
    const disc =
      ci.discountType === 'percent' ? { formula: `ROUND(M${tRow}*${Math.min(num(ci.discount), 100)}/100,2)`, result: sums.discount } : { formula: `MIN(${num(ci.discount)},M${tRow})`, result: sums.discount }
    const dRow = sh.cells([label, '', '', '', '', '', '', '', '', '', '', 'US$', disc], [, , , , , , , , , , , , MONEY], { bold: true })
    netRow = sh.cells(['NET TOTAL :', '', '', '', '', '', '', '', '', '', '', 'US$', { formula: `M${tRow}-M${dRow}`, result: sums.total }], [, , , , , , , , , , , , MONEY], { bold: true, fill: true })
  }
  sh.ws.getCell(netRow, 13).border = { ...GRID, bottom: { style: 'double', color: { argb: 'FF000000' } } }
  // the labels (TOTALS / LESS : DISCOUNT / NET TOTAL) span the description columns
  for (let r = tRow; r <= netRow; r++) sh.ws.mergeCells(r, 1, r, 8)
  sh.line(ci.totalsLabel, { bold: true, align: 'right', size: 9 })
  sh.gap()
  sh.line(`Say : ${ci.amountWords.trim() || amountInWords(sums.total, ci.currency)}`, { bold: true, wrap: true, height: 28 })
  sh.gap()
  if (ci.shippingMarks.trim()) sh.line(`Shipping Marks : ${clean(ci.shippingMarks)}`, { bold: true, size: 9.5, wrap: true, height: 15 * clean(ci.shippingMarks).split('\n').length })
  if (ci.orderReference.trim()) sh.line(`Applicant's Order reference : ${clean(ci.orderReference)}`, { bold: true, size: 9.5, wrap: true, height: 15 * clean(ci.orderReference).split('\n').length })
  const cert = clean(ci.certify).split('\n').filter(Boolean)
  if (cert.length) {
    sh.gap()
    sh.line('We hereby certify that', { bold: true, size: 9.5 })
    cert.forEach((x, i) => sh.line(`${String.fromCharCode(97 + i)})  ${x}`, { size: 9.5, from: 2 }))
  }
  if (ci.hsNote.trim()) {
    sh.gap()
    sh.line(clean(ci.hsNote), { bold: true, size: 9.5, wrap: true })
  }
  sh.gap()
  sh.line('Beneficiary', { bold: true })
  const bl = clean(ci.beneficiary).split('\n')
  const bk = clean(ci.bank).split('\n')
  for (let i = 0; i < Math.max(bl.length, bk.length); i++) {
    const r = sh.row++
    sh.ws.mergeCells(r, 1, r, 5)
    sh.ws.mergeCells(r, 6, r, sh.last)
    Object.assign(sh.ws.getCell(r, 1), { value: bl[i] ?? '', font: { name: FONT, size: 9 } })
    Object.assign(sh.ws.getCell(r, 6), { value: bk[i] ?? '', font: { name: FONT, size: 9 } })
  }
  return sh.buffer(wb)
}

// ---------------------------------------------------------------------------------------------------
// Packing / weight list
// ---------------------------------------------------------------------------------------------------

export async function packingXlsx(company: CompanyDetails, pl: PackingList): Promise<Buffer> {
  const wb = newBook(company)
  // ITEM | COLOUR | CUST ITEM | CTN-NO | PACKING | CTNS | UNITS | UNIT | NETT/CTN | GROSS/CTN | L | W | H | CBM | NETT | GROSS
  const sh = new Sheet(wb, 'Packing Weight List', [20, 15, 12, 10, 8, 8, 9, 6, 8, 8, 7, 7, 7, 9, 10, 10], true)
  companyBlock(sh, company)
  sh.line(`COMMERCIAL INVOICE NO : ${pl.invoiceNo}`, { bold: true, size: 11, to: 9 })
  sh.row--
  sh.line(`DATE : ${longDate(pl.date)}`, { bold: true, size: 11, from: 10, align: 'right' })
  sh.gap()
  sh.line('Consignee / Notify', { bold: true, size: 9, to: 9 })
  sh.row--
  sh.line('SHIPPING MARKS :', { bold: true, size: 9, from: 10 })
  const cons = clean(pl.consignee).split('\n')
  const marks = clean(pl.shippingMarks).split('\n')
  for (let i = 0; i < Math.max(cons.length, marks.length); i++) {
    sh.line(i === 0 ? `To : M/S. ${cons[0] ?? ''}` : cons[i] ?? '', { size: 9.5, to: 9 })
    sh.row--
    sh.line(marks[i] ?? '', { size: 9.5, from: 10, bold: true })
  }
  sh.gap()
  sh.pairs([
    ['Vessel', pl.vessel], ['Voyage', pl.voyage],
    ['ETD', dateValue(pl.etd)], ['ETA', dateValue(pl.eta)],
    ['Container No', pl.containerNo], ['Container seal No', pl.sealNo],
    ['Payment Terms', pl.paymentTerms], ['ASN No', pl.asnNo]
  ])
  sh.gap()
  sh.line('PACKING / WEIGHT LIST', { bold: true, size: 13, align: 'center', height: 20 })
  sh.line(pl.goodsTitle, { bold: true })
  sh.pairs([
    ['PI No', pl.piLabel || pl.piNo], ['PO No', pl.poNo],
    ['POD', pl.pod], ['Type', pl.type],
    ['Currency', pl.currency], ['Amount', pl.amount]
  ])
  if (pl.incoterms.trim()) sh.line(pl.incoterms, { bold: true, size: 9 })
  if (pl.terms.trim()) sh.line(pl.terms, { bold: true, size: 9 })
  sh.gap()
  sh.head(['ITEM NO', 'COLOR CODE', 'CUSTOMER ITEM NO', 'CTN-NO', 'PACKING', 'NO OF CTNS/ PKGS', 'NO OF UNITS', 'UNIT', 'NETT WT/CTN (kgs)', 'GROSS WT/CTN (kgs)', 'L (cm)', 'W (cm)', 'H (cm)', 'TOTAL CBM', 'NETT WT (kgs)', 'GROSS WT (kgs)'], 48)
  const first = sh.row
  for (const l of pl.lines) {
    const r = sh.row
    const cbm = l.cbmEdited ? numOrText(l.cbm) : { formula: `IF(AND(F${r}>0,K${r}>0,L${r}>0,M${r}>0),ROUND(K${r}*L${r}*M${r}/1000000*F${r},2),0)`, result: num(autoCbm(l)) }
    sh.cells(
      [l.itemNo, l.colour, numOrText(l.customerItemNo), l.ctnNo, l.packing, numOrText(l.ctns), numOrText(l.units), unitWord(l.unit), numOrText(l.nettCtn), numOrText(l.grossCtn),
        numOrText(l.length), numOrText(l.width), numOrText(l.height), cbm,
        { formula: `ROUND(N(I${r})*N(F${r}),2)`, result: num(l.nettCtn) * num(l.ctns) }, { formula: `ROUND(N(J${r})*N(F${r}),2)`, result: num(l.grossCtn) * num(l.ctns) }],
      [, , , , , '#,##0', '#,##0', , '0.0#', '0.0#', '0.00', '0.00', '0.00', '0.00', MONEY, MONEY]
    )
  }
  const last = sh.row - 1
  const sum = (c: string) => (last >= first ? { formula: `SUM(${c}${first}:${c}${last})` } : 0)
  const tRow = sh.cells(['TOTALS :', '', '', '', '', sum('F'), sum('G'), '', '', '', '', '', '', sum('N'), sum('O'), sum('P')], [, , , , , '#,##0', '#,##0', , , , , , , '0.00', MONEY, MONEY], { bold: true, fill: true })
  sh.gap()
  const w = (label: string, formula: string, double = false) => {
    const r = sh.row++
    sh.ws.mergeCells(r, 1, r, 3)
    Object.assign(sh.ws.getCell(r, 1), { value: label, font: { name: FONT, size: 11, bold: double } })
    const c = sh.ws.getCell(r, 4)
    c.value = { formula }
    c.numFmt = MONEY
    c.font = { name: FONT, size: 11, bold: double }
    if (double) c.border = { top: { style: 'thin' }, bottom: { style: 'double' } }
  }
  w('TOTAL GROSS WEIGHT', `P${tRow}`)
  w('TOTAL NETT WEIGHT', `O${tRow}`)
  w('DIFFERENCE', `P${tRow}-O${tRow}`, true)
  return sh.buffer(wb)
}

// ---------------------------------------------------------------------------------------------------
// Monthly shipping record
// ---------------------------------------------------------------------------------------------------

export async function recordXlsx(rec: ShippingRecord): Promise<Buffer> {
  const wb = newBook(null)
  // CMB | ORDER | CUSTOMER | INV DATE | TOTAL | CRD | TTL CBM | VOL | LINE | VESSEL | TOT FRT | FAC | INV NR | AMOUNT | FREIGHT | TO |
  // COMM | RATE | RS | CUSDEC NO | CUSDEC DATE | PAY | BL | ETA | POD | DELIVERY
  const sh = new Sheet(wb, 'Shipping Record', [10, 11, 22, 10, 11, 6, 7, 8, 13, 15, 8, 7, 11, 11, 8, 6, 9, 9, 14, 10, 10, 6, 10, 10, 12, 16], true)
  sh.line(`Shipping Record for the Month of ${monthTitle(rec.month)}`, { bold: true, size: 14, align: 'center', height: 22 })
  sh.line(`Report Date : ${rec.reportDate.split('-').reverse().join('/')}`, { size: 9.5, align: 'right' })
  sh.gap()
  sh.head(['CMB REF.', 'ORDER NOS', 'CUSTOMER', 'INV.DATE', 'TOTAL AMT$', 'CRD TO', 'TTL CBM', 'VOLUME', 'LINE', 'VESSEL', 'TOT FRT', 'FAC', 'INV.NR', 'AMOUNT', 'FREIGHT', 'TO',
    'COMM/ DISC/VAT', 'US$ RATE', 'VALUE Rs', 'CUSDEC NUMBER', 'CUSDEC DATE', 'PAY TER', 'BL DATE', 'ETA', 'PORT OF DISCHG.', 'PORT OF DELIVERY'], 36)
  const first = sh.row
  for (const r of rec.rows) {
    const i = sh.row
    sh.cells(
      [r.cmbRefNo, r.orderNo, r.customer || r.notify, dateValue(r.invDate), numOrText(r.totalAmt), r.creditTo, numOrText(r.cbm), r.volume, r.line, r.vessel, numOrText(r.totFreight),
        r.factory, r.invoiceNo, numOrText(r.amount), numOrText(r.freight), r.freightTo, numOrText(r.commDiscVat), numOrText(r.usRate),
        { formula: `IF(AND(ISNUMBER(E${i}),ISNUMBER(R${i})),ROUND(E${i}*R${i},2),"")`, result: Math.round(num(r.totalAmt) * num(r.usRate) * 100) / 100 },
        numOrText(r.cusdecNo), dateValue(r.cusdecDate), r.payTerms, dateValue(r.blDate), dateValue(r.eta), r.portDischarge, r.portDelivery],
      [, , , , MONEY, , '0.00', , , , MONEY, , , MONEY, MONEY, , MONEY, '0.0000', MONEY]
    )
  }
  const last = sh.row - 1
  const has = last >= first
  const sum = (c: string) => (has ? { formula: `SUM(${c}${first}:${c}${last})` } : 0)
  sh.cells(['GRAND TOTAL', '', '', '', sum('E'), '', sum('G'), '', '', '', sum('K'), '', '', sum('N'), sum('O'), '', sum('Q'), '', sum('S')],
    [, , , , MONEY, , '0.00', , , , MONEY, , , MONEY, MONEY, , MONEY, , MONEY], { bold: true, fill: true })
  sh.gap()
  // the totals line of the printout: amount by factory, freight and discounts
  sh.line('Totals', { bold: true, size: 10.5 })
  const put = (label: string, formula: string) => {
    const r = sh.row++
    sh.ws.mergeCells(r, 1, r, 3)
    Object.assign(sh.ws.getCell(r, 1), { value: label, font: { name: FONT, size: 10, bold: true } })
    const c = sh.ws.getCell(r, 4)
    sh.ws.mergeCells(r, 4, r, 5)
    c.value = { formula }
    c.numFmt = MONEY
    c.font = { name: FONT, size: 10 }
  }
  put('TOTAL AMT$', has ? `SUM(E${first}:E${last})` : '0')
  for (const f of FACTORIES) put(f, has ? `SUMIF(L${first}:L${last},"${f}",N${first}:N${last})` : '0')
  put('FREIGHT', has ? `SUM(K${first}:K${last})` : '0')
  put('DIS/COM/VAT', has ? `SUM(Q${first}:Q${last})` : '0')
  put('VALUE IN Rs', has ? `SUM(S${first}:S${last})` : '0')
  sh.ws.views = [{ state: 'frozen', ySplit: first - 1, xSplit: 3 }]
  return sh.buffer(wb)
}

// ---------------------------------------------------------------------------------------------------
// Proforma invoice (from the Product Management App's database)
// ---------------------------------------------------------------------------------------------------

export async function proformaXlsx(company: CompanyDetails, bank: string, pf: PmaProforma): Promise<Buffer> {
  const p = normalizeProformaForPrint(pf)
  const wb = newBook(company)
  // YOUR ITEM | OUR ITEM | FACTORY | COLOUR | DESCRIPTION | CTNS | QTY | UNIT | PRICE | TOTAL
  const sh = new Sheet(wb, 'Proforma Invoice', [10, 18, 11, 16, 40, 8, 10, 7, 11, 13])
  sh.line(company.name, { bold: true, size: 14, align: 'center', height: 20 })
  sh.line(company.address, { size: 9, align: 'center' })
  sh.line(company.telFax, { size: 9, align: 'center' })
  if (company.email?.trim()) sh.line(`E-MAIL : ${company.email}`, { size: 9, align: 'center' })
  sh.gap()
  sh.line(`PROFORMA INVOICE NO : ${p.invoiceNo}`, { bold: true, size: 11, to: 6 })
  sh.row--
  sh.line(`DATE : ${longDate(p.date)}`, { bold: true, size: 10, from: 7, align: 'right' })
  sh.gap()
  const c = p.customer
  sh.line(`TO : ${c.name}`, { bold: true })
  for (const x of [c.street1, c.street2, c.city, c.country].filter((v) => v.trim())) sh.line(x, { size: 9.5 })
  if (c.phone.trim() || c.email.trim()) sh.line([c.phone.trim() && `TEL : ${c.phone}`, c.email.trim() && `E-MAIL : ${c.email}`].filter(Boolean).join('     '), { size: 9.5 })
  if (c.attention.trim()) sh.line(`ATTN ${c.attention}`, { bold: true, size: 9.5 })
  if (p.ref.trim()) sh.line(p.ref, { size: 9.5, wrap: true, height: 28 })
  sh.gap()
  sh.head(['YOUR ITEM NO', 'OUR ITEM NO', 'FACTORY', 'COLOR CODE', 'DESCRIPTION', 'NO OF CTNS', 'QUANTITY ORDERED', 'UNIT', 'PRICE FOB COLOMBO US$/UNIT', 'TOTAL US$'], 36)
  const first = sh.row
  p.lines.forEach((l, i) => {
    const r = sh.row
    const total = l.qty.trim() && l.price.trim() && Math.abs(num(l.qty) * num(l.price) - num(l.total)) < 0.005 ? { formula: `ROUND(G${r}*I${r},2)`, result: num(l.total) } : numOrText(l.total)
    sh.cells(
      [numOrText(l.yourItemNo || String(i + 1).padStart(2, '0')), l.ourItem, l.ourFactory, l.colorCode, clean(l.description), numOrText(l.noCtns), numOrText(l.qty), l.unit, numOrText(l.price), total],
      [, , , , , '#,##0', '#,##0', , '0.00##', MONEY]
    )
  })
  const last = sh.row - 1
  const sum = (col: string) => (last >= first ? { formula: `SUM(${col}${first}:${col}${last})` } : 0)
  const cft = p.lines.reduce((s, l) => s + num(l.cft) * num(l.noCtns), 0)
  sh.cells([`Total CFT is Approximately : ${cft ? Math.round(cft) : ''}`, '', '', '', '', sum('F'), sum('G'), '', 'US$', sum('J')], [, , , , , '#,##0', '#,##0', , , MONEY], { bold: true, fill: true })
  sh.line('FOB COLOMBO PORT, SRI LANKA.', { bold: true, align: 'right' })
  sh.gap()
  const g = p.page2
  const yn = (b: boolean) => (b ? 'YES' : 'NO')
  const lines: string[] = [
    `1. Total amount of this Proforma Invoice No : ${p.invoiceNo} is US$ ${p.lines.reduce((t, l) => t + num(l.total), 0).toFixed(2)} FOB COLOMBO PORT, SRI LANKA.`,
    `2. Total Q-ty to be shipped by ${g.container}, from port of ${g.fromPort} to port of ${g.toPort}.`,
    '3. T/T payment in favour of our factory:',
    ...clean(bank).split('\n').map((x) => `      ${x}`),
    `   a. Latest shipment date : ${g.latestShipment} from port of ${g.fromPort}.`,
    '   b. Partial shipments, if any, are allowed.',
    '   c. Transhipments, if any, are allowed.',
    `   d. ${g.originCert}`,
    '   e. Fumigation Certificate will be supplied.',
    '   f. Forwarder Bill of Lading acceptable',
    '   g. Phytosanitary Certificate will be supplied.',
    g.marks.mode === 'images'
      ? '4. Shipping Marks: as per the pictures on the printed proforma.'
      : `4. Shipping Marks: ${g.marks.shipMark} · Side mark — Item No: ${g.marks.side.itemNo}, Q'ty: ${g.marks.side.qty} pcs, Color/Asst: ${g.marks.side.colourAsst}, N.W.: ${g.marks.side.nw} kgs, G.W.: ${g.marks.side.gw} kgs · Inner box — Item No: ${g.marks.inner.itemNo}, Color/Asst: ${g.marks.inner.colourAsst}, Q'ty: ${g.marks.inner.qty} pcs · ${g.marks.cartonNo}`,
    `5. 'Made in Sri Lanka.' origin marks on goods - ${yn(g.originOnGoods)}   Innerboxes - ${yn(g.originOnInnerboxes)}   Cartons - ${yn(g.originOnCartons)}${g.specialMarks.trim() ? `   ${g.specialMarks}` : ''}`,
    `6. ${yn(g.specialLabels)} - Special customer's labels and or other special labels.${g.specialLabelItems.length ? ` (${g.specialLabelItems.join(', ')})` : ''}`,
    `7. ${yn(g.forwardingAgent)} - Customer's special forwarding agent to be used. If yes : ${g.forwardingAgentName || 'TO BE ADVISED'}`,
    ...g.clauses.map((x, i) => `${8 + i}. ${x}`)
  ]
  sh.line(`To : ${c.name}${c.country.trim() ? ` / ${c.country}` : ''}`, { bold: true })
  for (const x of lines) sh.line(x, { size: 9.5, wrap: true, height: x.length > 120 ? 28 : 15 })
  return sh.buffer(wb)
}
