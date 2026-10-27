/**
 * The FoxPro shipping table (deldem shipping.DBF + SHIPPING.IDX): list, read, create, update, delete.
 *
 * Reading opens the file read-only. Writing goes through dbf/writer.ts (one record at a time, after
 * checking the record is still what the user saw) and only when "Save to the FoxPro shipping table"
 * is on. After a record is added, or its invoice number changes, every index file ticked in Settings
 * is rebuilt from the table (what FoxPro's REINDEX does); those indexes must match the table before
 * anything is written. A delete only marks the record ('*'), like FoxPro's DELETE, and can be undone.
 */
import { open, readFile, stat, readdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { findMemoPath, parseDbfHeader, type DbfField, type DbfHeader } from './dbf/reader'
import { appendRecord, DbfWriteError, encodeField, fieldText, setDeleted, updateRecord, type WriteValue } from './dbf/writer'
import { checkIdx, idxStatus, rebuildIdx } from './dbf/idx'
import { codecFor, type Codec } from '@shared/codepage'
import { KEY_FIELD, NEVER_WRITTEN, foxValues, type FieldInfo, type FoxValue } from '@shared/foxMap'
import type { CommercialInvoice } from '@shared/invoice'
import type { FoxRecord, FoxRow, FoxStatus, IdxInfo } from '@shared/types'

interface Loaded {
  sig: string
  header: DbfHeader
  rows: FoxRow[]
}

let cache: Loaded | null = null

const sigOf = (s: { size: number; mtimeMs: number }) => `${s.size}:${s.mtimeMs}`

function fieldMap(h: DbfHeader): Map<string, DbfField> {
  return new Map(h.fields.map((f) => [f.name, f]))
}

function text(f: DbfField | undefined, rec: Buffer, cc: Codec): string {
  return f ? fieldText(f, rec, cc) : ''
}

/** All records (deleted ones too, flagged), newest first. Cached until the file changes. */
export async function loadRows(path: string): Promise<Loaded> {
  const st = await stat(path)
  if (cache && cache.sig === sigOf(st) && cache.header) return cache
  const buf = await readFile(path) // read-only open
  const h = parseDbfHeader(buf)
  const m = fieldMap(h)
  const cc = codecFor(h.codePageMark)
  const F = (n: string) => m.get(n)
  const count = Math.min(h.recordCount, Math.floor((buf.length - h.headerLength) / h.recordLength))
  const rows: FoxRow[] = []
  for (let r = 0; r < count; r++) {
    const rec = buf.subarray(h.headerLength + r * h.recordLength, h.headerLength + (r + 1) * h.recordLength)
    if (rec[0] === 0x1a) break
    const amt = text(F('TOTAL_AMT'), rec, cc)
    rows.push({
      recno: r + 1,
      deleted: rec[0] === 0x2a,
      invoiceNo: text(F('COM_INV_NO'), rec, cc).trim(),
      date: text(F('DTE_OF_INV'), rec, cc),
      custCode: text(F('CUST_CODE'), rec, cc).trim(),
      customer: text(F('CUST_NAME'), rec, cc).trim(),
      country: text(F('COUNTRY'), rec, cc).trim(),
      vessel: text(F('VASSEL'), rec, cc).trim(),
      containerNo: text(F('CONT_NO'), rec, cc).trim(),
      amount: amt.trim() === '' ? null : Number(amt),
      etd: text(F('SHIP_DATE'), rec, cc),
      eta: text(F('ARIVAL_DTE'), rec, cc),
      payTerms: text(F('PAY_TERMS'), rec, cc).trim(),
      appId: null
    })
  }
  rows.reverse()
  cache = { sig: sigOf(st), header: h, rows }
  return cache
}

export function forgetCache() {
  cache = null
}

const fold = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim()

export function searchRows(rows: FoxRow[], query: string, showDeleted: boolean): FoxRow[] {
  const words = fold(query).split(' ').filter(Boolean)
  return rows.filter((r) => {
    if (r.deleted && !showDeleted) return false
    if (!words.length) return true
    const hay = fold(`${r.invoiceNo} ${r.customer} ${r.custCode} ${r.country} ${r.vessel} ${r.containerNo} ${r.date} ${r.recno}`)
    return words.every((w) => hay.includes(w))
  })
}

async function readHeaderAndRecord(path: string, recno: number): Promise<{ h: DbfHeader; rec: Buffer }> {
  const fh = await open(path, 'r')
  try {
    const first = Buffer.alloc(32)
    await fh.read(first, 0, 32, 0)
    const hb = Buffer.alloc(first.readUInt16LE(8))
    await fh.read(hb, 0, hb.length, 0)
    const h = parseDbfHeader(hb)
    if (!Number.isInteger(recno) || recno < 1 || recno > h.recordCount) throw new Error(`Record ${recno} does not exist in the shipping table.`)
    const rec = Buffer.alloc(h.recordLength)
    const { bytesRead } = await fh.read(rec, 0, h.recordLength, h.headerLength + (recno - 1) * h.recordLength)
    if (bytesRead !== h.recordLength) throw new Error(`Record ${recno} could not be read.`)
    return { h, rec }
  } finally {
    await fh.close()
  }
}

const isWritable = (f: DbfField) => ['C', 'N', 'F', 'D', 'L'].includes(f.type) && !NEVER_WRITTEN.has(f.name)

/** One record, every field as text. */
export async function readRecord(path: string, recno: number): Promise<FoxRecord> {
  const { h, rec } = await readHeaderAndRecord(path, recno)
  return {
    recno,
    deleted: rec[0] === 0x2a,
    fields: h.fields
      .filter((f) => f.type !== '0')
      .map((f) => ({
        name: f.name,
        type: f.type,
        length: f.length,
        decimals: f.decimals,
        value: ['M', 'G'].includes(f.type) ? '' : fieldText(f, rec, codecFor(h.codePageMark)),
        writable: isWritable(f)
      }))
  }
}

/** One record as field → decoded value (numbers as numbers), for opening it as an invoice. */
export async function readRecordValues(path: string, recno: number): Promise<{ values: Record<string, string | number | null>; deleted: boolean }> {
  const r = await readRecord(path, recno)
  const values: Record<string, string | number | null> = {}
  for (const f of r.fields) {
    if (f.type === 'N' || f.type === 'F') values[f.name] = f.value.trim() === '' ? null : Number(f.value)
    else values[f.name] = f.value
  }
  return { values, deleted: r.deleted }
}

export async function fieldInfo(path: string): Promise<FieldInfo[]> {
  const fh = await open(path, 'r')
  try {
    const first = Buffer.alloc(32)
    await fh.read(first, 0, 32, 0)
    const hb = Buffer.alloc(first.readUInt16LE(8))
    await fh.read(hb, 0, hb.length, 0)
    return parseDbfHeader(hb).fields.map((f) => ({ name: f.name, type: f.type, length: f.length, decimals: f.decimals }))
  } finally {
    await fh.close()
  }
}

/**
 * Make typed values fit the table: text longer than the field is cut (and reported), dates must be
 * YYYY-MM-DD, numbers must fit. Characters that Windows-1252 cannot hold are refused.
 */
export function fitValues(h: Pick<DbfHeader, 'fields' | 'codePageMark'>, values: Record<string, FoxValue>): { set: Record<string, WriteValue>; warnings: string[] } {
  const m = new Map(h.fields.map((f) => [f.name, f]))
  const cc = codecFor(h.codePageMark)
  const set: Record<string, WriteValue> = {}
  const warnings: string[] = []
  for (const [name, raw] of Object.entries(values)) {
    const f = m.get(name)
    if (!f || !isWritable(f)) continue
    let v: WriteValue = raw
    if (f.type === 'C') {
      let s = String(raw ?? '').replace(/\r?\n/g, ' ')
      const bad = cc.unencodable(s)
      if (bad.length) throw new DbfWriteError(`${name}: the character${bad.length > 1 ? 's' : ''} ${bad.join(' ')} cannot be stored in the FoxPro table.`)
      if (s.length > f.length) {
        warnings.push(`${name} holds ${f.length} characters: "${s}" is saved in FoxPro as "${s.slice(0, f.length).trimEnd()}".`)
        s = s.slice(0, f.length)
      }
      v = s
    } else if (f.type === 'D') {
      const s = String(raw ?? '').trim()
      if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new DbfWriteError(`${name}: "${s}" is not a date.`)
      v = s
    } else if (f.type === 'N' || f.type === 'F') {
      const s = raw === null || raw === undefined ? '' : String(raw).trim()
      v = s === '' ? null : Number(s.replace(/[,\s]/g, ''))
    }
    encodeField(f, v, cc) // throws a clear message when it still does not fit (a number too large …)
    set[name] = v
  }
  return { set, warnings }
}

/** .IDX files next to the table. */
export async function indexCandidates(path: string): Promise<string[]> {
  try {
    const dir = dirname(path)
    return (await readdir(dir)).filter((n) => extname(n).toLowerCase() === '.idx').map((n) => join(dir, n)).sort()
  } catch {
    return []
  }
}

export async function indexInfo(tablePath: string, idxPaths: string[]): Promise<IdxInfo[]> {
  if (!idxPaths.length) return []
  const table = await readFile(tablePath)
  const out: IdxInfo[] = []
  for (const p of idxPaths) {
    try {
      out.push(idxStatus(p, await readFile(p), table))
    } catch (e) {
      out.push({ path: p, field: '', keys: 0, records: 0, matches: false, note: `Cannot read it: ${(e as Error).message}` })
    }
  }
  return out
}

/** The index key expression of an .IDX file (for Settings, to tell which index belongs to which table). */
export async function idxKey(path: string): Promise<string> {
  const c = checkIdx(await readFile(path))
  return c.keyExpression
}

export async function status(path: string, idxPaths: string[], writeOn: boolean): Promise<FoxStatus> {
  const base: FoxStatus = {
    configured: !!path, path, ok: false, message: '', records: 0, deleted: 0, lastUpdate: null, version: '', codePage: '',
    fileSize: 0, memoFile: null, indexes: [], indexCandidates: [], writeOn
  }
  if (!path) return { ...base, message: 'Not linked yet. Choose the FoxPro shipping table in Settings.' }
  try {
    const loaded = await loadRows(path)
    const st = await stat(path)
    const h = loaded.header
    const problems: string[] = []
    if (!h.fields.some((f) => f.name === KEY_FIELD)) problems.push(`it has no ${KEY_FIELD} field — is this the shipping table?`)
    return {
      ...base,
      ok: problems.length === 0,
      message: problems.join(' '),
      records: loaded.rows.length,
      deleted: loaded.rows.filter((r) => r.deleted).length,
      lastUpdate: h.lastUpdate,
      version: h.versionName,
      codePage: `${h.codePageName} — text read and written as ${codecFor(h.codePageMark).name}`,
      fileSize: st.size,
      memoFile: h.hasMemoField ? findMemoPath(path) : null,
      indexes: await indexInfo(path, idxPaths),
      indexCandidates: await indexCandidates(path)
    }
  } catch (e) {
    return { ...base, message: (e as Error).message }
  }
}

async function requireIndexesMatch(path: string, idxPaths: string[]) {
  const info = await indexInfo(path, idxPaths)
  const bad = info.filter((i) => !i.matches)
  if (bad.length)
    throw new DbfWriteError(
      `Nothing was written: ${bad.map((b) => `${basename(b.path)} — ${b.note}`).join('; ')}. Open Settings and rebuild the index first (or untick it).`
    )
}

async function reindex(path: string, idxPaths: string[]): Promise<string[]> {
  const done: string[] = []
  for (const p of idxPaths) {
    await rebuildIdx(p, path)
    done.push(basename(p))
  }
  return done
}

export interface FoxWriteResult {
  recno: number
  warnings: string[]
  reindexed: string[]
  before: Record<string, string>
  after: Record<string, string>
}

async function header(path: string): Promise<DbfHeader> {
  const fh = await open(path, 'r')
  try {
    const first = Buffer.alloc(32)
    await fh.read(first, 0, 32, 0)
    const hb = Buffer.alloc(first.readUInt16LE(8))
    await fh.read(hb, 0, hb.length, 0)
    return parseDbfHeader(hb)
  } finally {
    await fh.close()
  }
}

/** Add the invoice as a new record. */
export async function createFromInvoice(path: string, idxPaths: string[], ci: CommercialInvoice, today: string): Promise<FoxWriteResult> {
  if (!ci.invoiceNo.trim()) throw new DbfWriteError('Type the commercial invoice no first.')
  await requireIndexesMatch(path, idxPaths)
  const h = await header(path)
  const { set, warnings } = fitValues(h, foxValues(ci))
  const r = await appendRecord(path, set, today, { field: KEY_FIELD, value: String(set[KEY_FIELD] ?? '') })
  forgetCache()
  const reindexed = await reindex(path, idxPaths)
  return { recno: r.recno, warnings, reindexed, before: {}, after: r.after }
}

/** Write the invoice over its linked record (`expectKey`: the invoice no the record must still have). */
export async function updateFromInvoice(path: string, idxPaths: string[], recno: number, expectKey: string, ci: CommercialInvoice, today: string): Promise<FoxWriteResult> {
  if (!ci.invoiceNo.trim()) throw new DbfWriteError('Type the commercial invoice no first.')
  const h = await header(path)
  const { set, warnings } = fitValues(h, foxValues(ci))
  return updateFields(path, idxPaths, recno, { [KEY_FIELD]: expectKey }, set, today, warnings)
}

/** Change named fields of one record (the FoxPro records editor, and updateFromInvoice). */
export async function updateFields(
  path: string,
  idxPaths: string[],
  recno: number,
  expect: Record<string, string>,
  values: Record<string, FoxValue>,
  today: string,
  warnings: string[] = []
): Promise<FoxWriteResult> {
  const h = await header(path)
  const fitted = fitValues(h, values)
  const keyChanges = KEY_FIELD in fitted.set && String(fitted.set[KEY_FIELD] ?? '').trimEnd() !== String(expect[KEY_FIELD] ?? '').trimEnd()
  if (keyChanges) await requireIndexesMatch(path, idxPaths)
  const r = await updateRecord(path, recno, expect, fitted.set, today)
  forgetCache()
  const reindexed = keyChanges && r.changed.includes(KEY_FIELD) ? await reindex(path, idxPaths) : []
  return { recno, warnings: [...warnings, ...fitted.warnings.filter((w) => !warnings.includes(w))], reindexed, before: r.before, after: r.after }
}

/** Mark a record deleted (or recall it). The index keeps deleted records, as FoxPro does: no reindex. */
export async function markDeleted(path: string, recno: number, expectKey: string, deleted: boolean, today: string) {
  const r = await setDeleted(path, recno, { [KEY_FIELD]: expectKey }, deleted, today)
  forgetCache()
  return r
}

/** Rebuild the given indexes from the table (Settings). */
export async function rebuildIndexes(path: string, idxPaths: string[]): Promise<string[]> {
  const r = await reindex(path, idxPaths)
  forgetCache()
  return r
}

