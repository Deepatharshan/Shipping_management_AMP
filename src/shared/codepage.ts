/**
 * Text encoding of a FoxPro table, from the code page mark in its header (byte 29).
 *
 * The shipping table (deldem shipping.DBF) is marked 0x04 = Macintosh (Mac Roman), and its data
 * confirms it: "TEPEÜSTÜ", "CARRÉ", "DECORAÇÃO", "SOCIETÀ" only read correctly as Mac Roman.
 * Other marks are read as Windows-1252 (what the other AMP apps use).
 *
 * Writing: every character must exist in the table's code page, otherwise the value is refused
 * rather than silently changed.
 */
import { cp1252Unencodable, encodeCp1252 } from './cp1252'

export interface Codec {
  name: string
  decode(b: Uint8Array): string
  encode(s: string): Uint8Array
  /** characters of s that this code page cannot hold ([] when all can) */
  unencodable(s: string): string[]
}

const win1252 = new TextDecoder('windows-1252')

export const CP1252: Codec = {
  name: 'Windows-1252',
  decode: (b) => win1252.decode(b),
  encode: encodeCp1252,
  unencodable: cp1252Unencodable
}

// Mac Roman bytes 0x80–0xFF (Apple's mapping; 0xDB = €, 0xF0 = the Apple logo U+F8FF)
const MAC_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü' +
  '†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø' +
  '¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ' +
  '‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ'

const MAC_FROM = new Map<number, number>()
for (let i = 0; i < 128; i++) MAC_FROM.set(MAC_HIGH.codePointAt(i)!, 0x80 + i)

export const MAC_ROMAN: Codec = {
  name: 'Macintosh (Mac Roman)',
  decode(b) {
    let s = ''
    for (const x of b) s += x < 0x80 ? String.fromCharCode(x) : MAC_HIGH[x - 0x80]
    return s
  },
  encode(s) {
    const out: number[] = []
    for (const ch of s) {
      const cp = ch.codePointAt(0)!
      if (cp < 0x80) out.push(cp)
      else {
        const b = MAC_FROM.get(cp)
        if (b === undefined) throw new Error(`The character "${ch}" cannot be stored in the FoxPro table.`)
        out.push(b)
      }
    }
    return Uint8Array.from(out)
  },
  unencodable(s) {
    const bad = new Set<string>()
    for (const ch of s) {
      const cp = ch.codePointAt(0)!
      if (cp >= 0x80 && !MAC_FROM.has(cp)) bad.add(ch)
    }
    return [...bad]
  }
}

export function codecFor(codePageMark: number): Codec {
  return codePageMark === 0x04 ? MAC_ROMAN : CP1252
}
