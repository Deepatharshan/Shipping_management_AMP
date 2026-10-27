/**
 * Windows-1252 encoding, the code page of the FoxPro tables. Used when the app writes a product
 * record: every character must exist in the code page, otherwise the value is refused rather than
 * silently changed.
 */

// Unicode code points of bytes 0x80..0x9F in Windows-1252 (0 = undefined byte).
const HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178
]
const FROM_UNICODE = new Map<number, number>()
HIGH.forEach((cp, i) => {
  // The five bytes Windows-1252 leaves undefined are read as the control characters of the same
  // number; they are written back as the same byte, so a record that already holds one (a stray
  // 0x90 is in a few product descriptions) is not altered or refused when other fields are edited.
  FROM_UNICODE.set(cp || 0x80 + i, 0x80 + i)
})

/** Characters of the text that cannot be stored in Windows-1252 ([] when all can). */
export function cp1252Unencodable(text: string): string[] {
  const bad = new Set<string>()
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const ok = cp < 0x80 || (cp >= 0xa0 && cp <= 0xff) || FROM_UNICODE.has(cp)
    if (!ok) bad.add(ch)
  }
  return [...bad]
}

export function encodeCp1252(text: string): Uint8Array {
  const out: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) out.push(cp)
    else {
      const b = FROM_UNICODE.get(cp)
      if (b === undefined) throw new Error(`The character "${ch}" cannot be stored in the FoxPro table.`)
      out.push(b)
    }
  }
  return Uint8Array.from(out)
}
