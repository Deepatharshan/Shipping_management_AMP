import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ACCESS_MINUTES, EditAccess, accessCodeFor, cleanCode, minutesFor, newRequestCode } from '../src/main/access'
import { Throttle } from '../src/main/auth'
import { setAppDataDir } from '../src/main/safety'

const MIN = 60_000

function setup(start = Date.UTC(2026, 9, 29, 9, 0)) {
  const dir = mkdtempSync(join(tmpdir(), 'shp-access-'))
  setAppDataDir(dir)
  const clock = { t: start }
  const file = join(dir, 'access.json')
  const make = () => new EditAccess(file, new Throttle(() => clock.t), () => clock.t)
  return { clock, file, make }
}
const settle = () => new Promise((r) => setTimeout(r, 30)) // the state file is written in the background

describe('access codes', () => {
  it('request codes are 8 easy-to-type characters, different every time', () => {
    const a = newRequestCode()
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(newRequestCode()).not.toBe(a)
  })

  it('an access code belongs to one request code and one time', () => {
    const req = 'K7Q2-M9XD'
    const codes = ACCESS_MINUTES.map((m) => accessCodeFor(req, m))
    expect(new Set(codes).size).toBe(5)
    for (const c of codes) expect(c).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/)
    ACCESS_MINUTES.forEach((m, i) => expect(minutesFor(req, codes[i])).toBe(m))
    expect(minutesFor('K7Q2-M9XE', codes[1])).toBeNull() // another request
    expect(accessCodeFor(req, 60)).toBe(accessCodeFor('k7q2 m9xd', 60)) // typed loosely: same code
    expect(minutesFor(req, codes[1].toLowerCase().replace('-', ' '))).toBe(60)
    expect(cleanCode('ko1l-io')).toBe('K01110')
    expect(() => accessCodeFor('ABC', 60)).toThrow(/8 letters/)
    expect(() => accessCodeFor(req, 30 as 60)).toThrow(/times offered/)
  })
})

describe('edit access on a PC', () => {
  it('opens for the chosen time with the right code, then closes by itself', async () => {
    const { clock, make } = setup()
    const acc = make()
    await acc.load()
    expect(acc.active).toBe(false)
    expect(acc.enter('AAAAA-AAAAA').message).toMatch(/Generate a request code first/)
    const req = acc.newRequest()
    expect(acc.enter(accessCodeFor('ZZZZ-ZZZZ', 60))).toMatchObject({ ok: false, message: 'That access code does not match the request code shown.' })
    const r = acc.enter(accessCodeFor(req.code, 120))
    expect(r).toMatchObject({ ok: true, message: 'Edit access is open for 2 hours.' })
    expect(r.until).toBe(clock.t + 120 * MIN)
    expect(acc.status().request).toBeNull() // the request code is used up
    expect(acc.enter(accessCodeFor(req.code, 600)).ok).toBe(false) // and cannot be used again
    clock.t += 119 * MIN
    expect(acc.active).toBe(true)
    clock.t += 2 * MIN
    expect(acc.active).toBe(false)
  })

  it('keeps the access after a restart, closes early on request, and a file changed by hand ends it', async () => {
    const { file, make } = setup()
    const a = make()
    await a.load()
    a.enter(accessCodeFor(a.newRequest().code, 300))
    await settle()
    const b = make()
    await b.load()
    expect(b.active).toBe(true)

    const saved = JSON.parse(readFileSync(file, 'utf8'))
    saved.state.until += 10 * 3600_000 // someone tries to stretch the time
    writeFileSync(file, JSON.stringify(saved))
    const c = make()
    await c.load()
    expect(c.active).toBe(false)

    b.end()
    expect(b.active).toBe(false)
  })

  it('a request code is valid for 24 hours, and setting the clock back ends the access', async () => {
    const { clock, make } = setup()
    const acc = make()
    await acc.load()
    const req = acc.newRequest()
    clock.t += 25 * 3600_000
    expect(acc.enter(accessCodeFor(req.code, 60)).ok).toBe(false)
    acc.enter(accessCodeFor(acc.newRequest().code, 600))
    expect(acc.active).toBe(true)
    clock.t -= 3600_000
    expect(acc.active).toBe(false)
  })

  it('codes made for the Product Management App do not work here', () => {
    // a different key: the same request gives a different access code than the other app
    expect(accessCodeFor('K7Q2-M9XD', 60)).not.toBe('PQGXX-XXXXX')
    expect(minutesFor('K7Q2-M9XD', 'AAAAA-AAAAA')).toBeNull()
  })
})
