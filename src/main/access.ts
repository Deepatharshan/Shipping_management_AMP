/**
 * Edit access by code, for a set time (15 minutes to 10 hours) — the same way as the Product
 * Management App:
 *   1. On the shipping manager's PC: "Generate request code" → e.g. K7Q2-M9XD, sent to the developer.
 *   2. The developer, in Settings → Access codes (admin password), types that request code, picks the
 *      time and clicks "Generate access code" → e.g. 4FQ8T-2ZK9M, sent back.
 *   3. The shipping manager types the access code: changing / deleting saved invoices, packing lists
 *      and shipping records, and editing FoxPro records, are open until the time runs out.
 * The access code is a keyed hash (HMAC) of the request code and the time, so it works on no other
 * request and with no other time, and no network is needed. A request code is valid for 24 hours and
 * only once. The state file is signed, so editing it by hand ends the access. This app has its own key:
 * codes made for the Product Management App do not work here.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Throttle } from './auth'
import { safeWriteFile } from './safety'
// the key lives in accessKey.ts, which is not in git (see accessKey.example.ts)
import { ACCESS_KEY_HEX } from './accessKey'

/** Shared by every installation of this app: makes and checks the codes. */
const KEY = Buffer.from(ACCESS_KEY_HEX, 'hex')

/** The times the developer can choose, in minutes. */
export const ACCESS_MINUTES = [15, 60, 120, 300, 600] as const
export type AccessMinutes = (typeof ACCESS_MINUTES)[number]

const REQUEST_VALID_MS = 24 * 3600_000
/** A clock set back by more than this ends the access. */
const CLOCK_SLACK_MS = 5 * 60_000

/** Crockford base32: no I, L, O or U, so codes are easy to read out and type. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function base32(bytes: Buffer, chars: number): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5 && out.length < chars) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  return out
}

const group = (s: string, size: number) => s.match(new RegExp(`.{1,${size}}`, 'g'))!.join('-')

/** Upper case, no spaces or dashes; O → 0 and I, L → 1, as people often type them. */
export function cleanCode(code: string): string {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

export function newRequestCode(): string {
  return group(base32(randomBytes(8), 8), 4)
}

function codeBytes(request: string, minutes: number): Buffer {
  return createHmac('sha256', KEY).update(`shp-access|${cleanCode(request)}|${minutes}`).digest()
}

/** The access code for a request code and a time (the developer's side). */
export function accessCodeFor(request: string, minutes: AccessMinutes): string {
  if (!/^[0-9A-Z]{8}$/.test(cleanCode(request))) throw new Error('A request code has 8 letters and digits, like K7Q2-M9XD.')
  if (!ACCESS_MINUTES.includes(minutes)) throw new Error('Choose one of the times offered.')
  return group(base32(codeBytes(request, minutes), 10), 5)
}

/** The time an access code opens for this request, or null when it does not belong to it. */
export function minutesFor(request: string, access: string): AccessMinutes | null {
  const got = Buffer.from(cleanCode(access))
  for (const m of ACCESS_MINUTES) {
    const want = Buffer.from(cleanCode(accessCodeFor(request, m)))
    if (got.length === want.length && timingSafeEqual(got, want)) return m
  }
  return null
}

export function formatMinutes(m: number): string {
  return m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`
}

interface State {
  request: { code: string; createdAt: number } | null
  until: number | null
  minutes: number | null
  lastSeen: number
}

export interface AccessStatus {
  /** Edit access is open until this time (ms), or null */
  until: number | null
  /** The request code waiting for an access code, if any */
  request: { code: string; createdAt: number } | null
}

const sign = (s: State) => createHmac('sha256', KEY).update(`shp-state|${JSON.stringify(s)}`).digest('hex')

/** The edit access of this PC, kept in a signed file in the app's data folder. */
export class EditAccess {
  private s: State

  constructor(
    private readonly file: string,
    private readonly throttle: Throttle,
    private readonly now: () => number = Date.now
  ) {
    this.s = { request: null, until: null, minutes: null, lastSeen: now() }
  }

  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as { state: State; sig: string }
      if (saved.sig === sign(saved.state)) this.s = saved.state
    } catch {
      /* none yet, or changed by hand: no access */
    }
    this.check()
  }

  /** Writes one after another, so a later state is never overwritten by an earlier one. */
  private saving: Promise<void> = Promise.resolve()
  private save(): void {
    const text = JSON.stringify({ state: this.s, sig: sign(this.s) })
    this.saving = this.saving.then(() => safeWriteFile(this.file, text)).catch(() => {})
  }

  /** Ends the access when its time is over or the clock was set back. */
  private check(): void {
    const t = this.now()
    let changed = false
    if (t < this.s.lastSeen - CLOCK_SLACK_MS || (this.s.until !== null && t >= this.s.until)) {
      changed = this.s.until !== null
      this.s.until = null
      this.s.minutes = null
    }
    if (this.s.request && t - this.s.request.createdAt > REQUEST_VALID_MS) {
      this.s.request = null
      changed = true
    }
    if (t > this.s.lastSeen + 60_000 || changed) {
      this.s.lastSeen = Math.max(this.s.lastSeen, t)
      this.save()
    }
  }

  get active(): boolean {
    this.check()
    return this.s.until !== null
  }

  status(): AccessStatus {
    this.check()
    return { until: this.s.until, request: this.s.request }
  }

  /** A new request code; any earlier one stops working. */
  newRequest(): { code: string; createdAt: number } {
    this.s.request = { code: newRequestCode(), createdAt: this.now() }
    this.s.lastSeen = Math.max(this.s.lastSeen, this.now())
    this.save()
    return this.s.request
  }

  enter(code: string): { ok: boolean; message: string; until: number | null } {
    this.check()
    const req = this.s.request
    if (!req) return { ok: false, message: 'Generate a request code first and send it to get an access code.', until: null }
    let minutes = null as AccessMinutes | null
    const r = this.throttle.attempt(() => (minutes = minutesFor(req.code, code)) !== null, 'That access code does not match the request code shown.')
    if (!r.ok || minutes === null) return { ...r, until: null }
    this.s.until = this.now() + minutes * 60_000
    this.s.minutes = minutes
    this.s.request = null // a request code works once
    this.s.lastSeen = Math.max(this.s.lastSeen, this.now())
    this.save()
    return { ok: true, message: `Edit access is open for ${formatMinutes(minutes)}.`, until: this.s.until }
  }

  end(): void {
    this.s.until = null
    this.s.minutes = null
    this.save()
  }
}
