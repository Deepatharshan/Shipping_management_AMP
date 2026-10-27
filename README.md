# Shipping Management AMP

A Windows desktop app for **AMP Ceylon (Pvt) Ltd** that makes the **commercial invoice** (the shipping
report, `COMMERCIAL INVOICE NO : M/23/002`) from a **proforma invoice** made in the Product Management
App, and keeps every shipment both in its **own database** and in the old **FoxPro shipping table**
(`deldem shipping.DBF` + `SHIPPING.IDX`).

Built with Electron, React and TypeScript, the same way as the Product Management App and Inventory AMP.

---

## What it does

1. **Type the proforma invoice number → Fetch details.** The customer (consignee), the port of
   discharge, the container size and every item (your item no, our item no, description, packing,
   colour, cartons, quantity, price, total) come from the Product Management App's database.
   Barcodes typed on earlier invoices for the same items are filled in too.
2. **Type the shipment details by hand:** commercial invoice no, vessel, voyage, ETD, ETA, container
   no, container seal no, payment terms, ASN no, PO no, shipping marks, applicant's order reference.
   Every value can be changed; quantities can be changed to what was actually shipped.
3. **Page 2 blocks** — the totals, the amount in words (automatic, can be typed over), "We hereby
   certify that a) b) c)", the HS code note, and the **Beneficiary** and **bank (Seylan Bank PLC)**
   blocks — are text areas with defaults from Settings.
4. **Preview / Save PDF / Print.** A4, in the layout of the old printout: the company block, invoice no,
   consignee, vessel block, ASN no and column titles repeat on every page; an item never splits
   across pages; "Page : n" on each page.
5. **Save** keeps the invoice in the app's database and, when switched on, **creates or updates its
   record in the FoxPro shipping table** and rebuilds `SHIPPING.IDX`.

Other screens:

| Screen | |
| --- | --- |
| Dashboard | Counts, the selected shipment's container load, recent invoices, and a sailing schedule (ETD → ETA bars) |
| Shipments | Every invoice saved in the app: search, open, print, delete (optionally also in FoxPro) |
| Proforma Invoices | The proformas in the Product Management App; "Make commercial invoice" |
| FoxPro Records | All 13,000 records of the old table: search, view every field, **edit, delete, recall**, open as invoice |
| Change Log | Every save / delete / reindex, with old and new FoxPro values |
| Settings (admin) | Links to the data, the FoxPro writing switch, index files, invoice defaults, backup, logins |

## Logins

First start: user **`ampshipping`**, password **`Ship@2026`**; admin (Settings) password **`Admin@2026`**.
Change them in **Settings → Logins**. Only salted scrypt hashes are stored (`auth.json`).

## Connecting the two PCs (proforma invoices)

The Product Management App keeps its proformas in
`%APPDATA%\Photo Quotation Generator\quotations\quotations.db` on the product manager's PC.

1. On the **product manager's PC**: open that folder, right-click **quotations** → Properties →
   Sharing → Share (Read is enough).
2. On the **shipping manager's PC**: Settings → Product Management App database → type or choose
   `\\PRODUCT-PC\quotations\quotations.db`. On the same PC, **Use the one on this PC** fills it in.

The app never opens that database in place. Each time a PI is fetched it **copies** the file (and its
`-wal` journal, which holds the newest saves while the other app is open) into its own folder,
checks the copy with SQLite's `quick_check`, and reads the copy. A copy is taken again only when
the source changed. Nothing is ever written there.

## The FoxPro shipping table

| Invoice | FoxPro field (width) |
| --- | --- |
| Commercial invoice no | `COM_INV_NO` (15) — the key of `SHIPPING.IDX` |
| Date | `DTE_OF_INV` |
| Total amount | `TOTAL_AMT` (N10.2) |
| Vessel | `VASSEL` (20) |
| ETD / ETA | `SHIP_DATE` / `ARIVAL_DTE` |
| Container no / seal no | `CONT_NO` (25) / `SEAL_NR` (15) |
| Payment terms | `PAY_TERMS` (3) |
| POD | `PORTDIS` (20) |
| Customer (from the proforma) | `CUST_CODE`, `CUST_NAME`, `STREET_1`, `STREET_2`, `CITY`, `COUNTRY` |
| "FoxPro details" in the editor | `CMB_REF_NO`, `SHIP_TERMS`, `SHIP_LINE`, `CONT_NO_2`, `CONT_SIZE`, `CON_TYPE`, `CON_HEIGHT`, `CON_LENGTH`, `LC_NO`, `LC_EXP_DTE`, `BILL_LADIN`, `BANK_CODE`, `CREDIT_TO`, `CREDIT_AMT`, `COMM_AMT`, `GST_AMT`, `INV_NO_AMP`, `COUR_NO`, `COUR_DATE`, `PORTDEL`, `DES_GOODS`, `COM_REMARK` |

The voyage, ASN no, PO no, item lines, marks and the page-2 text have **no field in the old table**;
they are kept in the app's database and printed.

All field names are in one file: [`src/shared/foxMap.ts`](src/shared/foxMap.ts).

**Never written:** the memo fields (`SHIPPING`, `S_EXPENSES`) and the expense / charge fields
(`FREIGHT` … `FUMIG_CHG7`, `ADV_TAKEN`, `BALANCE`, `BNK_CHGS`) of the old expense screens.

**Text encoding.** The table's header says code page `0x04` (Macintosh), and the data confirms it
(`TEPEÜSTÜ`, `CARRÉ`, `DECORAÇÃO` only read correctly as Mac Roman). The app reads and writes text
in the table's own code page ([`src/shared/codepage.ts`](src/shared/codepage.ts)); a character that
code page cannot hold is refused rather than changed.

**Too long for the field.** The full value is kept in the app and printed; FoxPro gets the first
characters that fit (e.g. payment terms `T/T 30 DAYS` → `T/T`). The editor shows this under the field
before saving, and the save message lists it.

### How writing works (Settings → "Save to the FoxPro shipping table", off by default)

| Action | What is written |
| --- | --- |
| Save a new invoice | One new record at the end + the record count in the header; then `SHIPPING.IDX` is rebuilt from the table |
| Save again | Only the mapped fields of that one record, after checking it still has the invoice no the app last saw; the index is rebuilt only if the invoice no changed |
| Invoice no already in FoxPro (made by the old program) | The editor offers **Use FoxPro record**: the invoice is linked to it, the record's values fill the blank fields, and saving updates that record (nothing is blanked out) |
| Delete | Marks the record deleted (`*`), exactly like FoxPro's `DELETE`; **Recall** removes the mark. The record stays until FoxPro packs the table |
| FoxPro Records → edit | Only the fields you changed, in that one record |

Safeguards ([`src/main/dbf/writer.ts`](src/main/dbf/writer.ts), [`src/main/dbf/idx.ts`](src/main/dbf/idx.ts), [`src/main/foxShipping.ts`](src/main/foxShipping.ts)):

- `SHIPPING.IDX` is a standard (non-compact) FoxPro index on `com_inv_no`. Before a record is added
  the index must match the table exactly; afterwards it is rebuilt and verified (the file is written
  beside the old one and swapped in). An index that does not match is never touched — Settings shows
  it and offers **Rebuild**.
- The same invoice no cannot be added twice. A changed record is refused ("changed by someone else").
- After every write the record is read back and compared. Every change is in the Change Log.
- **Before the first write each day**, the table, its memo file and its index are copied to
  `%APPDATA%\Shipping Management AMP\foxpro-safety\YYYY-MM-DD\` (14 days kept).
- A lock file keeps two copies of this app from writing at once. **FoxPro's own record locks are not
  used**, so the table must not be open for writing in FoxPro while the app saves.

Checked against copies of the real files (`tests/fox.test.ts`): 12,987 records read, the index
matches; add / update / delete / recall keep `SHIPPING.IDX` identical to what FoxPro builds; the old
records stay byte-for-byte unchanged; an old record opened and saved again is unchanged.

## Where the app keeps its files

`%APPDATA%\Shipping Management AMP\`

| | |
| --- | --- |
| `shipments.db` | Every commercial invoice and the change log — **the staff's work: back it up** |
| `settings.json`, `auth.json` | Settings; login hashes |
| `foxpro-safety\` | Daily copies of the FoxPro files before the first write |
| `pma-copy\` | The copy of the Product Management App database (disposable) |

**Settings → Backup → Back up now** makes `ShippingAMP-backup-YYYY-MM-DD_HHMMSS` with the FoxPro
files, `shipments.db` and the settings.

## Developing

Requirements: Windows, Node.js 22.12 or later. No native modules: the app uses the SQLite built into
Electron (`node:sqlite`), so `npm install` needs no build tools.

```bash
npm install
npm run dev          # run with hot reload
npm test             # tests, inside Electron's Node
npm run typecheck
npm run dist         # dist/Shipping-Management-AMP-Setup-<version>.exe
```

Real data for the tests goes in `real-data/` (git-ignored, never commit it):
`real-data/deldem shipping.DBF` and `real-data/SHIPPING.IDX`.

## Project layout

```
src/
  main/
    index.ts            IPC handlers, logins, window
    foxShipping.ts      the FoxPro shipping table: list, read, create, update, delete, reindex
    dbf/reader.ts       DBF header / record reader (read-only)
    dbf/writer.ts       the only code that changes a DBF: one record at a time
    dbf/idx.ts          standard .IDX: check against the table, rebuild
    store.ts            the app database (shipments.db)
    proformaSource.ts   proformas from the Product Management App (from a copy)
    pdf/                commercial invoice HTML template + PDF
    backup.ts safety.ts settings.ts auth.ts sql.ts
  shared/
    invoice.ts          the commercial invoice model, totals, amount in words
    proforma.ts         proforma → commercial invoice
    foxMap.ts           the FoxPro field mapping (only place with field names)
    codepage.ts         Mac Roman / Windows-1252
    ipc.ts types.ts
  renderer/             React screens
tests/                  vitest
```

---

Developed by **P.Deepatharshan**.
