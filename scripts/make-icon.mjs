// Draws the app icon from the ship + AMP logo (src/renderer/src/Logo.tsx): build/icon.png (512x512) and
// build/icon.ico (16–256 px), which electron-builder uses for the .exe, the installer and the shortcuts.
// Needs the "sharp" package: run with  node scripts/make-icon.mjs  (pass a folder holding sharp as an
// argument if it is not installed here, e.g. ../Photo_Quotation_Generator/node_modules).
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const from = process.argv[2] ? resolve(process.argv[2], '..') : process.cwd()
const sharp = createRequire(join(from, 'package.json'))('sharp')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 48 48">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f3b63"/><stop offset="1" stop-color="#0d1f38"/></linearGradient></defs>
  <rect width="48" height="48" rx="11" fill="url(#bg)"/>
  <rect x="11" y="18.5" width="6.2" height="5.5" rx=".8" fill="#fff" fill-opacity=".55"/>
  <rect x="18" y="18.5" width="6.2" height="5.5" rx=".8" fill="#fff" fill-opacity=".8"/>
  <rect x="25" y="18.5" width="6.2" height="5.5" rx=".8" fill="#fff" fill-opacity=".55"/>
  <rect x="18" y="13" width="6.2" height="5.5" rx=".8" fill="#fff" fill-opacity=".35"/>
  <path d="M33 24V13.6a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1V24z" fill="#fff"/>
  <rect x="34.4" y="14.4" width="2.9" height="1.7" rx=".4" fill="#1f3b63"/>
  <path d="M6.5 25h35l-4.6 8.6a1.4 1.4 0 0 1-1.2.8H12.3a1.4 1.4 0 0 1-1.2-.8z" fill="#fff"/>
  <text x="24" y="32.2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="7.6" font-weight="800" letter-spacing=".9" fill="#1f3b63">AMP</text>
  <path d="M8 39.2c2.2-1.6 4.2-1.6 6.4 0s4.2 1.6 6.4 0 4.2-1.6 6.4 0 4.2 1.6 6.4 0 4.2-1.6 6.4 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5" stroke-linecap="round"/>
</svg>`

const png = (size) => sharp(Buffer.from(svg), { density: Math.max(72, (72 * size) / 48) }).resize(size, size).png().toBuffer()

writeFileSync('build/icon.png', await png(512))

// .ico holding PNG images (Windows Vista and later read PNG-in-ICO)
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(sizes.map(png))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
const dir = Buffer.alloc(16 * sizes.length)
let offset = 6 + dir.length
sizes.forEach((s, i) => {
  const e = i * 16
  dir.writeUInt8(s >= 256 ? 0 : s, e)
  dir.writeUInt8(s >= 256 ? 0 : s, e + 1)
  dir.writeUInt8(0, e + 2)
  dir.writeUInt8(0, e + 3)
  dir.writeUInt16LE(1, e + 4)
  dir.writeUInt16LE(32, e + 6)
  dir.writeUInt32LE(images[i].length, e + 8)
  dir.writeUInt32LE(offset, e + 12)
  offset += images[i].length
})
writeFileSync('build/icon.ico', Buffer.concat([header, dir, ...images]))
console.log('build/icon.png and build/icon.ico written')
