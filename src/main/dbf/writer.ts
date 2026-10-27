/**
 * WRITING to a FoxPro table. This is the ONLY code in the app that changes a DBF file, and it is used
 * only for the shipping table, only when "Save to the FoxPro shipping table" is switched on in
 * Settings (see foxShipping.ts). Everything else in the app opens DBF files read-only.
 *
 * What it does, and nothing more:
 * - updateRecord: overwrites named fields of ONE existing record in place (after checking the record
 *   is still what the user saw), and stamps the header's "last update" date.
 * - appendRecord: adds ONE record at the end and increases the record count in the header.
 * - setDeleted: marks ONE record deleted ('*', what FoxPro's DELETE does) or recalls it (RECALL).
 *   The record stays in the file until FoxPro's PACK, so a delete can be undone.
 * It never packs, restructures or reorders, and never writes fields it was not asked to.
 *
 * Two copies of this app writing at the same moment are kept apart by a lock file next to the table.
 * FoxPro's own record locks are NOT used, so the table must not be open for writing in FoxPro at the
 * same time (the new system works on its own copy of the database).
 */
import { open, rm, stat, type FileHandle } from 'node:fs/promises'
import { CP1252, codecFor, type Codec } from '@shared/codepage'
import { DbfLockedError, type DbfField, type DbfHeader } from './reader'
import { parseDbfHeader } from './reader'

export type WriteValue = string | number | null

export class DbfWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DbfWriteError'
  }
}

const LOCK_SUFFIX = '.shp-lock'
const LOCK_STALE_MS = 60_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A lock file next to the table: only one copy of the app writes at a time. */
async function withLock<T>(path: string, job: () => Promise<T>): Promise<T> {
  const lock = path + LOCK_SUFFIX
  let handle: FileHandle | null = null
  for (let attempt = 0; attempt < 50 && !handle; attempt++) {
    try {
      handle = await open(lock, 'wx')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new DbfWriteError(`Cannot write in the table's folder: ${(e as Error).message}`)
      const age = Date.now() - (await stat(lock).then((s) => s.mtimeMs, () => Date.now()))
      if (age > LOCK_STALE_MS) await rm(lock, { force: true })
      else await sleep(100)
    }
  }
  if (!handle) throw new DbfWriteError('Another copy of the app is saving to this table right now. Try again in a moment.')
  try {
    await handle.writeFile(`${process.pid} ${new Date().toISOString()}`)
    return await job()
  } finally {
    await handle.close().catch(() => undefined)
    await rm(lock, { force: true }).catch(() => undefined)
  }
}

async function openForWrite(path: string): Promise<FileHandle> {
  try {
    return await open(path, 'r+')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? ''
    if (['EBUSY', 'EPERM', 'EACCES'].includes(code)) throw new DbfLockedError(path, code)
    throw e
  }
}

async function readAt(fh: FileHandle, length: number, position: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const { bytesRead } = await fh.read(buf, done, length - done, position + done)
    if (!bytesRead) break
    done += bytesRead
  }
  if (done !== length) throw new DbfWriteError('The table is shorter than its header says; nothing was written.')
  return buf
}

async function writeAt(fh: FileHandle, buf: Uint8Array, position: number) {
  let done = 0
  while (done < buf.length) done += (await fh.write(buf, done, buf.length - done, position + done)).bytesWritten
}

async function header(fh: FileHandle): Promise<DbfHeader> {
  const first = await readAt(fh, 32, 0)
  return parseDbfHeader(await readAt(fh, first.readUInt16LE(8), 0))
}

/** The stored bytes for a value in a field; throws when the value does not fit. */
export function encodeField(f: DbfField, value: WriteValue, codec: Codec = CP1252): Buffer {
  const blank = value === null || value === undefined || value === ''
  switch (f.type) {
    case 'C': {
      const text = blank ? '' : String(value)
      const bad = codec.unencodable(text)
      if (bad.length) throw new DbfWriteError(`${f.name}: the character${bad.length > 1 ? 's' : ''} ${bad.join(' ')} cannot be stored in the FoxPro table.`)
      const bytes = codec.encode(text)
      if (bytes.length > f.length) throw new DbfWriteError(`${f.name}: "${text}" is too long (${bytes.length} characters; the field holds ${f.length}).`)
      const out = Buffer.alloc(f.length, 0x20)
      out.set(bytes)
      return out
    }
    case 'N':
    case 'F': {
      if (blank) return Buffer.alloc(f.length, 0x20)
      const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''))
      if (!Number.isFinite(n)) throw new DbfWriteError(`${f.name}: "${value}" is not a number.`)
      const s = n.toFixed(f.decimals)
      if (s.length > f.length) throw new DbfWriteError(`${f.name}: ${s} is too large for the field (${f.length} characters${f.decimals ? `, ${f.decimals} decimals` : ''}).`)
      return Buffer.from(s.padStart(f.length), 'latin1')
    }
    case 'D': {
      if (blank) return Buffer.alloc(8, 0x20)
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
      if (!m) throw new DbfWriteError(`${f.name}: "${value}" is not a date (YYYY-MM-DD).`)
      return Buffer.from(m[1] + m[2] + m[3], 'latin1')
    }
    case 'L':
      return Buffer.from(blank ? ' ' : value === 'T' || value === 'Y' || value === 1 ? 'T' : 'F', 'latin1')
    default:
      throw new DbfWriteError(`${f.name}: fields of type ${f.type} cannot be written by the app.`)
  }
}

/** The value of a field as plain text, for comparing and for the change log. */
export function fieldText(f: DbfField, rec: Buffer, codec: Codec = CP1252): string {
  const raw = rec.subarray(f.offset, f.offset + f.length)
  if (f.type === 'C') return codec.decode(raw).replace(/[\s\0]+$/, '')
  if (f.type === 'D') {
    const s = raw.toString('latin1').trim()
    return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ''
  }
  return raw.toString('latin1').trim()
}

function sameValue(f: DbfField, a: string, b: string): boolean {
  if (f.type === 'N' || f.type === 'F') {
    const x = a.trim() === '' ? 0 : Number(a)
    const y = b.trim() === '' ? 0 : Number(b)
    return x === y
  }
  return a.trimEnd() === b.trimEnd()
}

function fieldsByName(h: DbfHeader, names: string[]): DbfField[] {
  return names.map((n) => {
    const f = h.fields.find((x) => x.name === n.toUpperCase())
    if (!f) throw new DbfWriteError(`The table has no field ${n}.`)
    return f
  })
}

function checkSize(h: DbfHeader, size: number) {
  const expected = h.headerLength + h.recordCount * h.recordLength
  if (size < expected) throw new DbfWriteError(`The table is incomplete (${size} bytes; ${expected} expected for ${h.recordCount} records). Nothing was written.`)
  if (size > expected + h.recordLength + 1) throw new DbfWriteError('The table holds more data than its header says. It needs checking in FoxPro before the app writes to it.')
}

async function stampHeader(fh: FileHandle, recordCount: number | null, today: string) {
  const [y, m, d] = today.split('-').map(Number)
  await writeAt(fh, Uint8Array.from([y % 100, m, d]), 1)
  if (recordCount !== null) {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(recordCount, 0)
    await writeAt(fh, b, 4)
  }
}

export interface UpdateResult {
  recno: number
  before: Record<string, string>
  after: Record<string, string>
  changed: string[]
}

/**
 * Change fields of one record. `expect` are values the record must still have (as text; the product
 * code and what the user saw before editing): if any differs the record was changed by someone else
 * and nothing is written.
 */
export async function updateRecord(
  path: string,
  recno: number,
  expect: Record<string, string>,
  set: Record<string, WriteValue>,
  today: string
): Promise<UpdateResult> {
  return withLock(path, async () => {
    const fh = await openForWrite(path)
    try {
      const h = await header(fh)
      const cc = codecFor(h.codePageMark)
      checkSize(h, (await fh.stat()).size)
      if (!Number.isInteger(recno) || recno < 1 || recno > h.recordCount) throw new DbfWriteError(`Record ${recno} does not exist in the table.`)
      const pos = h.headerLength + (recno - 1) * h.recordLength
      const rec = await readAt(fh, h.recordLength, pos)
      if (rec[0] === 0x2a) throw new DbfWriteError('This record is marked deleted in the FoxPro table; it was not changed.')
      for (const f of fieldsByName(h, Object.keys(expect))) {
        const now = fieldText(f, rec, cc)
        if (!sameValue(f, now, expect[f.name] ?? expect[f.name.toLowerCase()] ?? ''))
          throw new DbfWriteError(`The record was changed by someone else since you opened it (${f.name} is now "${now}"). Reopen the record and try again.`)
      }
      const before: Record<string, string> = {}
      const after: Record<string, string> = {}
      const changed: string[] = []
      const next = Buffer.from(rec)
      for (const f of fieldsByName(h, Object.keys(set))) {
        const bytes = encodeField(f, set[f.name] ?? null, cc)
        before[f.name] = fieldText(f, rec, cc)
        bytes.copy(next, f.offset)
        after[f.name] = fieldText(f, next, cc)
        if (!bytes.equals(rec.subarray(f.offset, f.offset + f.length))) changed.push(f.name)
      }
      if (changed.length) {
        await writeAt(fh, next, pos)
        await stampHeader(fh, null, today)
        await fh.sync()
        const check = await readAt(fh, h.recordLength, pos)
        if (!check.equals(next)) throw new DbfWriteError('The record could not be verified after writing. Check the record in FoxPro.')
      }
      return { recno, before, after, changed }
    } finally {
      await fh.close()
    }
  })
}

export interface AppendResult {
  recno: number
  after: Record<string, string>
}

/**
 * Add one record at the end. `unique`: a field whose value (ignoring case and surrounding spaces)
 * no other non-deleted record may have, e.g. the product code.
 */
export async function appendRecord(
  path: string,
  values: Record<string, WriteValue>,
  today: string,
  unique?: { field: string; value: string }
): Promise<AppendResult> {
  return withLock(path, async () => {
    const fh = await openForWrite(path)
    try {
      const h = await header(fh)
      const cc = codecFor(h.codePageMark)
      const size = (await fh.stat()).size
      checkSize(h, size)
      if (unique) {
        const [f] = fieldsByName(h, [unique.field])
        const want = unique.value.trim().replace(/\s+/g, ' ').toUpperCase()
        const chunk = 2000
        for (let start = 0; start < h.recordCount; start += chunk) {
          const n = Math.min(chunk, h.recordCount - start)
          const buf = await readAt(fh, n * h.recordLength, h.headerLength + start * h.recordLength)
          for (let i = 0; i < n; i++) {
            const rec = buf.subarray(i * h.recordLength, (i + 1) * h.recordLength)
            if (rec[0] === 0x2a) continue
            if (fieldText(f, rec, cc).trim().replace(/\s+/g, ' ').toUpperCase() === want)
              throw new DbfWriteError(`${unique.value} is already in the FoxPro table (record ${start + i + 1}).`)
          }
        }
      }
      const rec = Buffer.alloc(h.recordLength, 0x20)
      for (const f of h.fields) {
        // binary field types and the null-flags field start as zero bytes; a FoxPro 2.x memo pointer
        // (10 characters) is blank as spaces, like the records FoxPro writes itself
        if (['M', 'G'].includes(f.type) && f.length === 10) continue
        if (!['C', 'N', 'F', 'D', 'L'].includes(f.type)) rec.fill(0, f.offset, f.offset + f.length)
      }
      const after: Record<string, string> = {}
      for (const f of fieldsByName(h, Object.keys(values))) {
        encodeField(f, values[f.name] ?? null, cc).copy(rec, f.offset)
        after[f.name] = fieldText(f, rec, cc)
      }
      const recno = h.recordCount + 1
      const pos = h.headerLength + h.recordCount * h.recordLength
      await writeAt(fh, Buffer.concat([rec, Buffer.from([0x1a])]), pos)
      await stampHeader(fh, recno, today)
      await fh.sync()
      const check = await readAt(fh, h.recordLength, pos)
      const h2 = await header(fh)
      if (!check.equals(rec) || h2.recordCount !== recno) throw new DbfWriteError('The new record could not be verified after writing. Check the table in FoxPro.')
      return { recno, after }
    } finally {
      await fh.close()
    }
  })
}

export interface DeleteResult {
  recno: number
  deleted: boolean
}

/**
 * Mark one record deleted (deleted = true, FoxPro DELETE) or undeleted (false, FoxPro RECALL).
 * `expect` as in updateRecord: the record must still hold these values.
 */
export async function setDeleted(path: string, recno: number, expect: Record<string, string>, deleted: boolean, today: string): Promise<DeleteResult> {
  return withLock(path, async () => {
    const fh = await openForWrite(path)
    try {
      const h = await header(fh)
      const cc = codecFor(h.codePageMark)
      checkSize(h, (await fh.stat()).size)
      if (!Number.isInteger(recno) || recno < 1 || recno > h.recordCount) throw new DbfWriteError(`Record ${recno} does not exist in the table.`)
      const pos = h.headerLength + (recno - 1) * h.recordLength
      const rec = await readAt(fh, h.recordLength, pos)
      for (const f of fieldsByName(h, Object.keys(expect))) {
        const now = fieldText(f, rec, cc)
        if (!sameValue(f, now, expect[f.name] ?? expect[f.name.toLowerCase()] ?? ''))
          throw new DbfWriteError(`The record was changed by someone else since you opened it (${f.name} is now "${now}"). Reopen the record and try again.`)
      }
      const flag = deleted ? 0x2a : 0x20
      if (rec[0] !== flag) {
        await writeAt(fh, Uint8Array.from([flag]), pos)
        await stampHeader(fh, null, today)
        await fh.sync()
        const check = await readAt(fh, 1, pos)
        if (check[0] !== flag) throw new DbfWriteError('The record could not be verified after writing. Check the record in FoxPro.')
      }
      return { recno, deleted }
    } finally {
      await fh.close()
    }
  })
}
