import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Api } from '@shared/ipc'
import { ADMIN_METHODS, EDIT_METHODS, PUBLIC_METHODS } from '@shared/ipc'
import { checkInvoice, normalizeInvoice, todayIso, type CommercialInvoice } from '@shared/invoice'
import { invoiceFromFox, KEY_FIELD } from '@shared/foxMap'
import type { DbFolderCheck, DbStatus, SalePoint, Session, Settings, Stats } from '@shared/types'
import { loadSettings, saveSettings } from './settings'
import { safeWriteFile } from './safety'
import { readAuth, hashPassword, verifyPassword, Throttle, type AuthFile } from './auth'
import { EditAccess, accessCodeFor, ACCESS_MINUTES, type AccessMinutes } from './access'
import { openSqlite } from './sql'
import { isNetworkPath, ShipStore } from './store'
import { ProformaSource } from './proformaSource'
import * as fox from './foxShipping'
import { safetyCopy, backupNow } from './backup'
import { invoiceHtml } from './pdf/invoiceTemplate'
import { packingHtml } from './pdf/packingTemplate'
import { recordHtml } from './pdf/recordTemplate'
import { proformaHtml } from './pdf/proformaTemplate'
import { checkRecord, monthTitle, normalizeRecord, rowFromInvoice, type ShippingRecord } from '@shared/shippingRecord'
import { packingTotals } from '@shared/packing'
import { checkPackingList, normalizePackingList, type PackingList } from '@shared/packing'
import { renderPdf } from './pdf/render'
import { invoiceXlsx, packingXlsx, proformaXlsx, recordXlsx } from './excel/reports'
import { seedDemoFiles, seedDemoStore } from './demoSeed' // DEMO: remove with demoSeed.ts

// SHIP_DATA_DIR: another data folder, for trying the app out without touching the real one.
app.setPath('userData', process.env.SHIP_DATA_DIR ? resolve(process.env.SHIP_DATA_DIR) : join(app.getPath('appData'), 'Shipping Management AMP'))

let win: BrowserWindow | null = null
let store: ShipStore
let pma: ProformaSource
const throttle = new Throttle()
let auth: AuthFile
let loggedIn: string | null = null
let admin = false
let access: EditAccess

const userData = () => app.getPath('userData')
const authFile = () => join(userData(), 'auth.json')
const settingsFile = () => join(userData(), 'settings.json')

/** Changing / deleting saved documents and editing FoxPro records: the admin, or edit access opened by code. */
function requireEdit() {
  if (!admin && !access.active)
    throw new Error('Edit access is needed: click "Edit access", send the request code, and type the access code you receive.')
}

function requireAdmin() {
  if (!admin) throw new Error('Only the admin can do this. Enter the admin password first.')
}

const DB_NAME = 'shipments.db'
/** The folder of the app's database: the one chosen in Settings, else the app data folder. */
const dbFolderOf = (s: Settings) => (s.dataFolder?.trim() ? resolve(s.dataFolder.trim()) : userData())
const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

/** Count what a database file holds without changing it (null when it cannot be read). */
function peekInvoices(file: string): number | null {
  try {
    const db = openSqlite(file)
    try {
      return (db.prepare('SELECT COUNT(*) AS n FROM invoices').get() as { n: number }).n
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/** Can the app create and remove a file in this folder? */
function checkWritable(folder: string) {
  const probe = join(folder, `.shipping-amp-write-test-${Date.now()}`)
  try {
    writeFileSync(probe, 'test')
    unlinkSync(probe)
  } catch (e) {
    throw new Error(`The app cannot write in ${folder}: ${(e as Error).message}`)
  }
}

function sqliteVersion(): string {
  try {
    const db = openSqlite(':memory:')
    const v = (db.prepare('select sqlite_version() as v').get() as { v: string }).v
    db.close()
    return v
  } catch (e) {
    return `error: ${(e as Error).message}`
  }
}

/** The Product Management App's database on this PC (same Windows user), if that app is installed here. */
function localPmaPath(): string | null {
  const p = join(app.getPath('appData'), 'Photo Quotation Generator', 'quotations', 'quotations.db')
  return existsSync(p) ? p : null
}

async function foxOn(): Promise<{ path: string; indexes: string[] }> {
  const s = await loadSettings()
  if (!s.shippingPath) throw new Error('The FoxPro shipping table is not linked. Ask the admin to choose it in Settings.')
  return { path: s.shippingPath, indexes: s.shippingIndexes }
}

async function beforeFoxWrite(path: string, indexes: string[]) {
  await safetyCopy(userData(), path, indexes)
}

function pdfName(ci: CommercialInvoice): string {
  return `Commercial Invoice ${ci.invoiceNo || 'draft'}`.replace(/[\\/:*?"<>|]+/g, '-').trim() + '.pdf'
}

function packingPdfName(pl: PackingList): string {
  return `Packing List ${pl.invoiceNo || 'draft'}`.replace(/[\\/:*?"<>|]+/g, '-').trim() + '.pdf'
}

async function packingPdf(pl: PackingList) {
  const s = await loadSettings()
  return renderPdf(packingHtml(s.company, pl), join(userData(), 'render'))
}

function recordPdfName(r: ShippingRecord): string {
  return `Shipping Record ${monthTitle(r.month)}`.replace(/[\\/:*?"<>|]+/g, '-').trim() + '.pdf'
}

async function recordPdf(r: ShippingRecord) {
  return renderPdf(recordHtml(r), join(userData(), 'render'))
}

/** A proforma from the Product Management App, its bank block and file name. */
async function proformaFor(id: string) {
  const s = await loadSettings()
  await pma.refresh(s.pmaDbPath)
  const pf = pma.get(id)
  if (!pf) throw new Error('That proforma invoice is no longer in the Product Management App.')
  // the bank block opens with the factory name, as on the planning app's printout
  const factory = s.defaults.beneficiary.split(/\r?\n/)[0]?.trim() ?? ''
  const bank = [factory, s.defaults.bank].filter(Boolean).join('\n')
  return { s, pf, bank }
}

/** Ask where to save an Excel workbook (Documents by default) and write it. */
async function saveXlsx(name: string, make: () => Promise<Buffer>): Promise<string | null> {
  const file = `${name}`.replace(/[\\/:*?"<>|]+/g, '-').trim() + '.xlsx'
  const res = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), file), filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] })
  if (res.canceled || !res.filePath) return null
  await safeWriteFile(res.filePath, await make())
  return res.filePath
}

/** A proforma from the Product Management App as a PDF (its own 2-page layout). */
async function proformaPdf(id: string) {
  const { s, pf, bank } = await proformaFor(id)
  const out = await renderPdf(proformaHtml(s.company, bank, pf), join(userData(), 'render'))
  const name = `Proforma Invoice ${pf.header?.invoiceNo || 'draft'}`.replace(/[\\/:*?"<>|]+/g, '-').trim() + '.pdf'
  return { ...out, name }
}

async function invoicePdf(ci: CommercialInvoice) {
  const s = await loadSettings()
  return renderPdf(invoiceHtml(s.company, ci), join(userData(), 'render'))
}

const handlers: Api = {
  async appInfo() {
    return { name: 'Shipping Management AMP', version: app.getVersion(), dataFolder: userData(), sqlite: sqliteVersion() }
  },
  async session(): Promise<Session> {
    const a = access?.status() ?? { until: null, request: null }
    return { user: loggedIn, admin, editUntil: a.until, request: a.request, canEdit: admin || !!access?.active }
  },

  async login(user, password) {
    const r = throttle.attempt(
      () => typeof user === 'string' && user.trim().toLowerCase() === auth.user.toLowerCase() && verifyPassword(password, auth.appHash),
      'Wrong user name or password.'
    )
    if (r.ok) loggedIn = auth.user
    return r
  },
  async logout() {
    loggedIn = null
    admin = false
  },
  async adminLogin(password) {
    const r = throttle.attempt(() => verifyPassword(password, auth.adminHash), 'Wrong admin password.')
    if (r.ok) admin = true
    return r
  },
  async adminLogout() {
    admin = false
  },
  async changeLogins(p) {
    requireAdmin()
    const next: AuthFile = { ...auth }
    if (p.user?.trim()) next.user = p.user.trim()
    if (p.password) {
      if (p.password.length < 6) throw new Error('The app password needs at least 6 characters.')
      next.appHash = hashPassword(p.password)
    }
    if (p.adminPassword) {
      if (p.adminPassword.length < 6) throw new Error('The admin password needs at least 6 characters.')
      next.adminHash = hashPassword(p.adminPassword)
    }
    await safeWriteFile(authFile(), JSON.stringify(next, null, 2))
    auth = next
    loggedIn = next.user
  },

  newAccessRequest: async () => access.newRequest(),
  enterAccessCode: async (code) => access.enter(code),
  endEditAccess: async () => access.end(),
  async makeAccessCode(request, minutes) {
    requireAdmin()
    if (!ACCESS_MINUTES.includes(minutes as AccessMinutes)) throw new Error('Choose one of the times offered.')
    return accessCodeFor(request, minutes as AccessMinutes)
  },

  getSettings: () => loadSettings(),
  async saveSettings(s) {
    // the database folder is changed only by dbSetFolder (which moves the file), never by this form
    const saved = await saveSettings({ ...s, dataFolder: (await loadSettings()).dataFolder })
    fox.forgetCache()
    return saved
  },
  async pickFile(kind) {
    const filters =
      kind === 'dbf' ? [{ name: 'FoxPro table', extensions: ['dbf', 'DBF'] }]
        : kind === 'idx' ? [{ name: 'FoxPro index', extensions: ['idx', 'IDX'] }]
          : [{ name: 'Product Management App database', extensions: ['db'] }]
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters })
    return res.canceled ? null : res.filePaths[0]
  },
  async pickFolder() {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  },
  detectPma: async () => localPmaPath(),

  async foxStatus() {
    const s = await loadSettings()
    return fox.status(s.shippingPath, s.shippingIndexes, s.writeFoxPro)
  },
  async foxList(query, page, pageSize, showDeleted) {
    const { path } = await foxOn()
    const t = await fox.loadRows(path)
    const linked = store.linkedRecnos()
    const rows = fox.searchRows(t.rows, query, showDeleted)
    const size = Math.max(10, Math.min(200, pageSize || 50))
    const p = Math.max(0, page)
    return {
      rows: rows.slice(p * size, p * size + size).map((r) => ({ ...r, appId: linked.get(r.recno) ?? null })),
      total: rows.length,
      page: p,
      pageSize: size
    }
  },
  async foxFind(invoiceNo) {
    const s = await loadSettings()
    if (!s.shippingPath || !invoiceNo.trim()) return []
    const want = invoiceNo.trim().toUpperCase()
    const t = await fox.loadRows(s.shippingPath)
    return t.rows.filter((r) => !r.deleted && r.invoiceNo.toUpperCase() === want)
  },
  async foxRecord(recno) {
    const { path } = await foxOn()
    return fox.readRecord(path, recno)
  },
  async foxRecordValues(recno) {
    const { path } = await foxOn()
    return (await fox.readRecordValues(path, recno)).values
  },
  async foxFieldInfo() {
    const s = await loadSettings()
    return s.shippingPath ? fox.fieldInfo(s.shippingPath) : []
  },
  async foxUpdateFields(recno, expectKey, values) {
    const s = await loadSettings()
    if (!s.writeFoxPro) throw new Error('Saving to the FoxPro table is switched off (Settings → FoxPro shipping table).')
    const { path, indexes } = await foxOn()
    await beforeFoxWrite(path, indexes)
    const r = await fox.updateFields(path, indexes, recno, { [KEY_FIELD]: expectKey }, values, todayIso())
    store.log({ at: Date.now(), action: 'update', target: 'foxpro', invoiceNo: String(r.after[KEY_FIELD] ?? expectKey), recno, detail: { before: r.before, after: r.after, warnings: r.warnings } })
    return { warnings: r.warnings, reindexed: r.reindexed }
  },
  async foxSetDeleted(recno, expectKey, deleted) {
    // records in the FoxPro table are never deleted from this app (only recalled, by the admin)
    if (deleted) throw new Error('Deleting records in the FoxPro table is not allowed from this app.')
    const s = await loadSettings()
    if (!s.writeFoxPro) throw new Error('Saving to the FoxPro table is switched off (Settings → FoxPro shipping table).')
    const { path, indexes } = await foxOn()
    await beforeFoxWrite(path, indexes)
    await fox.markDeleted(path, recno, expectKey, deleted, todayIso())
    store.log({ at: Date.now(), action: deleted ? 'delete' : 'recall', target: 'foxpro', invoiceNo: expectKey, recno, detail: {} })
  },
  async foxOpenAsInvoice(recno) {
    const id = store.byRecno(recno)
    if (id) {
      const ci = store.get(id)
      if (ci) return normalizeInvoice(ci, (await loadSettings()).defaults)
    }
    const { path } = await foxOn()
    const { values } = await fox.readRecordValues(path, recno)
    return invoiceFromFox(values, recno, (await loadSettings()).defaults)
  },
  async foxRebuildIndexes() {
    const { path, indexes } = await foxOn()
    if (!indexes.length) throw new Error('No index file is ticked in Settings.')
    await beforeFoxWrite(path, indexes)
    const done = await fox.rebuildIndexes(path, indexes)
    store.log({ at: Date.now(), action: 'reindex', target: 'foxpro', invoiceNo: '', recno: null, detail: { indexes: done } })
    return done
  },

  async pmaStatus(refresh) {
    const s = await loadSettings()
    if (refresh && s.pmaDbPath) await pma.refresh(s.pmaDbPath, true).catch(() => undefined)
    return pma.status(s.pmaDbPath)
  },
  async pmaList(query) {
    const s = await loadSettings()
    await pma.refresh(s.pmaDbPath)
    return pma.list(query)
  },
  async pmaFind(invoiceNo) {
    const s = await loadSettings()
    await pma.refresh(s.pmaDbPath)
    return pma.findByNo(invoiceNo)
  },
  async pmaGet(id) {
    const s = await loadSettings()
    await pma.refresh(s.pmaDbPath)
    return pma.get(id)
  },

  async pmaPreview(id) {
    const r = await proformaPdf(id)
    return { pdf: r.pdf.toString('base64'), pages: r.pages }
  },
  async pmaSaveXlsx(id) {
    const { s, pf, bank } = await proformaFor(id)
    return saveXlsx(`Proforma Invoice ${pf.header?.invoiceNo || 'draft'}`, () => proformaXlsx(s.company, bank, pf))
  },
  async pmaSavePdf(id) {
    const r = await proformaPdf(id)
    const res = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), r.name), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (res.canceled || !res.filePath) return null
    await safeWriteFile(res.filePath, r.pdf)
    return res.filePath
  },
  async pmaPrint(id) {
    const r = await proformaPdf(id)
    const file = join(userData(), 'print', r.name)
    await safeWriteFile(file, r.pdf)
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  },

  invoiceList: async (q) => store.list(q),
  knownBarcodes: async () => store.barcodes(),
  async invoiceGet(id) {
    const ci = store.get(id)
    return ci ? normalizeInvoice(ci, (await loadSettings()).defaults) : null
  },
  async invoiceSave(input, toFoxPro) {
    checkInvoice(input)
    // a saved invoice can only be changed by the admin
    if (input.id && store.get(input.id)) requireEdit()
    const s = await loadSettings()
    // updating a record that is already in the FoxPro table needs the admin (adding a new one does not)
    if (toFoxPro && s.writeFoxPro && input.foxRecno) requireEdit()
    let ci = normalizeInvoice(input, s.defaults)
    if (!ci.invoiceNo.trim()) throw new Error('Type the commercial invoice no first.')
    const dup = store.duplicateOf(ci.invoiceNo, ci.id)
    if (dup) throw new Error(`Commercial invoice ${ci.invoiceNo} is already saved in the app. Open it from Shipments instead.`)
    // 1. the app database first, so the work is never lost
    ci = store.save(ci)
    store.log({ at: Date.now(), action: input.id ? 'update' : 'create', target: 'app', invoiceNo: ci.invoiceNo, recno: ci.foxRecno, detail: {} })
    if (!toFoxPro || !s.writeFoxPro) return { invoice: ci, fox: s.writeFoxPro ? 'Saved in the app only.' : '', warnings: [] }
    // 2. the FoxPro table
    try {
      const { path, indexes } = await foxOn()
      await beforeFoxWrite(path, indexes)
      let msg = ''
      let warnings: string[] = []
      if (ci.foxRecno) {
        const r = await fox.updateFromInvoice(path, indexes, ci.foxRecno, ci.foxKey ?? ci.invoiceNo, ci, todayIso())
        warnings = r.warnings
        store.log({ at: Date.now(), action: 'update', target: 'foxpro', invoiceNo: ci.invoiceNo, recno: r.recno, detail: { before: r.before, after: r.after, warnings, reindexed: r.reindexed } })
        msg = `FoxPro record ${r.recno} updated${r.reindexed.length ? `, ${r.reindexed.join(', ')} rebuilt` : ''}.`
      } else {
        const existing = (await fox.loadRows(path)).rows.filter((r) => !r.deleted && r.invoiceNo.toUpperCase() === ci.invoiceNo.trim().toUpperCase())
        if (existing.length)
          throw new Error(`${ci.invoiceNo} is already in the FoxPro table (record ${existing[0].recno}). Click "Use FoxPro record" next to the invoice no to link this invoice to it.`)
        const r = await fox.createFromInvoice(path, indexes, ci, todayIso())
        warnings = r.warnings
        ci.foxRecno = r.recno
        store.log({ at: Date.now(), action: 'create', target: 'foxpro', invoiceNo: ci.invoiceNo, recno: r.recno, detail: { after: r.after, warnings, reindexed: r.reindexed } })
        msg = `Added to FoxPro as record ${r.recno}${r.reindexed.length ? `, ${r.reindexed.join(', ')} rebuilt` : ''}.`
      }
      ci.foxKey = ci.invoiceNo.trim().slice(0, 15).trimEnd()
      ci = store.save(ci)
      return { invoice: ci, fox: msg, warnings }
    } catch (e) {
      return { invoice: ci, fox: `Saved in the app, but NOT in FoxPro: ${(e as Error).message}`, warnings: [] }
    }
  },
  async invoiceDelete(id) {
    const ci = store.get(id)
    if (!ci) return 'Already deleted.'
    // only the app's copy: the FoxPro record (if any) is never deleted from this app
    store.delete(id)
    store.log({ at: Date.now(), action: 'delete', target: 'app', invoiceNo: ci.invoiceNo, recno: ci.foxRecno, detail: { invoice: ci } })
    return `Deleted ${ci.invoiceNo} from the app.${ci.foxRecno ? ` FoxPro record ${ci.foxRecno} is kept.` : ''}`
  },
  async invoicePreview(ci) {
    checkInvoice(ci)
    const r = await invoicePdf(ci)
    return { pdf: r.pdf.toString('base64'), pages: r.pages }
  },
  async invoiceSaveXlsx(ci) {
    checkInvoice(ci)
    const s = await loadSettings()
    return saveXlsx(`Commercial Invoice ${ci.invoiceNo || 'draft'}`, () => invoiceXlsx(s.company, normalizeInvoice(ci, s.defaults)))
  },
  async invoiceSavePdf(ci) {
    checkInvoice(ci)
    const res = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), pdfName(ci)), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (res.canceled || !res.filePath) return null
    const r = await invoicePdf(ci)
    await safeWriteFile(res.filePath, r.pdf)
    if (ci.id && store.get(ci.id)) store.setPdfPath(ci.id, res.filePath)
    return res.filePath
  },
  async invoicePrint(ci) {
    checkInvoice(ci)
    const r = await invoicePdf(ci)
    const file = join(userData(), 'print', pdfName(ci))
    await safeWriteFile(file, r.pdf)
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  },
  packingList: async (q) => store.packingList(q),
  async packingGet(id) {
    const pl = store.packingGet(id)
    return pl ? normalizePackingList(pl, (await loadSettings()).defaults) : null
  },
  async packingSave(input) {
    checkPackingList(input)
    const before = input.id ? store.packingGet(input.id) : null
    if (before) requireEdit()
    const pl = normalizePackingList({ ...input, id: before ? input.id : null }, (await loadSettings()).defaults)
    if (!pl.invoiceNo.trim()) throw new Error('Type or pick the commercial invoice no first.')
    const dup = store.packingDuplicateOf(pl.invoiceNo, before ? pl.id : null)
    if (dup) throw new Error(`A packing list for ${pl.invoiceNo} is already saved. Open it from Packing Lists instead.`)
    const saved = store.packingSave(pl)
    store.log({ at: Date.now(), action: before ? 'update' : 'create', target: 'packing', invoiceNo: saved.invoiceNo, recno: null, detail: before ? { before } : {} })
    return saved
  },
  async packingDelete(id) {
    const pl = store.packingGet(id)
    if (!pl) return 'Already deleted.'
    store.packingDelete(id)
    store.log({ at: Date.now(), action: 'delete', target: 'packing', invoiceNo: pl.invoiceNo, recno: null, detail: { packingList: pl } })
    return `Deleted the packing list for ${pl.invoiceNo}.`
  },
  async packingPreview(pl) {
    checkPackingList(pl)
    const r = await packingPdf(pl)
    return { pdf: r.pdf.toString('base64'), pages: r.pages }
  },
  async packingSaveXlsx(pl) {
    checkPackingList(pl)
    const s = await loadSettings()
    return saveXlsx(`Packing List ${pl.invoiceNo || 'draft'}`, () => packingXlsx(s.company, normalizePackingList(pl, s.defaults)))
  },
  async packingSavePdf(pl) {
    checkPackingList(pl)
    const res = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), packingPdfName(pl)), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (res.canceled || !res.filePath) return null
    const r = await packingPdf(pl)
    await safeWriteFile(res.filePath, r.pdf)
    return res.filePath
  },
  async packingPrint(pl) {
    checkPackingList(pl)
    const r = await packingPdf(pl)
    const file = join(userData(), 'print', packingPdfName(pl))
    await safeWriteFile(file, r.pdf)
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  },
  recordList: async () => store.recordList(),
  recordGet: async (id) => {
    const r = store.recordGet(id)
    return r ? normalizeRecord(r) : null
  },
  recordForMonth: async (month) => {
    const id = store.recordForMonth(month)
    const r = id ? store.recordGet(id) : null
    return r ? normalizeRecord(r) : null
  },
  async recordSave(input) {
    checkRecord(input)
    const before = input.id ? store.recordGet(input.id) : null
    if (before) requireEdit()
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error('Choose the month of the record.')
    const rec = normalizeRecord({ ...input, id: before ? input.id : null })
    const dup = store.recordForMonth(rec.month, before ? rec.id : null)
    if (dup) throw new Error(`The shipping record for ${monthTitle(rec.month)} is already saved. Open it from "Saved records" instead.`)
    const saved = store.recordSave(rec)
    store.log({ at: Date.now(), action: before ? 'update' : 'create', target: 'record', invoiceNo: monthTitle(saved.month), recno: null, detail: before ? { before } : {} })
    return saved
  },
  async recordDelete(id) {
    const r = store.recordGet(id)
    if (!r) return 'Already deleted.'
    store.recordDelete(id)
    store.log({ at: Date.now(), action: 'delete', target: 'record', invoiceNo: monthTitle(r.month), recno: null, detail: { record: r } })
    return `Deleted the shipping record for ${monthTitle(r.month)}.`
  },
  async recordRowFor(invoiceNo) {
    const no = String(invoiceNo ?? '').trim()
    if (!no) return null
    const s = await loadSettings()
    // 1. a commercial invoice saved in the app (CBM from its packing list, when there is one)
    const id = store.duplicateOf(no, null)
    const saved = id ? store.get(id) : null
    if (saved) {
      const ci = normalizeInvoice(saved, s.defaults)
      const plId = store.packingDuplicateOf(ci.invoiceNo, null)
      const pl = plId ? store.packingGet(plId) : null
      const cbm = pl ? packingTotals(pl.lines).cbm : 0
      return rowFromInvoice(ci, cbm ? cbm.toFixed(2) : '', 'app')
    }
    // 2. a record in the FoxPro shipping table (made by the old program)
    if (s.shippingPath) {
      const want = no.toUpperCase()
      const hit = (await fox.loadRows(s.shippingPath)).rows.find((r) => !r.deleted && r.invoiceNo.toUpperCase() === want)
      if (hit) {
        const { values } = await fox.readRecordValues(s.shippingPath, hit.recno)
        const row = rowFromInvoice(invoiceFromFox(values, hit.recno, s.defaults), '', 'foxpro')
        const total = Number(values.TOTAL_AMT ?? 0) || 0
        const comm = Number(values.COMM_AMT ?? 0) || 0
        row.totalAmt = total ? total.toFixed(2) : ''
        row.commDiscVat = comm ? comm.toFixed(2) : ''
        row.amount = total ? (total - comm).toFixed(2) : ''
        return row
      }
    }
    return null
  },
  async recordPreview(r) {
    checkRecord(r)
    const out = await recordPdf(r)
    return { pdf: out.pdf.toString('base64'), pages: out.pages }
  },
  async recordSaveXlsx(r) {
    checkRecord(r)
    return saveXlsx(`Shipping Record ${monthTitle(r.month)}`, () => recordXlsx(normalizeRecord(r)))
  },
  async recordSavePdf(r) {
    checkRecord(r)
    const res = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), recordPdfName(r)), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (res.canceled || !res.filePath) return null
    const out = await recordPdf(r)
    await safeWriteFile(res.filePath, out.pdf)
    return res.filePath
  },
  async recordPrint(r) {
    checkRecord(r)
    const out = await recordPdf(r)
    const file = join(userData(), 'print', recordPdfName(r))
    await safeWriteFile(file, out.pdf)
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  },
  async openPath(p) {
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  },

  async stats(): Promise<Stats> {
    const s = await loadSettings()
    const d = new Date()
    const st = store.stats(new Date(d.getFullYear(), d.getMonth(), 1).getTime())
    let foxRecords = 0
    if (s.shippingPath) foxRecords = await fox.loadRows(s.shippingPath).then((t) => t.rows.filter((r) => !r.deleted).length, () => 0)
    let proformas = 0
    if (s.pmaDbPath) {
      await pma.refresh(s.pmaDbPath).catch(() => undefined)
      proformas = pma.status(s.pmaDbPath).proformas
    }
    const from = new Date(Date.now() - 30 * 86400000)
    return { ...st, foxRecords, proformas, upcoming: store.timeline(todayIso(from), 10) }
  },
  async salesSeries() {
    const out: SalePoint[] = []
    const s = await loadSettings()
    if (s.shippingPath) {
      try {
        for (const r of (await fox.loadRows(s.shippingPath)).rows) if (!r.deleted && r.date) out.push({ date: r.date, amount: r.amount ?? 0 })
      } catch {
        /* table not readable: show the app invoices only */
      }
    }
    // app invoices already written to FoxPro are counted there
    for (const r of store.list('', 100000)) if (!r.foxRecno && r.date) out.push({ date: r.date, amount: r.amount })
    return out
  },
  changes: async () => store.changes(),
  async backupNow() {
    const s = await loadSettings()
    return backupNow({ target: s.backupPath, shippingPath: s.shippingPath, indexes: s.shippingIndexes, storeBackup: (d) => store.backupTo(d), settingsFile: settingsFile() })
  },
  async dbStatus(): Promise<DbStatus> {
    const folder = resolve(store.file, '..')
    let size = 0
    try {
      size = statSync(store.file).size
    } catch {
      /* not written yet */
    }
    return {
      file: store.file, folder, defaultFolder: userData(), isDefault: samePath(folder, userData()), network: isNetworkPath(store.file), size,
      ...store.counts()
    }
  },
  async dbCheckFolder(folder): Promise<DbFolderCheck> {
    const target = resolve(String(folder ?? ''))
    if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`Cannot find the folder ${target}.`)
    const file = join(target, DB_NAME)
    const hasDb = existsSync(file)
    return { folder: target, sameAsNow: samePath(target, resolve(store.file, '..')), hasDb, invoices: hasDb ? peekInvoices(file) : null, network: isNetworkPath(target) }
  },
  async dbSetFolder(folder, mode) {
    const target = resolve(String(folder ?? ''))
    const current = store.file
    if (samePath(target, resolve(current, '..'))) return 'The app already uses the database in this folder.'
    if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`Cannot find the folder ${target}.`)
    checkWritable(target)
    const file = join(target, DB_NAME)
    const before = store.counts()
    if (mode === 'move') {
      if (existsSync(file)) throw new Error('There is already an app database in that folder. Choose "Use the database there", or pick an empty folder.')
      store.backupTo(file) // a consistent copy, made by SQLite itself
      // check the copy before switching to it
      let copy: ShipStore | null = null
      try {
        copy = new ShipStore(file, openSqlite)
        const after = copy.counts()
        if (after.invoices !== before.invoices || after.packingLists !== before.packingLists || after.records !== before.records)
          throw new Error('The copy in the new folder does not hold the same number of documents.')
      } catch (e) {
        copy?.close()
        try {
          unlinkSync(file)
        } catch {
          /* leave it */
        }
        throw new Error(`The database was not moved: ${(e as Error).message}`)
      }
      store.close()
      store = copy
    } else {
      if (!existsSync(file)) throw new Error('There is no app database in that folder.')
      const next = new ShipStore(file, openSqlite) // refuses a database made by a newer version
      store.close()
      store = next
    }
    const s = await loadSettings()
    await saveSettings({ ...s, dataFolder: samePath(target, userData()) ? '' : target })
    // the old file stays as a backup, renamed so it is never taken for the live database
    let kept = ''
    if (mode === 'move') {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
      const bak = `${current}.moved-${stamp}.bak`
      try {
        renameSync(current, bak)
        kept = ` The old file is kept as ${bak}.`
      } catch {
        kept = ` The old file is still at ${current}; it is no longer used.`
      }
    }
    const now = store.counts()
    store.log({ at: Date.now(), action: 'update', target: 'app', invoiceNo: 'App database', recno: null, detail: { from: current, to: store.file, mode } })
    return `The app now uses ${store.file} (${now.invoices} invoices, ${now.packingLists} packing lists, ${now.records} shipping records).${kept}`
  },
  async dbOpenFolder() {
    const err = await shell.openPath(resolve(store.file, '..'))
    if (err) throw new Error(err)
  },
  async openGuide() {
    const dir = app.isPackaged ? join(process.resourcesPath, 'guide') : join(app.getAppPath(), 'docs', 'guide')
    const err = await shell.openPath(join(dir, 'User-Guide.html'))
    if (err) throw new Error(err)
  }
}

function registerIpc() {
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(name, (_e, ...args: unknown[]) => {
      if (!loggedIn && !PUBLIC_METHODS.has(name as keyof Api)) throw new Error('Log in first.')
      if (ADMIN_METHODS.has(name as keyof Api)) requireAdmin()
      if (EDIT_METHODS.has(name as keyof Api)) requireEdit()
      return (fn as (...a: unknown[]) => unknown)(...args)
    })
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Shipping Management AMP',
    backgroundColor: '#eef0f3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      plugins: true // built-in PDF viewer for the invoice preview
    }
  })
  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** The database in the chosen folder; when that folder cannot be reached, ask instead of starting an empty one. */
function openDatabase(s: Settings): ShipStore {
  for (;;) {
    const folder = dbFolderOf(s)
    if (samePath(folder, userData()) || existsSync(folder)) {
      try {
        return new ShipStore(join(folder, DB_NAME), openSqlite)
      } catch (e) {
        if (samePath(folder, userData())) throw e
      }
    }
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Shipping Management AMP',
      message: 'The app database folder cannot be reached.',
      detail: `${folder}\n\nIf it is on another PC or a network drive, check that it is on and connected, then click Try again.`,
      buttons: ['Try again', 'Use the app data folder instead', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice === 2) {
      app.exit(0)
      throw new Error('quit')
    }
    if (choice === 1) {
      s = { ...s, dataFolder: '' }
      void saveSettings(s)
    }
  }
}

app.whenReady().then(async () => {
  const demo = process.env.SHIP_DEMO === '1' && !!process.env.SHIP_DATA_DIR // DEMO: remove with demoSeed.ts
  if (demo) seedDemoFiles(userData())
  await loadSettings() // sets the write guard before anything else runs
  auth = readAuth(authFile())
  access = new EditAccess(join(userData(), 'access.json'), throttle)
  await access.load()
  store = openDatabase(await loadSettings())
  if (demo) seedDemoStore(store)
  pma = new ProformaSource(join(userData(), 'pma-copy'), openSqlite)
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  pma?.close()
  store?.close()
  app.quit()
})
