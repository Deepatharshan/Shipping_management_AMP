/** Every call between the screens and the main process. The preload exposes them as window.api. */
import type { CommercialInvoice } from './invoice'
import type { FieldInfo, FoxValue } from './foxMap'
import type { PmaProforma, ProformaSummary } from './proforma'
import type {
  AppInfo, ChangeEntry, FoxPage, FoxRecord, FoxRow, FoxStatus, InvoiceSummary, LoginResult, PmaStatus, SaveResult, Session, Settings, Stats
} from './types'

export interface Api {
  appInfo(): Promise<AppInfo>
  session(): Promise<Session>
  login(user: string, password: string): Promise<LoginResult>
  logout(): Promise<void>
  adminLogin(password: string): Promise<LoginResult>
  adminLogout(): Promise<void>
  /** admin only; blank fields are left unchanged */
  changeLogins(p: { user?: string; password?: string; adminPassword?: string }): Promise<void>

  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<Settings>
  pickFile(kind: 'dbf' | 'db' | 'idx'): Promise<string | null>
  pickFolder(): Promise<string | null>
  /** the Product Management App database on this PC, when it is installed here */
  detectPma(): Promise<string | null>

  foxStatus(): Promise<FoxStatus>
  foxList(query: string, page: number, pageSize: number, showDeleted: boolean): Promise<FoxPage>
  foxFind(invoiceNo: string): Promise<FoxRow[]>
  foxRecord(recno: number): Promise<FoxRecord>
  foxRecordValues(recno: number): Promise<Record<string, string | number | null>>
  foxFieldInfo(): Promise<FieldInfo[]>
  foxUpdateFields(recno: number, expectKey: string, values: Record<string, FoxValue>): Promise<{ warnings: string[]; reindexed: string[] }>
  foxSetDeleted(recno: number, expectKey: string, deleted: boolean): Promise<void>
  foxOpenAsInvoice(recno: number): Promise<CommercialInvoice>
  foxRebuildIndexes(): Promise<string[]>

  pmaStatus(refresh: boolean): Promise<PmaStatus>
  pmaList(query: string): Promise<ProformaSummary[]>
  pmaFind(invoiceNo: string): Promise<ProformaSummary[]>
  pmaGet(id: string): Promise<PmaProforma | null>

  invoiceList(query: string): Promise<InvoiceSummary[]>
  /** barcodes from earlier invoices, by "your item no|our item no" */
  knownBarcodes(): Promise<Record<string, string>>
  invoiceGet(id: string): Promise<CommercialInvoice | null>
  invoiceSave(ci: CommercialInvoice, toFoxPro: boolean): Promise<SaveResult>
  invoiceDelete(id: string, alsoFoxPro: boolean): Promise<string>
  invoicePreview(ci: CommercialInvoice): Promise<{ pdf: string; pages: number }>
  invoiceSavePdf(ci: CommercialInvoice): Promise<string | null>
  invoicePrint(ci: CommercialInvoice): Promise<void>
  openPath(path: string): Promise<void>

  stats(): Promise<Stats>
  changes(): Promise<ChangeEntry[]>
  backupNow(): Promise<string>
  openGuide(): Promise<void>
}

export const API_METHODS: (keyof Api)[] = [
  'appInfo', 'session', 'login', 'logout', 'adminLogin', 'adminLogout', 'changeLogins',
  'getSettings', 'saveSettings', 'pickFile', 'pickFolder', 'detectPma',
  'foxStatus', 'foxList', 'foxFind', 'foxRecord', 'foxRecordValues', 'foxFieldInfo', 'foxUpdateFields', 'foxSetDeleted', 'foxOpenAsInvoice', 'foxRebuildIndexes',
  'pmaStatus', 'pmaList', 'pmaFind', 'pmaGet',
  'invoiceList', 'knownBarcodes', 'invoiceGet', 'invoiceSave', 'invoiceDelete', 'invoicePreview', 'invoiceSavePdf', 'invoicePrint', 'openPath',
  'stats', 'changes', 'backupNow', 'openGuide'
]

/** Calls that work before login. */
export const PUBLIC_METHODS = new Set<keyof Api>(['appInfo', 'session', 'login'])
/** Calls that need the admin password. */
export const ADMIN_METHODS = new Set<keyof Api>(['saveSettings', 'changeLogins', 'foxRebuildIndexes', 'backupNow'])
