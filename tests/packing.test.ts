import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShipStore } from '../src/main/store'
import { blankLine, DEFAULT_CI, newInvoice } from '../src/shared/invoice'
import {
  autoCbm, blankPlLine, measureText, newPackingList, numberCartons, packingCode, packingFromInvoice, packingTotals, type PlLine
} from '../src/shared/packing'
import { ADMIN_METHODS, EDIT_METHODS } from '../src/shared/ipc'
import { openNodeSqlite } from './helpers'

// the sample PACKING/WEIGHT LIST for M/23/002: [ctns, units, nett/ctn, gross/ctn, L, W, H, printed CBM]
const SAMPLE: [number, number, number, number, number, number, number, string][] = [
  [136, 1632, 3.3, 6.1, 52.5, 35, 45, '11.25'],
  [125, 1500, 3.3, 6.1, 52.5, 35, 45, '10.34'],
  [28, 1344, 14.4, 23, 76, 56, 37, '4.41'],
  [37, 1776, 14.4, 23, 76, 56, 37, '5.83'],
  [45, 180, 3.2, 6, 66, 66, 34, '6.66'],
  [53, 1272, 7, 12.3, 60, 44.5, 42, '5.94'],
  [58, 1392, 7, 12.3, 60, 44.5, 42, '6.50'],
  [14, 1008, 8.4, 13.9, 53, 29, 54, '1.16'],
  [23, 1656, 8.4, 13.9, 53, 29, 54, '1.91']
]

const sampleLines = (): PlLine[] =>
  SAMPLE.map(([c, u, n, g, l, w, h]) => ({ ...blankPlLine(), ctns: String(c), units: String(u), nettCtn: String(n), grossCtn: String(g), length: String(l), width: String(w), height: String(h) }))

describe('packing / weight list', () => {
  it('works out the CBM of each line like the sample', () => {
    sampleLines().forEach((l, i) => expect(autoCbm(l)).toBe(SAMPLE[i][7]))
    expect(measureText({ length: '52.5', width: '35', height: '45' })).toBe('52.50x 35.00x 45.00')
  })

  it('adds up the sample totals', () => {
    const t = packingTotals(sampleLines())
    expect(t.ctns).toBe(519)
    expect(t.byUnit).toEqual([{ unit: 'PCS', qty: 11760 }])
    expect(t.nett).toBe(3029.1)
    expect(t.gross).toBe(5236.7)
    expect(t.difference).toBe(2207.6)
    expect(t.cbm).toBe(54)
  })

  it('uses a typed CBM instead of the worked-out one', () => {
    const l = { ...sampleLines()[0], cbm: '12', cbmEdited: true }
    expect(packingTotals([l]).cbm).toBe(12)
  })

  it('numbers the cartons one after the other', () => {
    const lines = numberCartons(sampleLines().slice(0, 3))
    expect(lines.map((l) => l.ctnNo)).toEqual(['001-136', '137-261', '262-289'])
  })

  it('reads the packing as pieces per box / per carton', () => {
    expect(packingCode('2 pc/box,12 pcs/ctn.')).toBe('2/ 12')
    expect(packingCode('48 pcs/ctn')).toBe('48')
    expect(packingCode('', '24')).toBe('24')
  })

  it('fills from a commercial invoice and keeps the weights typed earlier', () => {
    const ci = {
      ...newInvoice(DEFAULT_CI),
      id: 'inv1',
      invoiceNo: 'M/23/002',
      vessel: 'SM MAHI',
      voyage: '054W',
      containerNo: 'MRKU0380028',
      lines: [{ ...blankLine(), yourItemNo: '161930493', ourItem: 'Y39AZPE44/E035 SPHC', colour: 'PEACH-PN/40+B/251', packing: '2 pc/box,12 pcs/ctn.', ctns: '136', qty: '1632', total: '6723.84' }]
    }
    const first = packingFromInvoice(ci, newPackingList())
    expect(first).toMatchObject({ invoiceId: 'inv1', invoiceNo: 'M/23/002', vessel: 'SM MAHI', voyage: '054W', containerNo: 'MRKU0380028', amount: '6723.84' })
    expect(first.lines[0]).toMatchObject({ itemNo: 'Y39AZPE44/E035 SPHC', colour: 'PEACH', customerItemNo: '161930493', packing: '2/ 12', ctns: '136', units: '1632' })

    const typed = { ...first, lines: [{ ...first.lines[0], nettCtn: '3.3', grossCtn: '6.1', length: '52.5', width: '35', height: '45' }] }
    const again = packingFromInvoice({ ...ci, lines: [{ ...ci.lines[0], ctns: '140' }] }, typed)
    expect(again.lines[0]).toMatchObject({ ctns: '140', nettCtn: '3.3', grossCtn: '6.1', length: '52.5' })
  })

  it('is saved, listed and deleted in the app database', () => {
    const store = new ShipStore(join(mkdtempSync(join(tmpdir(), 'pl-')), 'shipments.db'), openNodeSqlite)
    const pl = store.packingSave({ ...newPackingList(), invoiceNo: 'M/23/002', consignee: 'RNA RESOURCES GROUP LIMITED\nDUBAI', vessel: 'SM MAHI', lines: sampleLines() })
    expect(pl.id).toBeTruthy()
    expect(store.packingDuplicateOf('m/23/002', null)).toBe(pl.id)
    expect(store.packingDuplicateOf('M/23/002', pl.id)).toBeNull()
    const [row] = store.packingList('mahi')
    expect(row).toMatchObject({ invoiceNo: 'M/23/002', customer: 'RNA RESOURCES GROUP LIMITED', ctns: 519, nett: 3029.1, gross: 5236.7, cbm: 54, lineCount: 9 })
    store.packingDelete(pl.id!)
    expect(store.packingList()).toEqual([])
    store.close()
  })

  it('needs edit access to delete, and the admin for the change log', () => {
    // deleting saved documents and editing FoxPro records: edit access (an access code, or the admin)
    for (const m of ['invoiceDelete', 'packingDelete', 'foxUpdateFields', 'foxSetDeleted'] as const) expect(EDIT_METHODS.has(m)).toBe(true)
    // the change log, settings and making access codes: the admin password only
    for (const m of ['changes', 'saveSettings', 'makeAccessCode'] as const) expect(ADMIN_METHODS.has(m)).toBe(true)
    expect(ADMIN_METHODS.has('packingSave') || EDIT_METHODS.has('packingSave')).toBe(false) // a new list is fine; changing a saved one is checked in the handler
  })
})
