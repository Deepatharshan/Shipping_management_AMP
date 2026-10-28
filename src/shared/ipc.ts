/** Every call between the screens and the main process. The preload exposes them as window.api. */
import type { CommercialInvoice } from './invoice'
import type { FieldInfo, FoxValue } from './foxMap'
import type { PmaProforma, ProformaSummary } from './proforma'
import type { PackingList, PackingSummary } from './packing'
import type { RecordRow, RecordSummary, ShippingRecord } from './shippingRecord'
import type {
  AppInfo, ChangeEntry, SalePoint, FoxPage, FoxRecord, FoxRow, FoxStatus, InvoiceSummary, LoginResult, PmaStatus, SaveResult, Session, Settings, Stats
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

  packingList(query: string): Promise<PackingSummary[]>
  packingGet(id: string): Promise<PackingList | null>
  /** a new list for anyone; changing a saved one needs the admin password */
  packingSave(pl: PackingList): Promise<PackingList>
  packingDelete(id: string): Promise<string>
  packingPreview(pl: PackingList): Promise<{ pdf: string; pages: number }>
  packingSavePdf(pl: PackingList): Promise<string | null>
  packingPrint(pl: PackingList): Promise<void>

  recordList(): Promise<RecordSummary[]>
  recordGet(id: string): Promise<ShippingRecord | null>
  /** the saved record of a month (YYYY-MM), if any */
  recordForMonth(month: string): Promise<ShippingRecord | null>
  /** a new record for anyone; changing a saved one needs the admin password */
  recordSave(r: ShippingRecord): Promise<ShippingRecord>
  recordDelete(id: string): Promise<string>
  /** a row filled from the commercial invoice with this number (app first, then FoxPro); null when not found */
  recordRowFor(invoiceNo: string): Promise<RecordRow | null>
  recordPreview(r: ShippingRecord): Promise<{ pdf: string; pages: number }>
  recordSavePdf(r: ShippingRecord): Promise<string | null>
  recordPrint(r: ShippingRecord): Promise<void>

  stats(): Promise<Stats>
  /** every invoice date + amount: the FoxPro table plus app invoices not yet in it */
  salesSeries(): Promise<SalePoint[]>
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
  'packingList', 'packingGet', 'packingSave', 'packingDelete', 'packingPreview', 'packingSavePdf', 'packingPrint',
  'recordList', 'recordGet', 'recordForMonth', 'recordSave', 'recordDelete', 'recordRowFor', 'recordPreview', 'recordSavePdf', 'recordPrint',
  'stats', 'salesSeries', 'changes', 'backupNow', 'openGuide'
]

/** Calls that work before login. */
export const PUBLIC_METHODS = new Set<keyof Api>(['appInfo', 'session', 'login'])
/**
 * Calls that need the admin password. Saving over an invoice or packing list that is already saved
 * also needs it (checked in the handler, since saving a new one does not).
 */
export const ADMIN_METHODS = new Set<keyof Api>(['saveSettings', 'changeLogins', 'foxRebuildIndexes', 'backupNow', 'invoiceDelete', 'packingDelete', 'recordDelete', 'changes'])
