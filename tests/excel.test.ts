import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { invoiceXlsx, packingXlsx, proformaXlsx, recordXlsx } from '../src/main/excel/reports'
import { blankLine, DEFAULT_CI, newInvoice } from '../src/shared/invoice'
import { blankPlLine, newPackingList } from '../src/shared/packing'
import { blankRow, newRecord } from '../src/shared/shippingRecord'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const company = { ...DEFAULT_SETTINGS.company, email: 'dgl@eureka.lk' }

async function read(buf: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  const ws = wb.worksheets[0]
  /** every cell as [address, value] */
  const cells: Record<string, ExcelJS.CellValue> = {}
  ws.eachRow((row) => row.eachCell((c) => (cells[c.address] = c.value)))
  const find = (text: string) => Object.entries(cells).find(([, v]) => typeof v === 'string' && v.startsWith(text))?.[0]
  return { ws, cells, find }
}
const formula = (v: ExcelJS.CellValue) => (v && typeof v === 'object' && 'formula' in v ? (v as { formula: string }).formula : null)
const result = (v: ExcelJS.CellValue) => (v && typeof v === 'object' && 'result' in v ? (v as { result: unknown }).result : v)

describe('Excel reports', () => {
  it('commercial invoice: items with qty × price, SUM totals and the discount', async () => {
    const ci = {
      ...newInvoice(DEFAULT_CI, '2026-09-21'), invoiceNo: 'M/26/015', consignee: 'SCHWARTINSKY GMBH\nHAMBURG', vessel: 'OOCL NAGOYA',
      discount: '177', discountType: 'amount' as const,
      lines: [
        { ...blankLine(), yourItemNo: '70031', ourItem: 'R18AZRD12 E035', ctns: '18', qty: '432', price: '2.88', total: '1244.16' },
        { ...blankLine(), yourItemNo: '70032', ourItem: 'P22AZWH04 E035', ctns: '5', qty: '240', price: '3.9175', total: '940.20' }
      ]
    }
    const { ws, cells, find } = await read(await invoiceXlsx(company, ci))
    expect(ws.name).toBe('Commercial Invoice')
    const head = Number(find('YOUR ITEM NO')!.replace(/\D/g, ''))
    expect(cells[`A${head + 1}`]).toBe(70031)
    expect(formula(cells[`M${head + 1}`])).toBe(`ROUND(J${head + 1}*L${head + 1},2)`)
    expect(result(cells[`M${head + 1}`])).toBe(1244.16)
    const tot = Number(find('TOTALS')!.replace(/\D/g, ''))
    expect(formula(cells[`M${tot}`])).toBe(`SUM(M${head + 1}:M${head + 2})`)
    expect(formula(cells[`I${tot}`])).toBe(`SUM(I${head + 1}:I${head + 2})`)
    const net = Number(find('NET TOTAL')!.replace(/\D/g, ''))
    expect(result(cells[`M${net}`])).toBe(2007.36)
    expect(find('Say : U.S.Dollars Two Thousand Seven')).toBeTruthy()
  })

  it('packing list: CBM, nett and gross worked out by formulas', async () => {
    const pl = {
      ...newPackingList(), invoiceNo: 'M/26/021', date: '2026-10-08',
      lines: [
        { ...blankPlLine(), itemNo: 'Y39AZPE44/E035', ctns: '136', units: '1632', nettCtn: '3.3', grossCtn: '6.1', length: '52.5', width: '35', height: '45' },
        { ...blankPlLine(), itemNo: 'Y39AZWT05/E035', ctns: '125', units: '1500', nettCtn: '3.3', grossCtn: '6.1', length: '52.5', width: '35', height: '45' }
      ]
    }
    const { cells, find } = await read(await packingXlsx(company, pl))
    const head = Number(find('ITEM NO')!.replace(/\D/g, ''))
    const r = head + 1
    expect(result(cells[`N${r}`])).toBe(11.25) // 52.5 × 35 × 45 ÷ 1,000,000 × 136
    expect(formula(cells[`N${r}`])).toContain(`ROUND(K${r}*L${r}*M${r}/1000000*F${r},2)`)
    expect(result(cells[`O${r}`])).toBeCloseTo(448.8)
    expect(result(cells[`P${r}`])).toBeCloseTo(829.6)
    const tot = Number(find('TOTALS')!.replace(/\D/g, ''))
    expect(formula(cells[`N${tot}`])).toBe(`SUM(N${r}:N${r + 1})`)
    const diff = find('DIFFERENCE')!
    expect(formula(cells[diff.replace('A', 'D')])).toBe(`P${tot}-O${tot}`)
  })

  it('shipping record: value in Rs = total × rate, totals by factory', async () => {
    const rec = {
      ...newRecord('2026-09', '2026-09-25'),
      rows: [
        { ...blankRow('M/26/015'), customer: 'SCHWARTINSKY GMBH', totalAmt: '2184.36', amount: '2007.36', commDiscVat: '177.00', usRate: '333.0703', invDate: '2026-09-21' },
        { ...blankRow('M/26/016'), totalAmt: '100', amount: '100', factory: 'AMP-1' as const }
      ]
    }
    const { ws, cells, find } = await read(await recordXlsx(rec))
    expect(find('Shipping Record for the Month of September 2026')).toBeTruthy()
    const head = Number(find('CMB REF.')!.replace(/\D/g, ''))
    const r = head + 1
    expect(result(cells[`S${r}`])).toBe(727545.44)
    expect(cells[`D${r}`]).toBeInstanceOf(Date)
    const amp1 = Object.entries(cells).find(([a, v]) => a.startsWith('A') && v === 'AMP-1')![0] // the label in the totals list
    expect(formula(cells[amp1.replace('A', 'D')])).toBe(`SUMIF(L${r}:L${r + 1},"AMP-1",N${r}:N${r + 1})`)
    expect(ws.pageSetup.orientation).toBe('landscape')
  })

  it('proforma: items, totals and the terms', async () => {
    const pf = {
      header: { invoiceNo: '61001/M/S', date: '2026-10-14', customer: { name: 'PLAYSMART LIMITED', country: 'UNITED KINGDOM' } },
      lines: [{ yourItemNo: 'PS-101', ourItem: 'T10AZMX01 E100', description: 'MIXED SPRING BOUQUET\n24 pcs/ctn.', noCtns: '40', qty: '960', unit: 'PCS', price: '1.85', total: '1776.00' }],
      page2: { container: '1X20GP CONTAINER', toPort: 'FELIXSTOWE' }
    }
    const { cells, find } = await read(await proformaXlsx(company, 'AMP CEYLON (PVT) LTD\nSEYLAN BANK PLC', pf))
    expect(find('PROFORMA INVOICE NO : 61001/M/S')).toBeTruthy()
    const head = Number(find('YOUR ITEM NO')!.replace(/\D/g, ''))
    expect(result(cells[`J${head + 1}`])).toBe(1776)
    expect(find('1. Total amount of this Proforma Invoice No : 61001/M/S is US$ 1776.00')).toBeTruthy()
    expect(find('2. Total Q-ty to be shipped by 1X20GP CONTAINER')).toBeTruthy()
  })
})
