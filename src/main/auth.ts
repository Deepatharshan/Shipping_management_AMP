/**
 * Who may do what, checked here in the main process (not only in the window):
 *   - app login (user name + password): needed for everything; ends at "Log out" or when the app closes
 *   - admin password: opens Settings (links to the data, FoxPro writing, indexes, passwords)
 * Only salted scrypt hashes are stored (auth.json in the app-data folder). The first run uses the
 * default logins below; change them in Settings → Logins.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { LoginResult } from '@shared/types'

export const DEFAULT_USER = 'ampshipping'
export const DEFAULT_PASSWORD = 'Ship@2026'
export const DEFAULT_ADMIN_PASSWORD = 'Admin@2026'

export interface AuthFile {
  user: string
  appHash: string
  adminHash: string
}

const MAX_TRIES = 5
const WAIT_MS = 30_000

export function hashPassword(password: string, salt = randomBytes(16)): string {
  return `scrypt:${salt.toString('hex')}:${scryptSync(password.normalize('NFKC'), salt, 32).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = String(stored).split(':')
  if (kind !== 'scrypt' || !salt || !hash || typeof password !== 'string') return false
  const want = Buffer.from(hash, 'hex')
  const got = scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'hex'), want.length)
  return timingSafeEqual(got, want)
}

export function defaultAuth(): AuthFile {
  return { user: DEFAULT_USER, appHash: hashPassword(DEFAULT_PASSWORD), adminHash: hashPassword(DEFAULT_ADMIN_PASSWORD) }
}

export function readAuth(file: string): AuthFile {
  try {
    const a = JSON.parse(readFileSync(file, 'utf8')) as AuthFile
    if (a.user && a.appHash && a.adminHash) return a
  } catch {
    /* first run */
  }
  return defaultAuth()
}

/** Counts wrong tries; after five, nothing is accepted for 30 seconds. */
export class Throttle {
  private failed = 0
  private blockedUntil = 0
  constructor(private readonly now: () => number = Date.now) {}

  attempt(check: () => boolean, wrong: string): LoginResult {
    const wait = this.blockedUntil - this.now()
    if (wait > 0) return { ok: false, message: `Too many wrong tries. Wait ${Math.ceil(wait / 1000)} seconds and try again.` }
    if (check()) {
      this.failed = 0
      return { ok: true, message: '' }
    }
    this.failed += 1
    if (this.failed >= MAX_TRIES) {
      this.failed = 0
      this.blockedUntil = this.now() + WAIT_MS
      return { ok: false, message: `Wrong ${MAX_TRIES} times. Wait ${WAIT_MS / 1000} seconds and try again.` }
    }
    return { ok: false, message: wrong }
  }
}
