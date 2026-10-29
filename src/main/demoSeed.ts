/**
 * DEMO DATA — for checking the PDFs and the calculations. Remove when no longer needed:
 *   1. delete this file,
 *   2. delete the two lines marked "DEMO" in main/index.ts,
 *   3. delete the "dev:demo" script in package.json and the demo-data folder.
 *
 * Runs only with `npm run dev:demo`, which points the app at its own data folder (demo-data/), so the
 * real database, settings and FoxPro table are never touched. The samples follow the paper reports:
 * M/26/015 SCHWARTINSKY GMBH (shipping record) and the RNA RESOURCES / LANDMARK packing list.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { blankLine, DEFAULT_CI, newInvoice, type CiLine, type CommercialInvoice, type FoxExtra } from '@shared/invoice'
import { blankPlLine, newPackingList, type PackingList, type PlLine } from '@shared/packing'
import { newRecord, rowFromInvoice, type RecordRow } from '@shared/shippingRecord'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { ShipStore } from './store'

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

function line(p: Partial<CiLine> & { qty: string; price: string }): CiLine {
  return { ...blankLine(DEFAULT_CI), ...p, total: money(Number(p.qty) * Number(p.price)) }
}

const RNA_CONSIGNEE = 'RNA RESOURCES GROUP LIMITED\nOPERATING AS "LANDMARK"\nJAFZA LICENSE NUMBER 103288\nP.O. BOX 17155, JEBEL ALI FREE ZONE\nDUBAI, UAE'

/** [your item, our item, colour, packing, pcs/ctn, ctns, qty, price, nett/ctn, gross/ctn, L, W, H, ctn no] */
const RNA_ITEMS: [string, string, string, string, string, number, number, number, number, number, number, number, number, string][] = [
  ['161930493', 'Y39AZPE44/E035 SPHC', 'PEACH-PN/40+B/251', '2 pc/box,12 pcs/ctn.', '12', 136, 1632, 4.12, 3.3, 6.1, 52.5, 35, 45, '046-181'],
  ['161930496', 'Y39AZWT05/E035 SPHC', 'WHITE-B/251', '2 pc/box,12 pcs/ctn.', '12', 125, 1500, 4.12, 3.3, 6.1, 52.5, 35, 45, '182-306'],
  ['161930498', 'Y42AZYE64 E035', 'YELLOW-G/289', '6 pc/box,48 pcs/ctn.', '48', 28, 1344, 2.35, 14.4, 23, 76, 56, 37, '344-371'],
  ['161930499', 'Y44AZWH48 E035', 'WHITE', '6 pc/box,48 pcs/ctn.', '48', 37, 1776, 2.35, 14.4, 23, 76, 56, 37, '372-408'],
  ['164448687', 'Y64AZPK76 E725', 'PINK GREEN', '4 pcs/ctn.', '4', 45, 180, 9.85, 3.2, 6, 66, 66, 34, '001-045'],
  ['164448688', 'Z14AZCH05/SP E035', 'WHITE+CHAMPAGNE', '6 pc/box,24 pcs/ctn.', '24', 53, 1272, 1.95, 7, 12.3, 60, 44.5, 42, '409-461'],
  ['164448689', 'Z14AZPU01/SP E035', 'PINK', '6 pc/box,24 pcs/ctn.', '24', 58, 1392, 1.95, 7, 12.3, 60, 44.5, 42, '462-519'],
  ['164448690', 'Z62AZPN48/SP E035', 'PINK+GREEN', '12 pc/box,72 pcs/ctn.', '72', 14, 1008, 1.48, 8.4, 13.9, 53, 29, 54, '307-320'],
  ['164448691', 'Z62AZWH02/SP E035', 'WHITE+GREEN', '12 pc/box,72 pcs/ctn.', '72', 23, 1656, 1.48, 8.4, 13.9, 53, 29, 54, '321-343']
]

function invoices(): CommercialInvoice[] {
  const base = (p: Omit<Partial<CommercialInvoice>, 'fox'> & { fox?: Partial<FoxExtra> }): CommercialInvoice => ({ ...newInvoice(DEFAULT_CI), ...p, fox: { ...newInvoice(DEFAULT_CI).fox, ...(p.fox ?? {}) } })
  return [
    // the shipping record sample: 2,184.36 less 177.00 = 2,007.36
    base({
      invoiceNo: 'M/26/015', date: '2026-09-21', piNo: '60704/M/S', piLabel: '60704/M/S', poNo: '4500127788', pod: 'HAMBURG',
      consignee: 'SCHWARTINSKY GMBH\nWANDSBEKER ZOLLSTRASSE 87-89\n22041 HAMBURG\nGERMANY',
      vessel: 'OOCL NAGOYA', voyage: '071W', etd: '2026-09-28', eta: '2026-10-20', containerNo: 'OOLU1234567', sealNo: 'OOL-778812',
      asnNo: '', shippingMarks: 'SCHWARTINSKY\nHAMBURG\nC/NO 1-23', orderReference: 'ORDER 60704/M/S',
      discount: '177', discountType: 'amount',
      fox: { cmbRefNo: '26015/M', custCode: '4410', custName: 'SCHWARTINSKY GMBH', city: 'HAMBURG', country: 'GERMANY', shipLine: 'ONE TEAM', contSize: 'LCL', portDel: 'HAMBURG', billLading: '2026-09-28' },
      lines: [
        line({ yourItemNo: '70031', ourItem: 'R18AZRD12 E035', description: 'ROSE BUNCH X12 IN GIFT BOX 45CM H', packing: '24 pcs/ctn.', colour: 'RED', pcsCtn: '24', ctns: '18', qty: '432', price: '2.88', hsCode: '6702' }),
        line({ yourItemNo: '70032', ourItem: 'P22AZWH04 E035', description: 'PEONY STEM 60CM H', packing: '48 pcs/ctn.', colour: 'WHITE', pcsCtn: '48', ctns: '5', qty: '240', price: '3.9175', hsCode: '6702' })
      ]
    }),
    // the packing list sample (LANDMARK, Jebel Ali), 5% discount
    base({
      invoiceNo: 'M/26/021', date: '2026-10-08', piNo: 'SM 46262 JW', piLabel: 'SM 46262 JW', poNo: '1568821', pod: 'JEBEL ALI',
      consignee: RNA_CONSIGNEE, vessel: 'SM MAHI', voyage: '054W', etd: '2026-10-12', eta: '2026-10-30',
      containerNo: 'MRKU0380028', sealNo: 'ML-LK0395388', asnNo: 'CI1HC2255799-NON-PTS',
      shippingMarks: 'HCJW/46262 and Distribution\nas per Purchase Order', orderReference: 'JEBEL ALI : HCJW/46262 and Distribution as per Purchase Order',
      discount: '5', discountType: 'percent',
      fox: { cmbRefNo: '26021/M', custCode: '9726', custName: 'RNA RESOURCES GROUP LIMITED', city: 'DUBAI', country: 'UAE', shipLine: 'MAERSK LANKA', contSize: '01X40HQ', portDel: 'JEBEL ALI, UAE', billLading: '2026-10-12' },
      lines: RNA_ITEMS.map(([your, our, colour, packing, pcsCtn, ctns, qty, price]) =>
        line({ yourItemNo: your, ourItem: our, colour, packing, pcsCtn, ctns: String(ctns), qty: String(qty), price: String(price), description: 'ARTIFICIAL FLOWER ARRANGEMENT', barcode: '' }))
    }),
    // no discount: prints exactly like before
    base({
      invoiceNo: 'M/26/022', date: '2026-10-20', piNo: '61001/M/S', piLabel: '61001/M/S', poNo: 'PS-55120', pod: 'FELIXSTOWE',
      consignee: 'PLAYSMART LIMITED\nUNIT 4, HARBOUR ROAD\nFELIXSTOWE IP11 3TW\nUNITED KINGDOM',
      vessel: 'MSC AURORA', voyage: '112E', etd: '2026-11-03', eta: '2026-11-27', containerNo: 'MSCU7781234', sealNo: 'MSC-001244',
      fox: { cmbRefNo: '26022/M', custName: 'PLAYSMART LIMITED', country: 'UNITED KINGDOM', shipLine: 'MSC LANKA', contSize: '01X20GP', portDel: 'FELIXSTOWE' },
      lines: [
        line({ yourItemNo: 'PS-101', ourItem: 'T10AZMX01 E100', description: 'MIXED SPRING BOUQUET 35CM H', packing: '24 pcs/ctn.', colour: 'MIX', pcsCtn: '24', ctns: '40', qty: '960', price: '1.85' }),
        line({ yourItemNo: 'PS-102', ourItem: 'T10AZGR02 E100', description: 'EUCALYPTUS SPRAY 70CM H', packing: '36 pcs/ctn.', colour: 'GREEN', pcsCtn: '36', ctns: '30', qty: '1080', price: '1.20' })
      ]
    }),
    // older ones, so the sales chart has a year to show
    ...([
      ['M/26/004', '2026-02-11', 'KAEMINGK B.V.', 'ROTTERDAM', 18350.4],
      ['M/26/007', '2026-04-03', 'DEPOT HANDELS GMBH', 'HAMBURG', 9420.0],
      ['M/26/010', '2026-06-17', 'RNA RESOURCES GROUP LIMITED', 'JEBEL ALI', 26110.75],
      ['M/26/012', '2026-07-29', 'PLAYSMART LIMITED', 'FELIXSTOWE', 12890.5],
      ['M/25/030', '2025-10-14', 'KAEMINGK B.V.', 'ROTTERDAM', 21400.0],
      ['M/25/024', '2025-08-05', 'DEPOT HANDELS GMBH', 'HAMBURG', 15600.0]
    ] as const).map(([no, date, cust, pod, amount]) =>
      base({
        invoiceNo: no, date, consignee: cust, pod, vessel: 'MAERSK KOLKATA', etd: date, eta: '',
        fox: { custName: cust, shipLine: 'MAERSK LANKA', contSize: '01X40HQ' },
        lines: [line({ yourItemNo: 'ITEM-1', ourItem: 'Z00AZMX00 E035', description: 'ARTIFICIAL FLOWERS ASSORTED', packing: '24 pcs/ctn.', pcsCtn: '24', ctns: String(Math.round(amount / 100)), qty: String(Math.round(amount / 100) * 24), price: money(amount / (Math.round(amount / 100) * 24)) })]
      })
    )
  ]
}

function packingFor(ci: CommercialInvoice, extra: Map<string, Partial<PlLine>>): PackingList {
  return {
    ...newPackingList(DEFAULT_CI, ci.date),
    invoiceId: ci.id, piNo: ci.piNo, invoiceNo: ci.invoiceNo, consignee: ci.consignee, shippingMarks: ci.shippingMarks,
    vessel: ci.vessel, voyage: ci.voyage, etd: ci.etd, eta: ci.eta, containerNo: ci.containerNo, sealNo: ci.sealNo, asnNo: ci.asnNo,
    piLabel: ci.piLabel, poNo: ci.poNo, pod: ci.pod, amount: '',
    lines: ci.lines.map((l) => ({
      ...blankPlLine(), itemNo: l.ourItem, colour: l.colour.split('-')[0], customerItemNo: l.yourItemNo,
      packing: l.packing.replace(/(\d+) pc\/box,(\d+) pcs\/ctn\./, '$1/ $2').replace(/(\d+) pcs\/ctn\./, '$1'),
      ctns: l.ctns, units: l.qty, ...(extra.get(l.yourItemNo) ?? {})
    }))
  }
}

/** A small Product Management App database with the two sample proformas (so "Fetch" works). */
function writeProformaDb(file: string) {
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE IF NOT EXISTS proformas (id TEXT PRIMARY KEY, invoice_no TEXT, customer_name TEXT, pf_date TEXT, updated_at INTEGER, pdf_path TEXT, search TEXT, data TEXT NOT NULL)`)
  const put = db.prepare('INSERT OR REPLACE INTO proformas VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const rna = {
    id: 'pf-rna',
    header: { invoiceNo: 'SM 46262 JW', date: '2026-09-15', customer: { code: '9726', name: 'RNA RESOURCES GROUP LIMITED', street1: 'OPERATING AS "LANDMARK"', street2: 'P.O. BOX 17155, JEBEL ALI FREE ZONE', city: 'DUBAI', country: 'UAE' } },
    lines: RNA_ITEMS.map(([your, our, colour, packing, pcsCtn, ctns, qty, price]) => ({
      id: `l-${your}`, yourItemNo: your, ourItem: our, ourFactory: '(AMP/KAT)', colorCode: colour, description: `ARTIFICIAL FLOWER ARRANGEMENT\n${packing} (APX. 5.31CFT)`,
      pcsCtn, noCtns: String(ctns), qty: String(qty), unit: 'PCS', price: String(price), total: money(qty * price)
    })),
    page2: { container: '1X40HQ CONTAINER', fromPort: 'Colombo, Sri Lanka', toPort: 'Jebel Ali' }
  }
  const sch = {
    id: 'pf-sch',
    header: { invoiceNo: '60704/M/S', date: '2026-08-30', customer: { code: '4410', name: 'SCHWARTINSKY GMBH', street1: 'WANDSBEKER ZOLLSTRASSE 87-89', city: '22041 HAMBURG', country: 'GERMANY' } },
    lines: [
      { id: 'l-70031', yourItemNo: '70031', ourItem: 'R18AZRD12 E035', ourFactory: '(AMP)', colorCode: 'RED', description: 'ROSE BUNCH X12 IN GIFT BOX 45CM H\n24 pcs/ctn.', pcsCtn: '24', noCtns: '18', qty: '432', unit: 'PCS', price: '2.88', total: '1244.16' },
      { id: 'l-70032', yourItemNo: '70032', ourItem: 'P22AZWH04 E035', ourFactory: '(AMP)', colorCode: 'WHITE', description: 'PEONY STEM 60CM H\n48 pcs/ctn.', pcsCtn: '48', noCtns: '5', qty: '240', unit: 'PCS', price: '3.9175', total: '940.20' }
    ],
    page2: { container: 'LCL', fromPort: 'Colombo, Sri Lanka', toPort: 'Hamburg' }
  }
  for (const pf of [rna, sch])
    put.run(pf.id, pf.header.invoiceNo, pf.header.customer.name, pf.header.date, Date.now(), null, `${pf.header.invoiceNo} ${pf.header.customer.name}`.toLowerCase(), JSON.stringify(pf))
  db.close()
}

/** Step 1, before the settings are read: the sample proforma database and settings that link it. */
export function seedDemoFiles(dataDir: string) {
  mkdirSync(dataDir, { recursive: true })
  const pmaDir = join(dataDir, 'demo-pma')
  mkdirSync(pmaDir, { recursive: true })
  const pmaFile = join(pmaDir, 'quotations.db')
  if (!existsSync(pmaFile)) writeProformaDb(pmaFile)
  const settings = join(dataDir, 'settings.json')
  if (!existsSync(settings))
    writeFileSync(settings, JSON.stringify({ ...DEFAULT_SETTINGS, pmaDbPath: pmaFile, company: { ...DEFAULT_SETTINGS.company, email: 'dgl@eureka.lk' } }, null, 2))
}

/** Step 2, once the store is open: invoices, packing lists and shipping records (only into an empty store). */
export function seedDemoStore(store: ShipStore) {
  if (store.list('', 1).length) return
  const saved = invoices().map((ci) => store.save(ci))
  const byNo = new Map(saved.map((ci) => [ci.invoiceNo, ci]))

  // packing lists: the LANDMARK sample (CBM 54.00, nett 3,029.10, gross 5,236.70) and the SCHWARTINSKY one (CBM 1.60)
  const rna = byNo.get('M/26/021')!
  store.packingSave(
    packingFor(rna, new Map(RNA_ITEMS.map(([your, , , , , , , , n, g, l, w, h, ctnNo]) => [your, { nettCtn: String(n), grossCtn: String(g), length: String(l), width: String(w), height: String(h), ctnNo }])))
  )
  const sch = byNo.get('M/26/015')!
  store.packingSave(
    packingFor(sch, new Map<string, Partial<PlLine>>([
      ['70031', { ctnNo: '001-018', nettCtn: '4.2', grossCtn: '6.0', length: '50', width: '40', height: '40' }],
      ['70032', { ctnNo: '019-023', nettCtn: '5.5', grossCtn: '7.4', length: '40', width: '40', height: '20' }]
    ]))
  )

  // shipping records: September (the paper sample) and October (two rows, one under AMP-1)
  const row = (no: string, cbm: string, p: Partial<RecordRow>): RecordRow => ({ ...rowFromInvoice(byNo.get(no)!, cbm), ...p })
  store.recordSave({
    ...newRecord('2026-09', '2026-09-25'),
    rows: [row('M/26/015', '1.60', { usRate: '333.0703', cusdecNo: '87348', cusdecDate: '2026-09-18', freightTo: 'CUS', totFreight: '0.00' })]
  })
  store.recordSave({
    ...newRecord('2026-10', '2026-10-28'),
    rows: [
      row('M/26/021', '54.00', { usRate: '300.4510', cusdecNo: '91022', cusdecDate: '2026-10-09', freightTo: 'CUS' }),
      row('M/26/022', '', { usRate: '300.1200', cusdecNo: '91310', cusdecDate: '2026-10-21', factory: 'AMP-1', totFreight: '350.00', freight: '350.00', freightTo: 'AMP' })
    ]
  })
}
