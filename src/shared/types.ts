import { DEFAULT_CI, type CiDefaults } from './invoice'

export interface CompanyDetails {
  /** printed above the company name on page 1 */
  headerNote: string
  name: string
  address: string
  telFax: string
}

export interface Settings {
  /** the FoxPro shipping table, e.g. "deldem shipping.DBF" */
  shippingPath: string
  /** index files (.IDX) of that table that the app keeps in step (rebuilt after it adds a record) */
  shippingIndexes: string[]
  /** When true, saving / deleting an invoice also writes the FoxPro shipping table. Off by default. */
  writeFoxPro: boolean
  /** The Product Management App's database (quotations.db), local or on the product manager's PC */
  pmaDbPath: string
  company: CompanyDetails
  defaults: CiDefaults
  /** Folder for one-click backups */
  backupPath: string
}

export const DEFAULT_SETTINGS: Settings = {
  shippingPath: '',
  shippingIndexes: [],
  writeFoxPro: false,
  pmaDbPath: '',
  company: {
    headerNote: 'THE NAME AND ADDRESS OF THE MANUFACTURERS / PRODUCERS / EXPORTERS.',
    name: 'AMP CEYLON (PVT) LTD.',
    address: 'RING ROAD 3,PHASE 2,, EXPORT PROCESSING ZONE, KATUNAYAKE,, SRI LANKA.',
    telFax: 'TEL : 94-11-2251026    FAX : 94-11-2251029'
  },
  defaults: DEFAULT_CI,
  backupPath: ''
}

export interface AppInfo {
  name: string
  version: string
  dataFolder: string
  sqlite: string
}

export interface Session {
  user: string | null
  admin: boolean
}

export interface LoginResult {
  ok: boolean
  message: string
}

/** One record of the FoxPro shipping table, as listed. */
export interface FoxRow {
  recno: number
  deleted: boolean
  invoiceNo: string
  date: string
  custCode: string
  customer: string
  country: string
  vessel: string
  containerNo: string
  amount: number | null
  etd: string
  eta: string
  payTerms: string
  /** id of the app invoice linked to this record, if any */
  appId: string | null
}

export interface FoxPage {
  rows: FoxRow[]
  total: number
  page: number
  pageSize: number
}

/** One record with every field (raw text), for the FoxPro records editor. */
export interface FoxRecord {
  recno: number
  deleted: boolean
  fields: { name: string; type: string; length: number; decimals: number; value: string; writable: boolean }[]
}

export interface IdxInfo {
  path: string
  field: string
  keys: number
  records: number
  matches: boolean
  note: string
}

export interface FoxStatus {
  configured: boolean
  path: string
  ok: boolean
  message: string
  records: number
  deleted: number
  lastUpdate: string | null
  version: string
  codePage: string
  fileSize: number
  memoFile: string | null
  indexes: IdxInfo[]
  /** .IDX files found next to the table (for Settings) */
  indexCandidates: string[]
  writeOn: boolean
}

export interface PmaStatus {
  configured: boolean
  path: string
  ok: boolean
  message: string
  proformas: number
  /** when the copy was last taken (ms) */
  copiedAt: number | null
  /** modified time of the source database (ms) */
  sourceModified: number | null
}

export interface InvoiceSummary {
  id: string
  invoiceNo: string
  piNo: string
  customer: string
  date: string
  etd: string
  eta: string
  vessel: string
  containerNo: string
  amount: number
  lineCount: number
  foxRecno: number | null
  updatedAt: number
  pdfPath: string | null
}

export interface ChangeEntry {
  id: number
  at: number
  action: 'create' | 'update' | 'delete' | 'recall' | 'reindex'
  target: 'app' | 'foxpro'
  invoiceNo: string
  recno: number | null
  detail: Record<string, unknown>
}

export interface SaveResult {
  invoice: import('./invoice').CommercialInvoice
  /** what was done in the FoxPro table ('' when writing is off) */
  fox: string
  /** values cut to fit a FoxPro field */
  warnings: string[]
}

export interface Stats {
  invoices: number
  thisMonth: number
  amountThisMonth: number
  amountTotal: number
  inFoxPro: number
  foxRecords: number
  proformas: number
  upcoming: InvoiceSummary[]
}
