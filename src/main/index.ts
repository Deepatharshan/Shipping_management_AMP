import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Api } from '@shared/ipc'
import { ADMIN_METHODS, PUBLIC_METHODS } from '@shared/ipc'
import { checkInvoice, normalizeInvoice, todayIso, type CommercialInvoice } from '@shared/invoice'
import { invoiceFromFox, KEY_FIELD } from '@shared/foxMap'
import type { Session, Stats } from '@shared/types'
import { loadSettings, saveSettings } from './settings'
import { safeWriteFile } from './safety'
import { readAuth, hashPassword, verifyPassword, Throttle, type AuthFile } from './auth'
import { openSqlite } from './sql'
import { ShipStore } from './store'
import { ProformaSource } from './proformaSource'
import * as fox from './foxShipping'
import { safetyCopy, backupNow } from './backup'
import { invoiceHtml } from './pdf/invoiceTemplate'
import { renderPdf } from './pdf/render'

// SHIP_DATA_DIR: another data folder, for trying the app out without touching the real one.
app.setPath('userData', process.env.SHIP_DATA_DIR || join(app.getPath('appData'), 'Shipping Management AMP'))

let win: BrowserWindow | null = null
let store: ShipStore
let pma: ProformaSource
const throttle = new Throttle()
let auth: AuthFile
let loggedIn: string | null = null
let admin = false

const userData = () => app.getPath('userData')
const authFile = () => join(userData(), 'auth.json')
const settingsFile = () => join(userData(), 'settings.json')

function requireAdmin() {
  if (!admin) throw new Error('Only the admin can do this: open Settings with the admin password.')
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

async function invoicePdf(ci: CommercialInvoice) {
  const s = await loadSettings()
  return renderPdf(invoiceHtml(s.company, ci), join(userData(), 'render'))
}

const handlers: Api = {
  async appInfo() {
    return { name: 'Shipping Management AMP', version: app.getVersion(), dataFolder: userData(), sqlite: sqliteVersion() }
  },
  async session(): Promise<Session> {
    return { user: loggedIn, admin }
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

  getSettings: () => loadSettings(),
  async saveSettings(s) {
    const saved = await saveSettings(s)
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

  invoiceList: async (q) => store.list(q),
  knownBarcodes: async () => store.barcodes(),
  async invoiceGet(id) {
    const ci = store.get(id)
    return ci ? normalizeInvoice(ci, (await loadSettings()).defaults) : null
  },
  async invoiceSave(input, toFoxPro) {
    checkInvoice(input)
    const s = await loadSettings()
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
  async invoiceDelete(id, alsoFoxPro) {
    const ci = store.get(id)
    if (!ci) return 'Already deleted.'
    let msg = ''
    if (alsoFoxPro && ci.foxRecno) {
      const s = await loadSettings()
      if (!s.writeFoxPro) throw new Error('Saving to the FoxPro table is switched off, so the FoxPro record cannot be deleted from here.')
      const { path, indexes } = await foxOn()
      await beforeFoxWrite(path, indexes)
      await fox.markDeleted(path, ci.foxRecno, ci.foxKey ?? ci.invoiceNo, true, todayIso())
      store.log({ at: Date.now(), action: 'delete', target: 'foxpro', invoiceNo: ci.invoiceNo, recno: ci.foxRecno, detail: {} })
      msg = ` FoxPro record ${ci.foxRecno} is marked deleted (it can be recalled on the FoxPro records screen).`
    }
    store.delete(id)
    store.log({ at: Date.now(), action: 'delete', target: 'app', invoiceNo: ci.invoiceNo, recno: ci.foxRecno, detail: { invoice: ci } })
    return `Deleted ${ci.invoiceNo} from the app.${msg}`
  },
  async invoicePreview(ci) {
    checkInvoice(ci)
    const r = await invoicePdf(ci)
    return { pdf: r.pdf.toString('base64'), pages: r.pages }
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
  changes: async () => store.changes(),
  async backupNow() {
    const s = await loadSettings()
    return backupNow({ target: s.backupPath, shippingPath: s.shippingPath, indexes: s.shippingIndexes, storeBackup: (d) => store.backupTo(d), settingsFile: settingsFile() })
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

app.whenReady().then(async () => {
  await loadSettings() // sets the write guard before anything else runs
  auth = readAuth(authFile())
  store = new ShipStore(join(userData(), 'shipments.db'), openSqlite)
  pma = new ProformaSource(join(userData(), 'pma-copy'), openSqlite)
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  pma?.close()
  store?.close()
  app.quit()
})
