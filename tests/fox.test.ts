/**
 * The FoxPro shipping layer against a COPY of the real table and index (real-data/, git-ignored).
 * Skipped when the copies are not there.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFromInvoice, updateFromInvoice, markDeleted, loadRows, readRecord, indexInfo, forgetCache, readRecordValues, updateFields } from '../src/main/foxShipping'
import { checkIdx } from '../src/main/dbf/idx'
import { parseDbfHeader } from '../src/main/dbf/reader'
import { newInvoice, blankLine, DEFAULT_CI } from '../src/shared/invoice'
import { invoiceFromFox } from '../src/shared/foxMap'

const SRC = join(__dirname, '..', 'real-data')
const has = existsSync(join(SRC, 'deldem shipping.DBF')) && existsSync(join(SRC, 'SHIPPING.IDX'))

describe.skipIf(!has)('FoxPro shipping table (copy of the real files)', () => {
  let dbf = ''
  let idx = ''
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'shp-'))
    dbf = join(dir, 'deldem shipping.DBF')
    idx = join(dir, 'SHIPPING.IDX')
    copyFileSync(join(SRC, 'deldem shipping.DBF'), dbf)
    copyFileSync(join(SRC, 'SHIPPING.IDX'), idx)
    forgetCache()
  })

  it('reads every record and the index matches the table', async () => {
    const t = await loadRows(dbf)
    expect(t.rows.length).toBe(12987)
    expect(t.rows.filter((r) => r.deleted).map((r) => r.recno).sort()).toEqual([12883, 12884, 12886])
    const m = t.rows.find((r) => r.invoiceNo === 'M/23/002')!
    expect(m).toMatchObject({ vessel: 'SM MAHI', containerNo: 'MRKU0380028', amount: 32301.12, etd: '2023-03-26', eta: '2023-04-02', payTerms: 'T/T' })
    const [i] = await indexInfo(dbf, [idx])
    expect(i.matches).toBe(true)
    expect(i.keys).toBe(12987)
  })

  it('creates, updates, deletes and recalls a record and keeps SHIPPING.IDX in step', async () => {
    const before = readFileSync(dbf)
    const ci = newInvoice(DEFAULT_CI, '2026-10-27')
    ci.invoiceNo = 'M/26/099'
    ci.vessel = 'MAERSK KOLKATA VERY LONG NAME 1'
    ci.voyage = '054W'
    ci.etd = '2026-11-02'
    ci.eta = '2026-11-20'
    ci.containerNo = 'MRKU0380028'
    ci.sealNo = 'ML-LK0395388'
    ci.paymentTerms = 'T/T 30 DAYS'
    ci.pod = 'JEBEL ALI'
    ci.fox.custCode = '9726'
    ci.fox.custName = 'HOME CENTRE LLC'
    ci.lines = [{ ...blankLine(), qty: '1632', price: '4.12', total: '6723.84', ctns: '136' }]
    const r = await createFromInvoice(dbf, [idx], ci, '2026-10-27')
    expect(r.recno).toBe(12988)
    expect(r.warnings.join(' ')).toMatch(/VASSEL holds 20/)
    expect(r.warnings.join(' ')).toMatch(/PAY_TERMS holds 3/)
    expect(r.reindexed).toEqual(['SHIPPING.IDX'])
    const after = readFileSync(dbf)
    const h = parseDbfHeader(after)
    expect(h.recordCount).toBe(12988)
    expect(after.length).toBe(before.length + h.recordLength)
    expect(after[after.length - 1]).toBe(0x1a)
    // the old records are byte-for-byte unchanged
    expect(after.subarray(h.headerLength, h.headerLength + 12987 * h.recordLength).equals(before.subarray(h.headerLength, h.headerLength + 12987 * h.recordLength))).toBe(true)
    const rec = await readRecord(dbf, 12988)
    const v = (n: string) => rec.fields.find((f) => f.name === n)!.value
    expect(v('COM_INV_NO')).toBe('M/26/099')
    expect(v('VASSEL')).toBe('MAERSK KOLKATA VERY')
    expect(v('PAY_TERMS')).toBe('T/T')
    expect(v('TOTAL_AMT')).toBe('6723.84')
    expect(v('SHIP_DATE')).toBe('2026-11-02')
    // memo pointer stays blank spaces, like FoxPro's own records
    const raw = after.subarray(h.headerLength + 12987 * h.recordLength)
    const memo = h.fields.find((f) => f.name === 'SHIPPING')!
    expect(raw.subarray(memo.offset, memo.offset + 10).toString('latin1')).toBe(' '.repeat(10))
    let [i] = await indexInfo(dbf, [idx])
    expect(i.matches).toBe(true)
    expect(checkIdx(readFileSync(idx)).entries.find((e) => e.recno === 12988)!.key.toString('latin1')).toBe('M/26/099       ')

    // the same invoice no cannot be added twice
    await expect(createFromInvoice(dbf, [idx], ci, '2026-10-27')).rejects.toThrow(/already in the FoxPro table/)

    // update: change the invoice no (index rebuilt) and the seal
    const ci2 = { ...ci, invoiceNo: 'M/26/100', sealNo: 'NEWSEAL1', foxRecno: 12988 }
    const u = await updateFromInvoice(dbf, [idx], 12988, 'M/26/099', ci2, '2026-10-28')
    expect(u.reindexed).toEqual(['SHIPPING.IDX'])
    ;[i] = await indexInfo(dbf, [idx])
    expect(i.matches).toBe(true)
    expect((await readRecord(dbf, 12988)).fields.find((f) => f.name === 'SEAL_NR')!.value).toBe('NEWSEAL1')
    // a stale invoice no is refused
    await expect(updateFromInvoice(dbf, [idx], 12988, 'M/26/099', ci2, '2026-10-28')).rejects.toThrow(/changed by someone else/)

    // delete then recall
    await markDeleted(dbf, 12988, 'M/26/100', true, '2026-10-28')
    expect((await readRecord(dbf, 12988)).deleted).toBe(true)
    ;[i] = await indexInfo(dbf, [idx])
    expect(i.matches).toBe(true) // the index keeps deleted records, as FoxPro's does
    await markDeleted(dbf, 12988, 'M/26/100', false, '2026-10-28')
    expect((await readRecord(dbf, 12988)).deleted).toBe(false)
  })

  it('opens an old record as an invoice and writes it back without changing other fields', async () => {
    const t = await loadRows(dbf)
    const row = t.rows.find((r) => r.invoiceNo === 'M/23/002')!
    const { values } = await readRecordValues(dbf, row.recno)
    const ci = invoiceFromFox(values, row.recno, DEFAULT_CI)
    expect(ci.vessel).toBe('SM MAHI')
    expect(ci.fox.contSize).toBe('01X40HQ')
    expect(ci.fox.shipLine).toBe('MAERSK LANKA')
    const before = readFileSync(dbf)
    const u = await updateFromInvoice(dbf, [idx], row.recno, 'M/23/002', ci, '2023-03-23')
    expect(u.reindexed).toEqual([])
    const after = readFileSync(dbf)
    const h = parseDbfHeader(after)
    const at = h.headerLength + (row.recno - 1) * h.recordLength
    // the record bytes are identical (only the header date may change)
    expect(after.subarray(at, at + h.recordLength).equals(before.subarray(at, at + h.recordLength))).toBe(true)
    const e = await updateFields(dbf, [idx], row.recno, { COM_INV_NO: 'M/23/002' }, { VASSEL: 'SM MAHI 2' }, '2023-03-23')
    expect(e.after.VASSEL).toBe('SM MAHI 2')
  })

  it('reads and writes text in the table\'s code page (Mac Roman)', async () => {
    const t = await loadRows(dbf)
    expect(t.header.codePageMark).toBe(0x04)
    const m = t.rows.find((r) => r.invoiceNo === 'M/26/015')!
    const rec = await readRecord(dbf, m.recno)
    expect(rec.fields.find((f) => f.name === 'STREET_1')!.value).toBe('HÖHENBURGSTR. 29')
    expect(t.rows.some((r) => r.customer.includes('DECORAÇÃO'))).toBe(true)
    // writing "Ö" stores byte 0x85, as FoxPro on this table does
    await updateFields(dbf, [idx], m.recno, { COM_INV_NO: 'M/26/015' }, { CITY: 'MÜNCHEN' }, '2026-10-27')
    const h = parseDbfHeader(readFileSync(dbf))
    const f = h.fields.find((x) => x.name === 'CITY')!
    const raw = readFileSync(dbf).subarray(h.headerLength + (m.recno - 1) * h.recordLength + f.offset, h.headerLength + (m.recno - 1) * h.recordLength + f.offset + 7)
    expect([...raw]).toEqual([0x4d, 0x86, 0x4e, 0x43, 0x48, 0x45, 0x4e])
    // a character Mac Roman cannot hold is refused, not changed
    await expect(updateFields(dbf, [idx], m.recno, { COM_INV_NO: 'M/26/015' }, { CITY: 'ŁÓDŹ' }, '2026-10-27')).rejects.toThrow(/cannot be stored/)
  })
})
