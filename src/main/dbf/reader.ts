/**
 * Read-only reader for dBase / Visual FoxPro tables (.DBF) and FoxPro memo files (.FPT).
 *
 * SAFETY: this module is the only code that touches the company's DBF files.
 * - Every file is opened with flag 'r' (GENERIC_READ). On Windows, Node/libuv opens with
 *   FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, so FoxPro can keep reading and
 *   writing the same files while we read them.
 * - There is no write, append, pack or reindex code here, and .CDX index files are never opened.
 * - Field offsets and widths are taken from the file header at run time; fields are looked up by name.
 */
import { open, stat, type FileHandle } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, basename, extname, join } from 'node:path'
import { readdirSync } from 'node:fs'

export interface DbfField {
  name: string
  type: string
  offset: number // offset inside the record, including the 1-byte deletion flag
  length: number
  decimals: number
  flags: number
  nullBit: number | null // bit index in _NullFlags when the field is nullable
}

export interface DbfHeader {
  version: number
  versionName: string
  lastUpdate: string | null // YYYY-MM-DD from the header
  recordCount: number // as stated in the header
  headerLength: number
  recordLength: number
  codePageMark: number
  codePageName: string
  fields: DbfField[]
  hasMemoField: boolean
}

export type DbfValue = string | number | boolean | null
export type DbfRecord = Record<string, DbfValue>

export interface ReadStats {
  recordsInHeader: number
  recordsPresent: number // records the file size has room for, as reported when opened
  recordsRead: number // non-deleted records returned
  deletedSkipped: number
  memoErrors: number
  fileSize: number
  /** Records actually examined (read + deleted). */
  recordsScanned: number
  /**
   * True when clearly fewer records could be read than the header says (more than a few, which can
   * be missing for a moment while FoxPro appends): a partial network read, a table being rewritten
   * (PACK) or an incomplete copy. Such a read must not replace a good saved copy.
   */
  incomplete: boolean
}

/** Records that may be missing for a moment while FoxPro appends, before a read counts as incomplete. */
export const APPEND_TOLERANCE = 20

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class DbfLockedError extends Error {
  constructor(public readonly path: string, public readonly code: string) {
    super(`The file is locked by another program (${code}): ${path}`)
    this.name = 'DbfLockedError'
  }
}

const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EIO'])

const VERSION_NAMES: Record<number, string> = {
  0x02: 'FoxBASE',
  0x03: 'dBase III / FoxPro (no memo)',
  0x30: 'Visual FoxPro',
  0x31: 'Visual FoxPro (autoincrement)',
  0x32: 'Visual FoxPro (varchar/varbinary)',
  0x83: 'dBase III with memo',
  0xf5: 'FoxPro 2.x with memo',
  0xfb: 'FoxBASE'
}

const CODE_PAGES: Record<number, string> = {
  0x00: 'not set',
  0x01: 'DOS USA (437)',
  0x02: 'DOS Multilingual (850)',
  0x03: 'Windows ANSI (1252)',
  0x04: 'Macintosh (Mac Roman)',
  0x57: 'Windows ANSI (1252)',
  0xc8: 'Windows EE (1250)',
  0xc9: 'Russian Windows (1251)'
}

/** Field types this reader decodes. Anything else is reported by the data check. */
export const SUPPORTED_TYPES = new Set(['C', 'N', 'F', 'D', 'L', 'I', 'B', 'Y', 'T', 'M', 'V', '0'])

const decoder = new TextDecoder('windows-1252')

export function decodeText(buf: Uint8Array): string {
  return decoder.decode(buf)
}

async function openReadOnly(path: string): Promise<FileHandle> {
  try {
    return await open(path, 'r')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? ''
    if (LOCK_CODES.has(code)) throw new DbfLockedError(path, code)
    throw err
  }
}

async function readExactly(fh: FileHandle, length: number, position: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const { bytesRead } = await fh.read(buf, done, length - done, position + done)
    if (bytesRead === 0) break
    done += bytesRead
  }
  return done === length ? buf : buf.subarray(0, done)
}

export function parseDbfHeader(buf: Buffer): DbfHeader {
  if (buf.length < 32) throw new Error('File is too short to be a DBF table.')
  const version = buf[0]
  const yy = buf[1]
  const year = yy < 100 ? (yy >= 80 ? 1900 + yy : 2000 + yy) : 1900 + yy
  const mm = buf[2]
  const dd = buf[3]
  const lastUpdate =
    mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31
      ? `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      : null
  const recordCount = buf.readUInt32LE(4)
  const headerLength = buf.readUInt16LE(8)
  const recordLength = buf.readUInt16LE(10)
  const codePageMark = buf[29]

  const fields: DbfField[] = []
  let nullBit = 0
  for (let p = 32; p + 32 <= buf.length && buf[p] !== 0x0d; p += 32) {
    const rawName = buf.subarray(p, p + 11)
    const end = rawName.indexOf(0)
    const name = decodeText(rawName.subarray(0, end < 0 ? 11 : end)).trim().toUpperCase()
    const type = String.fromCharCode(buf[p + 11]).toUpperCase()
    const isVfp = version === 0x30 || version === 0x31 || version === 0x32
    // VFP stores the field's displacement in the record at bytes 12-15; older formats leave it zero.
    const storedOffset = isVfp ? buf.readUInt32LE(p + 12) : 0
    let length = buf[p + 16]
    let decimals = buf[p + 17]
    if (type === 'C' && !isVfp && decimals > 0) {
      // Clipper/FoxBASE long character fields use the decimals byte as the high byte of the length.
      length = length + decimals * 256
      decimals = 0
    }
    const flags = buf[p + 18]
    const nullable = isVfp && (flags & 0x02) !== 0
    fields.push({ name, type, offset: storedOffset, length, decimals, flags, nullBit: null })
    if (type === 'V' || type === 'Q') nullBit++ // varlength bit (we still treat V as fixed text)
    if (nullable) fields[fields.length - 1].nullBit = nullBit++
  }
  // Compute offsets from widths when the header doesn't carry them (or carries zeros).
  let running = 1
  const offsetsValid = fields.length > 0 && fields.every((f, i) => i === 0 ? f.offset === 1 : f.offset > 0)
  for (const f of fields) {
    if (!offsetsValid) f.offset = running
    running += f.length
  }

  return {
    version,
    versionName: VERSION_NAMES[version] ?? `unknown (0x${version.toString(16)})`,
    lastUpdate,
    recordCount,
    headerLength,
    recordLength,
    codePageMark,
    codePageName: CODE_PAGES[codePageMark] ?? `0x${codePageMark.toString(16)}`,
    fields,
    hasMemoField: fields.some((f) => f.type === 'M' || f.type === 'G' || f.type === 'W')
  }
}

export async function readHeader(path: string): Promise<DbfHeader> {
  const fh = await openReadOnly(path)
  try {
    const first = await readExactly(fh, 32, 0)
    const headerLength = first.length >= 10 ? first.readUInt16LE(8) : 0
    const full = await readExactly(fh, Math.max(headerLength, 32), 0)
    return parseDbfHeader(full)
  } finally {
    await fh.close()
  }
}

/** Find the memo file next to a DBF (same base name, .FPT or .DBT, any case). Read-only directory listing. */
export function findMemoPath(dbfPath: string): string | null {
  const dir = dirname(dbfPath)
  const base = basename(dbfPath, extname(dbfPath)).toLowerCase()
  try {
    for (const name of readdirSync(dir)) {
      const ext = extname(name).toLowerCase()
      if ((ext === '.fpt' || ext === '.dbt') && basename(name, extname(name)).toLowerCase() === base) {
        return join(dir, name)
      }
    }
  } catch {
    /* fall through */
  }
  const guess = join(dir, `${basename(dbfPath, extname(dbfPath))}.FPT`)
  return existsSync(guess) ? guess : null
}

class MemoReader {
  private blockSize = 512
  private constructor(private fh: FileHandle, private isFpt: boolean) {}

  static async open(path: string): Promise<MemoReader> {
    const fh = await openReadOnly(path)
    const isFpt = extname(path).toLowerCase() === '.fpt'
    const r = new MemoReader(fh, isFpt)
    const head = await readExactly(fh, 8, 0)
    if (isFpt && head.length >= 8) {
      const bs = head.readUInt16BE(6)
      r.blockSize = bs > 0 ? bs : 512
    }
    return r
  }

  get size(): number {
    return this.blockSize
  }

  async read(block: number): Promise<string> {
    if (block <= 0) return ''
    const pos = block * this.blockSize
    if (this.isFpt) {
      const head = await readExactly(this.fh, 8, pos)
      if (head.length < 8) throw new Error(`memo block ${block} past end of file`)
      const len = head.readUInt32BE(4)
      if (len > 16 * 1024 * 1024) throw new Error(`memo block ${block} has implausible length ${len}`)
      return decodeText(await readExactly(this.fh, len, pos + 8))
    }
    // dBase III .DBT: text terminated by 0x1A 0x1A
    const chunks: Buffer[] = []
    for (let p = pos; ; p += 512) {
      const b = await readExactly(this.fh, 512, p)
      if (b.length === 0) break
      const end = b.indexOf(0x1a)
      chunks.push(end >= 0 ? b.subarray(0, end) : b)
      if (end >= 0 || b.length < 512) break
    }
    return decodeText(Buffer.concat(chunks))
  }

  close(): Promise<void> {
    return this.fh.close()
  }
}

function julianToIso(jd: number, ms: number): string | null {
  if (jd <= 0) return null
  const unixMs = (jd - 2440588) * 86400000 + ms
  return new Date(unixMs).toISOString().replace('T', ' ').slice(0, 19)
}

function decodeField(f: DbfField, rec: Buffer): DbfValue | { memoBlock: number } {
  const raw = rec.subarray(f.offset, f.offset + f.length)
  switch (f.type) {
    case 'C':
    case 'V':
      return decodeText(raw).replace(/[\s\0]+$/, '')
    case 'N':
    case 'F': {
      const s = raw.toString('latin1').trim()
      if (s === '' || /^\*+$/.test(s)) return null
      const n = Number(s)
      return Number.isFinite(n) ? n : null
    }
    case 'D': {
      const s = raw.toString('latin1').trim()
      if (!/^\d{8}$/.test(s) || s === '00000000') return null
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
    }
    case 'L': {
      const c = String.fromCharCode(raw[0]).toUpperCase()
      if (c === 'T' || c === 'Y') return true
      if (c === 'F' || c === 'N') return false
      return null
    }
    case 'I':
      return raw.length >= 4 ? raw.readInt32LE(0) : null
    case 'B':
      return raw.length >= 8 ? raw.readDoubleLE(0) : null
    case 'Y':
      return raw.length >= 8 ? Number(raw.readBigInt64LE(0)) / 10000 : null
    case 'T':
      return raw.length >= 8 ? julianToIso(raw.readInt32LE(0), raw.readInt32LE(4)) : null
    case 'M':
    case 'G':
    case 'W': {
      if (f.length === 4) return { memoBlock: raw.readUInt32LE(0) }
      const s = raw.toString('latin1').trim()
      return { memoBlock: s === '' ? 0 : Number(s) || 0 }
    }
    default:
      return null
  }
}

export interface ReadOptions {
  /** Only these fields are decoded and returned (by name, case-insensitive). Others are never decoded. */
  fields?: string[]
  /** Records per disk read. */
  chunkRecords?: number
  /** Called per non-deleted record. Return false to stop early. */
  onRecord: (rec: DbfRecord, recno: number) => boolean | void
}

export interface ReadResult {
  header: DbfHeader
  stats: ReadStats
  memoPath: string | null
  memoBlockSize: number | null
}

/**
 * Stream all non-deleted records of a table. Opens the DBF (and its memo file if a requested
 * field is a memo) read-only, and closes them before returning.
 */
export async function readDbf(path: string, opts: ReadOptions): Promise<ReadResult> {
  const fh = await openReadOnly(path)
  let memo: MemoReader | null = null
  let memoPath: string | null = null
  try {
    const first = await readExactly(fh, 32, 0)
    const header = parseDbfHeader(await readExactly(fh, Math.max(first.readUInt16LE(8), 32), 0))
    const wanted = opts.fields ? new Set(opts.fields.map((n) => n.toUpperCase())) : null
    const fields = header.fields.filter(
      (f) => f.type !== '0' && (f.flags & 0x01) === 0 && (!wanted || wanted.has(f.name))
    )
    const nullFlagsField = header.fields.find((f) => f.type === '0')

    if (fields.some((f) => f.type === 'M')) {
      memoPath = findMemoPath(path)
      if (memoPath) memo = await MemoReader.open(memoPath)
    }

    const { size } = await fh.stat()
    const recLen = header.recordLength
    const present = recLen > 0 ? Math.max(0, Math.floor((size - header.headerLength) / recLen)) : 0
    // Read up to the count in the header, not the size reported when opening: on a network share
    // the reported size can be out of date while another PC writes the table. The real end of the
    // file shows up as a short read.
    const total = recLen > 0 ? header.recordCount : 0
    const stats: ReadStats = {
      recordsInHeader: header.recordCount,
      recordsPresent: present,
      recordsRead: 0,
      deletedSkipped: 0,
      memoErrors: 0,
      fileSize: size,
      recordsScanned: 0,
      incomplete: false
    }

    const chunk = opts.chunkRecords ?? 2000
    let stop = false
    let stoppedByCaller = false
    for (let start = 0; start < total && !stop; start += chunk) {
      const n = Math.min(chunk, total - start)
      const pos = header.headerLength + start * recLen
      let buf = await readExactly(fh, n * recLen, pos)
      // A short read in the middle of the table: retry a few times (network hiccup, FoxPro writing).
      for (let attempt = 1; buf.length < n * recLen && attempt <= 3; attempt++) {
        await sleep(150 * attempt)
        buf = await readExactly(fh, n * recLen, pos)
      }
      const got = Math.floor(buf.length / recLen)
      for (let i = 0; i < got; i++) {
        const rec = buf.subarray(i * recLen, (i + 1) * recLen)
        if (rec[0] === 0x1a) {
          stop = true // end-of-file marker
          break
        }
        stats.recordsScanned++
        if (rec[0] === 0x2a /* '*' */) {
          stats.deletedSkipped++
          continue
        }
        const nullFlags = nullFlagsField ? rec.subarray(nullFlagsField.offset, nullFlagsField.offset + nullFlagsField.length) : null
        const out: DbfRecord = {}
        for (const f of fields) {
          if (nullFlags && f.nullBit !== null) {
            const byte = nullFlags[f.nullBit >> 3]
            if (byte !== undefined && (byte >> (f.nullBit & 7)) & 1) {
              out[f.name] = null
              continue
            }
          }
          const v = decodeField(f, rec)
          if (v !== null && typeof v === 'object') {
            if (!memo || v.memoBlock === 0) {
              out[f.name] = ''
            } else {
              try {
                out[f.name] = await memo.read(v.memoBlock)
              } catch {
                stats.memoErrors++
                out[f.name] = ''
              }
            }
          } else {
            out[f.name] = v
          }
        }
        stats.recordsRead++
        if (opts.onRecord(out, start + i + 1) === false) {
          stop = true
          stoppedByCaller = true
          break
        }
      }
      if (got < n) break
    }
    stats.fileSize = (await fh.stat()).size
    stats.incomplete = !stoppedByCaller && stats.recordsScanned < header.recordCount - APPEND_TOLERANCE
    return { header, stats, memoPath, memoBlockSize: memo ? memo.size : null }
  } finally {
    await memo?.close()
    await fh.close()
  }
}

/** Size and modified time, used to detect changes and to prove the files were not touched. */
export async function fileSignature(path: string): Promise<{ size: number; mtimeMs: number }> {
  const s = await stat(path)
  return { size: s.size, mtimeMs: s.mtimeMs }
}
