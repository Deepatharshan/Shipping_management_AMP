import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ShipStore } from '../src/main/store'
import { ProformaSource } from '../src/main/proformaSource'
import { newInvoice, blankLine, DEFAULT_CI } from '../src/shared/invoice'
import { invoiceFromProforma } from '../src/shared/proforma'
import { openNodeSqlite } from './helpers'

const SAMPLE_PF = {
  id: null,
  header: {
    invoiceNo: 'SM 46262 JW',
    date: '2023-03-01',
    customer: { code: '9726', name: 'RNA RESOURCES GROUP LIMITED', street1: 'OPERATING AS "LANDMARK"', street2: 'P.O. BOX 17155, JEBEL ALI FREE ZONE', city: 'DUBAI', country: 'UAE' },
    ref: ''
  },
  lines: [
    { id: 'a', yourItemNo: '161930493', ourItem: 'Y39AZPE44/E035 S', ourFactory: '(AMP/KAT)', colorCode: 'PEACH-PN/40+B/251+B/252',
      description: 'MIX ROSE & POM POM IN WOVEN VASE 18X18X20CM H\n2 pc/box,12 pcs/ctn. (APX. 5.31CFT)', pcsCtn: '12', noCtns: '136', qty: '1632', unit: 'PCS', price: '4.12', total: '6723.84', cft: '5.31' },
    { id: 'b', yourItemNo: '161930496', ourItem: 'Y39AZWT05/E035 S', ourFactory: '(AMP/A-1)', colorCode: 'WHITE-B/251',
      description: 'MIX ROSE & POM POM IN WOVEN VASE 18X18X20CM H\n2 pc/box,12 pcs/ctn.', pcsCtn: '12', noCtns: '', qty: '1500', unit: 'PCS', price: '4.12', total: '', cft: '' }
  ],
  page2: { container: '1X40HQ CONTAINER', fromPort: 'Colombo, Sri Lanka', toPort: 'Jebel Ali' }
}

describe('proforma source (Product Management App database)', () => {
  it('reads proformas from a copy, including saves still in the WAL journal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pma-'))
    const src = join(dir, 'quotations.db')
    const live = new DatabaseSync(src)
    live.exec('PRAGMA journal_mode = WAL')
    live.exec(`CREATE TABLE proformas (id TEXT PRIMARY KEY, invoice_no TEXT, customer_name TEXT, pf_date TEXT, updated_at INTEGER, pdf_path TEXT, search TEXT, data TEXT NOT NULL)`)
    live.prepare('INSERT INTO proformas VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('pf1', 'SM 46262 JW', 'RNA RESOURCES GROUP LIMITED', '2023-03-01', 1, null, '', JSON.stringify(SAMPLE_PF))
    expect(existsSync(`${src}-wal`)).toBe(true)

    const ps = new ProformaSource(join(dir, 'work'), openNodeSqlite)
    await ps.refresh(src)
    expect(ps.status(src)).toMatchObject({ ok: true, proformas: 1 })
    const found = ps.findByNo('sm46262jw')
    expect(found).toHaveLength(1)
    expect(found[0].amount).toBe(6723.84)
    const pf = ps.get(found[0].id)!
    const ci = invoiceFromProforma(pf, DEFAULT_CI)
    expect(ci.piNo).toBe('SM 46262 JW')
    expect(ci.pod).toBe('JEBEL ALI')
    expect(ci.consignee.split('\n')[0]).toBe('RNA RESOURCES GROUP LIMITED')
    expect(ci.fox.contSize).toBe('01X40HQ')
    expect(ci.lines[0]).toMatchObject({ factory: '(AMP)', description: 'MIX ROSE & POM POM IN WOVEN VASE 18X18X20CM H', packing: '2 pc/box,12 pcs/ctn.', ctns: '136', qty: '1632' })
    expect(ci.lines[1]).toMatchObject({ ctns: '125', total: '6180.00' })

    // a new save in the other app shows up on the next refresh
    live.prepare('INSERT INTO proformas VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('pf2', '61001/M/S', 'PLAYSMART', '2026-10-01', 2, null, '', JSON.stringify({ ...SAMPLE_PF, header: { ...SAMPLE_PF.header, invoiceNo: '61001/M/S' } }))
    await ps.refresh(src)
    expect(ps.list().map((p) => p.invoiceNo)).toEqual(['61001/M/S', 'SM 46262 JW'])
    ps.close()
    live.close()
  })

  it('refuses a database that is not the Product Management App’s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pma-'))
    const src = join(dir, 'other.db')
    const d = new DatabaseSync(src)
    d.exec('CREATE TABLE x (a)')
    d.close()
    const ps = new ProformaSource(join(dir, 'work'), openNodeSqlite)
    await expect(ps.refresh(src)).rejects.toThrow(/no proforma invoices table/)
  })
})

describe('shipments store', () => {
  it('saves, lists, searches and logs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-'))
    const st = new ShipStore(join(dir, 'shipments.db'), openNodeSqlite)
    const ci = newInvoice(DEFAULT_CI, '2026-10-27')
    ci.invoiceNo = 'M/26/020'
    ci.vessel = 'OOCL NAGOYA'
    ci.etd = '2026-11-01'
    ci.lines = [{ ...blankLine(), ourItem: 'Y39AZPE44', qty: '10', price: '2', total: '20.00' }]
    const saved = st.save(ci)
    expect(saved.id).toBeTruthy()
    expect(st.list('nagoya')).toHaveLength(1)
    expect(st.list('y39azpe44')[0].amount).toBe(20)
    expect(st.duplicateOf('m/26/020', null)).toBe(saved.id)
    expect(st.duplicateOf('M/26/020', saved.id)).toBeNull()
    st.save({ ...saved, foxRecno: 12988 })
    expect(st.byRecno(12988)).toBe(saved.id)
    st.log({ at: 1, action: 'create', target: 'foxpro', invoiceNo: 'M/26/020', recno: 12988, detail: { a: 1 } })
    expect(st.changes()[0]).toMatchObject({ action: 'create', recno: 12988 })
    expect(st.timeline('2026-10-01')).toHaveLength(1)
    st.backupTo(join(dir, 'copy.db'))
    expect(existsSync(join(dir, 'copy.db'))).toBe(true)
    st.delete(saved.id!)
    expect(st.list()).toHaveLength(0)
    st.close()
  })
})
