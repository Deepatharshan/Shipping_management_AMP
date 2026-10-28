import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blankLine, DEFAULT_CI, newInvoice } from '../src/shared/invoice'
import { blankRow, monthTitle, newRecord, recordTotals, rowFromInvoice, rupees } from '../src/shared/shippingRecord'
import { ADMIN_METHODS } from '../src/shared/ipc'
import { ShipStore } from '../src/main/store'
import { openNodeSqlite } from './helpers'

// the sample: M/26/015, SCHWARTINSKY GMBH, 2,184.36 less 177.00 = 2,007.36, rate 333.0703
const sampleInvoice = () => ({
  ...newInvoice(DEFAULT_CI, '2026-09-21'),
  id: 'inv15',
  invoiceNo: 'M/26/015',
  piNo: '60704/M/S',
  consignee: 'SCHWARTINSKY GMBH\nHAMBURG',
  vessel: 'OOCL NAGOYA',
  etd: '2026-09-28',
  eta: '2026-10-20',
  pod: 'HAMBURG',
  discount: '177',
  discountType: 'amount' as const,
  fox: { ...newInvoice().fox, cmbRefNo: '26015/M', custName: 'SCHWARTINSKY GMBH', shipLine: 'ONE TEAM', country: 'GERMANY', contSize: 'LCL' },
  lines: [{ ...blankLine(), qty: '1000', price: '2.18436', total: '2184.36' }]
})

describe('monthly shipping record', () => {
  it('fills a row from the commercial invoice', () => {
    const r = rowFromInvoice(sampleInvoice(), '1.60')
    expect(r).toMatchObject({
      invoiceId: 'inv15', source: 'app', invoiceNo: 'M/26/015', invDate: '2026-09-21', cmbRefNo: '26015/M', orderNo: '60704/M/S',
      customer: 'SCHWARTINSKY GMBH', totalAmt: '2184.36', amount: '2007.36', commDiscVat: '177.00', creditTo: 'AMP', factory: 'AMP',
      cbm: '1.60', volume: 'LCL', line: 'ONE TEAM', vessel: 'OOCL NAGOYA', payTerms: 'T/T', blDate: '2026-09-28', eta: '2026-10-20',
      portDischarge: 'HAMBURG', portDelivery: 'HAMBURG,GERMANY', usRate: '', cusdecNo: ''
    })
  })

  it('works out the value in rupees and the totals like the sample', () => {
    const r = { ...rowFromInvoice(sampleInvoice(), '1.60'), usRate: '333.0703' }
    expect(rupees(r)).toBe(727545.44)
    const t = recordTotals([r])
    expect(t).toEqual({ total: 2184.36, byFactory: { AMP: 2007.36, 'AMP-1': 0, 'AMP-2': 0 }, freight: 0, commDiscVat: 177, rupees: 727545.44 })
  })

  it('adds each factory under its own heading', () => {
    const rows = [
      { ...blankRow('A'), totalAmt: '100', amount: '100' },
      { ...blankRow('B'), totalAmt: '50', amount: '45', factory: 'AMP-1' as const, commDiscVat: '5' },
      { ...blankRow('C'), totalAmt: '20', amount: '20', factory: 'AMP-2' as const, totFreight: '3.5' }
    ]
    expect(recordTotals(rows)).toMatchObject({ total: 170, byFactory: { AMP: 100, 'AMP-1': 45, 'AMP-2': 20 }, freight: 3.5, commDiscVat: 5 })
  })

  it('names the month', () => {
    expect(monthTitle('2026-09')).toBe('September 2026')
  })

  it('is saved once per month, listed and deleted', () => {
    const store = new ShipStore(join(mkdtempSync(join(tmpdir(), 'rec-')), 'shipments.db'), openNodeSqlite)
    const rec = store.recordSave({ ...newRecord('2026-09', '2026-09-25'), rows: [{ ...rowFromInvoice(sampleInvoice(), '1.60'), usRate: '333.0703' }] })
    expect(store.recordForMonth('2026-09')).toBe(rec.id)
    expect(store.recordForMonth('2026-09', rec.id)).toBeNull()
    expect(store.recordList()).toEqual([expect.objectContaining({ month: '2026-09', reportDate: '2026-09-25', rowCount: 1, total: 2184.36 })])
    expect(store.recordGet(rec.id!)!.rows[0].usRate).toBe('333.0703')
    store.recordDelete(rec.id!)
    expect(store.recordList()).toEqual([])
    store.close()
  })

  it('needs the admin to delete a record', () => {
    expect(ADMIN_METHODS.has('recordDelete')).toBe(true)
    expect(ADMIN_METHODS.has('recordSave')).toBe(false) // a new record is fine; changing a saved one is checked in the handler
  })
})
