/**
 * FoxPro standalone index files (.IDX, the non-compact kind: SHIPPING.IDX on com_inv_no).
 *
 * File layout (512-byte blocks):
 *   header: 0 root node offset (uint32 LE) · 4 free list (-1) · 8 end of file (uint32 LE) ·
 *           12 key length (uint16 LE) · 14 options (1 unique, 8 FOR, 32 compact) · 15 signature ·
 *           16 key expression (220 bytes) · 236 FOR expression (220 bytes)
 *   node:   0 attributes (bit 0 root, bit 1 leaf) · 2 number of keys · 4 left sibling · 8 right
 *           sibling (-1 = none) · 12.. entries of <key><4 bytes, high byte first>: in a leaf the
 *           record number, otherwise the offset of the child node; an inner entry's key is the
 *           last (highest) key of its child.
 *   Character keys are the field's bytes padded with spaces, in byte order.
 *
 * The app does not patch the tree. After a record is added (or its key changes) it REBUILDS the whole
 * index from the table (the same thing FoxPro's REINDEX does), and only for index files it has first verified it
 * understands: a file that does not check out against this description is left alone.
 */
import { readFile, rename, writeFile, rm } from 'node:fs/promises'
import { parseDbfHeader, type DbfHeader } from './reader'

const BLOCK = 512

export interface IdxHeader {
  root: number
  eof: number
  keyLength: number
  options: number
  keyExpression: string
  forExpression: string
}

export interface IdxEntry {
  key: Buffer
  recno: number
}

export interface IdxCheck {
  /** null when the file is a supported index and its tree is consistent */
  problem: string | null
  keyExpression: string
  keyLength: number
  /** leaf entries, in index order (empty when the file could not be read) */
  entries: IdxEntry[]
}

function cstr(b: Buffer, start: number, length: number): string {
  const s = b.subarray(start, start + length)
  const end = s.indexOf(0)
  return s.subarray(0, end < 0 ? length : end).toString('latin1').trim()
}

export function parseIdxHeader(b: Buffer): IdxHeader {
  return {
    root: b.readUInt32LE(0),
    eof: b.readUInt32LE(8),
    keyLength: b.readUInt16LE(12),
    options: b[14],
    keyExpression: cstr(b, 16, 220),
    forExpression: cstr(b, 236, 220)
  }
}

/**
 * Reads an index and checks every structural rule in the description above by walking the tree
 * from the root. Anything unexpected is reported as a problem (and the file is then never written).
 */
export function checkIdx(b: Buffer): IdxCheck {
  const fail = (problem: string, h?: IdxHeader): IdxCheck => ({
    problem, keyExpression: h?.keyExpression ?? '', keyLength: h?.keyLength ?? 0, entries: []
  })
  if (b.length < BLOCK * 2 || b.length % BLOCK !== 0) return fail('not an index file (wrong size)')
  const h = parseIdxHeader(b)
  if (h.options & 32) return fail('a compact index (not supported)', h)
  if (h.options & 8 || h.forExpression) return fail('an index with a FOR condition (not supported)', h)
  if (h.options & 1) return fail('a UNIQUE index (not supported)', h)
  if (!h.keyLength || h.keyLength > 100) return fail('unexpected key length', h)
  if (h.root < BLOCK || h.root % BLOCK !== 0 || h.root >= b.length) return fail('the root pointer is not valid', h)
  const entrySize = h.keyLength + 4
  const maxKeys = Math.floor((BLOCK - 12) / entrySize)
  const entries: IdxEntry[] = []
  const seen = new Set<number>()
  let problem: string | null = null

  /** Returns the highest key under the node, or null when it has no keys. */
  const walk = (off: number, isRoot: boolean, depth: number): Buffer | null => {
    if (problem) return null
    if (off < BLOCK || off % BLOCK !== 0 || off + BLOCK > b.length || seen.has(off) || depth > 12) {
      problem = `a node pointer is not valid (${off})`
      return null
    }
    seen.add(off)
    const attr = b.readUInt16LE(off)
    const n = b.readUInt16LE(off + 2)
    if (attr > 3 || n > maxKeys || !!(attr & 1) !== isRoot) {
      problem = `a node is not as expected (attributes ${attr}, ${n} keys)`
      return null
    }
    let last: Buffer | null = null
    for (let i = 0; i < n; i++) {
      const e = off + 12 + i * entrySize
      const key = b.subarray(e, e + h.keyLength)
      const ptr = b.readUInt32BE(e + h.keyLength)
      if (attr & 2) {
        if (last && Buffer.compare(last, key) > 0) problem = 'keys are not in ascending order'
        entries.push({ key: Buffer.from(key), recno: ptr })
      } else {
        const childMax = walk(ptr, false, depth + 1)
        if (problem) return null
        if (!childMax || !childMax.equals(key)) problem = 'an inner key is not the last key of its child node'
      }
      last = key
    }
    return last
  }
  walk(h.root, true, 0)
  if (!problem) for (let i = 1; i < entries.length; i++) if (Buffer.compare(entries[i - 1].key, entries[i].key) > 0) problem = 'keys are not in ascending order'
  return { problem, keyExpression: h.keyExpression, keyLength: h.keyLength, entries: problem ? [] : entries }
}

/** A complete index file for these entries. headerTemplate keeps an existing file's header bytes. */
export function buildIdx(keyExpression: string, keyLength: number, input: IdxEntry[], headerTemplate?: Buffer): Buffer {
  const entrySize = keyLength + 4
  const maxKeys = Math.floor((BLOCK - 12) / entrySize)
  const sorted = [...input].sort((a, b) => Buffer.compare(a.key, b.key) || a.recno - b.recno)
  const blocks: Buffer[] = [] // node blocks, in file order after the header
  const offsetOf = (index: number) => BLOCK * (index + 1)

  type Item = { key: Buffer; ptr: number }
  let level: Item[] = sorted.map((e) => ({ key: e.key, ptr: e.recno }))
  let leaf = true
  for (;;) {
    const groups: Item[][] = []
    for (let i = 0; i < level.length; i += maxKeys) groups.push(level.slice(i, i + maxKeys))
    if (!groups.length) groups.push([])
    const isRoot = groups.length === 1
    const first = blocks.length
    const next: Item[] = []
    groups.forEach((g, gi) => {
      const node = Buffer.alloc(BLOCK)
      node.writeUInt16LE((isRoot ? 1 : 0) | (leaf ? 2 : 0), 0)
      node.writeUInt16LE(g.length, 2)
      node.writeInt32LE(gi > 0 ? offsetOf(first + gi - 1) : -1, 4)
      node.writeInt32LE(gi < groups.length - 1 ? offsetOf(first + gi + 1) : -1, 8)
      g.forEach((it, i) => {
        const e = 12 + i * entrySize
        it.key.copy(node, e, 0, keyLength)
        node.writeUInt32BE(it.ptr, e + keyLength)
      })
      blocks.push(node)
      if (g.length) next.push({ key: g[g.length - 1].key, ptr: offsetOf(first + gi) })
    })
    if (isRoot) break
    level = next
    leaf = false
  }

  const header = Buffer.alloc(BLOCK)
  if (headerTemplate) headerTemplate.copy(header, 0, 0, BLOCK)
  else {
    header[14] = 0
    header.write(keyExpression, 16, 220, 'latin1')
  }
  header.writeUInt32LE(offsetOf(blocks.length - 1), 0) // the root is the last node written
  header.writeInt32LE(-1, 4)
  header.writeUInt32LE(BLOCK * (blocks.length + 1), 8)
  header.writeUInt16LE(keyLength, 12)
  return Buffer.concat([header, ...blocks])
}

export interface IdxStatus {
  path: string
  /** field the index is on (upper case), '' when it is not a plain field of the table */
  field: string
  keys: number
  records: number
  /** true when the index is understood AND has exactly one correct entry per record of the table */
  matches: boolean
  /** why it does not match / is not supported; '' when it matches */
  note: string
}

/** The key the table's records should have in the index: the field's bytes for each record. */
function tableKeys(table: Buffer, h: DbfHeader, field: string, keyLength: number): IdxEntry[] | null {
  const f = h.fields.find((x) => x.name === field)
  if (!f || f.type !== 'C' || f.length !== keyLength) return null
  const out: IdxEntry[] = []
  const count = Math.min(h.recordCount, Math.floor((table.length - h.headerLength) / h.recordLength))
  for (let r = 0; r < count; r++) {
    const o = h.headerLength + r * h.recordLength + f.offset
    out.push({ key: Buffer.from(table.subarray(o, o + keyLength)), recno: r + 1 })
  }
  return out
}

/** Compare an index file with the table it should belong to (both only read). */
export function idxStatus(path: string, idx: Buffer, table: Buffer): IdxStatus {
  const h = parseDbfHeader(table)
  const c = checkIdx(idx)
  const base = { path, field: '', keys: c.entries.length, records: h.recordCount }
  if (c.problem) return { ...base, matches: false, note: `Not updated by the app: ${c.problem}.` }
  const field = c.keyExpression.toUpperCase()
  const want = tableKeys(table, h, field, c.keyLength)
  if (!want) return { ...base, matches: false, note: `Not updated by the app: its key "${c.keyExpression}" is not a text field of this table.` }
  if (c.entries.length !== want.length)
    return { ...base, field, matches: false, note: `Out of date: it has ${c.entries.length.toLocaleString('en-US')} entries, the table has ${want.length.toLocaleString('en-US')} records.` }
  const byRec = new Map(c.entries.map((e) => [e.recno, e.key]))
  let wrong = 0
  for (const w of want) {
    const k = byRec.get(w.recno)
    if (!k || !k.equals(w.key)) wrong++
  }
  if (wrong) return { ...base, field, matches: false, note: `Out of date: ${wrong.toLocaleString('en-US')} entries do not agree with the table.` }
  return { ...base, field, matches: true, note: '' }
}

/**
 * Rebuild an index from the table and replace the file (written beside it first, then swapped in).
 * Refuses unless the existing file is a supported index on a text field of the table.
 */
export async function rebuildIdx(idxPath: string, tablePath: string): Promise<IdxStatus> {
  const [idx, table] = await Promise.all([readFile(idxPath), readFile(tablePath)])
  const c = checkIdx(idx)
  if (c.problem) throw new Error(`${idxPath}: ${c.problem}`)
  const h = parseDbfHeader(table)
  const field = c.keyExpression.toUpperCase()
  const keys = tableKeys(table, h, field, c.keyLength)
  if (!keys) throw new Error(`${idxPath}: its key "${c.keyExpression}" is not a text field of the table.`)
  const built = buildIdx(c.keyExpression, c.keyLength, keys, idx)
  const verify = idxStatus(idxPath, built, table)
  if (!verify.matches) throw new Error(`${idxPath}: the rebuilt index did not verify (${verify.note}); the file was not changed.`)
  const tmp = `${idxPath}.shp-new`
  await writeFile(tmp, built)
  try {
    await rename(tmp, idxPath)
  } catch (e) {
    await rm(tmp, { force: true })
    throw new Error(`${idxPath} could not be replaced (is it open in FoxPro?): ${(e as Error).message}`)
  }
  return verify
}
