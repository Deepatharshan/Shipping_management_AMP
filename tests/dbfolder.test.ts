import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isNetworkPath, ShipStore } from '../src/main/store'
import { blankLine, DEFAULT_CI, newInvoice } from '../src/shared/invoice'
import { newPackingList } from '../src/shared/packing'
import { newRecord } from '../src/shared/shippingRecord'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { openNodeSqlite } from './helpers'

describe('app database folder', () => {
  it('is blank by default (the app data folder)', () => {
    expect(DEFAULT_SETTINGS.dataFolder).toBe('')
  })

  it('knows a network folder', () => {
    expect(isNetworkPath('\\\\SHIPPING-PC\\data\\shipments.db')).toBe(true)
    expect(isNetworkPath('//shipping-pc/data/shipments.db')).toBe(true)
    expect(isNetworkPath('D:\\ShippingData\\shipments.db')).toBe(false)
  })

  it('moves to another folder as a checked copy that opens with the same documents', () => {
    const a = new ShipStore(join(mkdtempSync(join(tmpdir(), 'db-a-')), 'shipments.db'), openNodeSqlite)
    a.save({ ...newInvoice(DEFAULT_CI), invoiceNo: 'M/26/001', lines: [{ ...blankLine(), qty: '10', price: '2', total: '20.00' }] })
    a.save({ ...newInvoice(DEFAULT_CI), invoiceNo: 'M/26/002' })
    a.packingSave({ ...newPackingList(), invoiceNo: 'M/26/001' })
    a.recordSave(newRecord('2026-10', '2026-10-30'))
    expect(a.counts()).toEqual({ invoices: 2, packingLists: 1, records: 1 })

    const dest = join(mkdtempSync(join(tmpdir(), 'db-b-')), 'shipments.db')
    a.backupTo(dest)
    expect(existsSync(dest)).toBe(true)
    const b = new ShipStore(dest, openNodeSqlite)
    expect(b.counts()).toEqual(a.counts())
    expect(b.list().map((r) => r.invoiceNo).sort()).toEqual(['M/26/001', 'M/26/002'])
    // the moved database keeps working
    b.save({ ...newInvoice(DEFAULT_CI), invoiceNo: 'M/26/003' })
    expect(b.counts().invoices).toBe(3)
    a.close()
    b.close()
  })
})
