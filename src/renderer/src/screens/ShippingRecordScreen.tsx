import { useEffect, useMemo, useState } from 'react'
import { normInvoiceNo } from '@shared/proforma'
import {
  blankRow, FACTORIES, monthTitle, newRecord, normalizeRecord, recordTotals, rupees,
  type RecordRow, type RecordSummary, type ShippingRecord
} from '@shared/shippingRecord'
import type { InvoiceSummary } from '@shared/types'
import { Icon } from '../icons'
import { ConfirmDialog, Drawer, errorText, fmtMoney, fmtTime, useAdmin, useToast } from '../ui'

const DRAFT_KEY = 'shp.record.draft.v1'
/** fields typed by hand: kept when a row is fetched again from its invoice */
const HAND_TYPED: (keyof RecordRow)[] = ['usRate', 'cusdecNo', 'cusdecDate', 'factory', 'freight', 'freightTo', 'totFreight']

const SOURCE: Record<RecordRow['source'], { label: string; cls: string }> = {
  app: { label: 'App invoice', cls: 'badge ok' },
  foxpro: { label: 'FoxPro', cls: 'badge purple' },
  manual: { label: 'Typed by hand', cls: 'badge' }
}

function loadDraft(): ShippingRecord | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? normalizeRecord(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** The monthly shipping record: add commercial invoices by number, type CUSDEC, rate and BL/ETA, print. */
export default function ShippingRecordScreen() {
  const toast = useToast()
  const ensureAdmin = useAdmin()
  const [rec, setRec] = useState<ShippingRecord | null>(null)
  const [dirty, setDirty] = useState(false)
  const [invNo, setInvNo] = useState('')
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([])
  const [savedOther, setSavedOther] = useState<string | null>(null)
  const [list, setList] = useState<RecordSummary[] | null>(null)
  const [preview, setPreview] = useState<{ url: string; pages: number } | null>(null)
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState<null | 'delete' | 'new'>(null)

  useEffect(() => {
    window.api.invoiceList('').then(setInvoices).catch(() => undefined)
    const draft = loadDraft()
    if (draft && draft.rows.length) return setRec(draft)
    const blank = newRecord()
    window.api
      .recordForMonth(blank.month)
      .then((saved) => setRec(saved ?? blank))
      .catch(() => setRec(blank))
  }, [])

  // keep an unsaved new record on this PC
  useEffect(() => {
    if (!rec || rec.id) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(rec))
    } catch {
      /* ignore */
    }
  }, [rec])

  // is another record already saved for this month?
  const month = rec?.month ?? ''
  useEffect(() => {
    if (!month) return
    window.api
      .recordForMonth(month)
      .then((r) => setSavedOther(r && r.id !== rec?.id ? r.id : null))
      .catch(() => setSavedOther(null))
  }, [month, rec?.id])

  const totals = useMemo(() => recordTotals(rec?.rows ?? []), [rec?.rows])

  const set = <K extends keyof ShippingRecord>(k: K, v: ShippingRecord[K]) => {
    setRec((r) => (r ? { ...r, [k]: v } : r))
    setDirty(true)
  }
  const setRow = (id: string, patch: Partial<RecordRow>) => {
    setRec((r) => (r ? { ...r, rows: r.rows.map((x) => (x.id === id ? { ...x, ...patch } : x)) } : r))
    setDirty(true)
  }
  const moveRow = (i: number, by: number) =>
    setRec((r) => {
      if (!r) return r
      const rows = [...r.rows]
      const j = i + by
      if (j < 0 || j >= rows.length) return r
      ;[rows[i], rows[j]] = [rows[j], rows[i]]
      setDirty(true)
      return { ...r, rows }
    })

  const addInvoice = async () => {
    if (!rec) return
    const no = invNo.trim().toUpperCase()
    if (!no) return toast('Type the commercial invoice no.', 'warn')
    if (rec.rows.some((r) => normInvoiceNo(r.invoiceNo) === normInvoiceNo(no))) return toast(`${no} is already in this record.`, 'warn')
    setBusy('Fetching…')
    try {
      const row = await window.api.recordRowFor(no)
      if (row) {
        set('rows', [...rec.rows, row])
        toast(`Added ${row.invoiceNo} from ${row.source === 'app' ? 'the saved invoice' : 'the FoxPro table'}. Type the CUSDEC no, date and US$ rate.`)
      } else {
        set('rows', [...rec.rows, blankRow(no)])
        toast(`${no} is not saved in the app or in FoxPro. A blank row was added — type its details.`, 'warn')
      }
      setInvNo('')
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const refetch = async (row: RecordRow) => {
    try {
      const fresh = await window.api.recordRowFor(row.invoiceNo)
      if (!fresh) return toast(`${row.invoiceNo} is not saved in the app or in FoxPro.`, 'warn')
      const keep = Object.fromEntries(HAND_TYPED.map((k) => [k, row[k]])) as Partial<RecordRow>
      setRow(row.id, { ...fresh, ...keep, id: row.id })
      toast(`Fetched ${row.invoiceNo} again. The rate, CUSDEC and freight you typed are kept.`)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const save = async () => {
    if (!rec) return
    if (rec.id && !(await ensureAdmin(`save changes to the saved shipping record for ${monthTitle(rec.month)}`))) return
    setBusy('Saving…')
    try {
      const saved = await window.api.recordSave(rec)
      setRec(normalizeRecord(saved))
      setDirty(false)
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* ignore */
      }
      toast(`Saved the shipping record for ${monthTitle(saved.month)}.`)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }
  const showPreview = () =>
    run('Making the PDF…', async () => {
      const r = await window.api.recordPreview(rec!)
      const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
      if (preview) URL.revokeObjectURL(preview.url)
      setPreview({ url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), pages: r.pages })
    })
  const savePdf = () =>
    run('Saving the PDF…', async () => {
      const p = await window.api.recordSavePdf(rec!)
      if (p) toast(`PDF saved: ${p}`)
    })
  const print = () => run('Opening for print…', () => window.api.recordPrint(rec!))

  const open = async (id: string) => {
    const r = await window.api.recordGet(id)
    if (!r) return toast('That record is no longer saved.', 'error')
    setRec(r)
    setDirty(false)
    setList(null)
  }
  const startNew = () => {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore */
    }
    setRec(newRecord())
    setDirty(false)
  }

  if (!rec) return <div className="empty">Loading…</div>

  const title = monthTitle(rec.month)
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Shipping Record · {title}</h1>
          <div className="sub">
            {rec.id ? 'Saved in the app — changes need the admin password' : 'Not saved yet'}
            {` · ${rec.rows.length} invoice${rec.rows.length === 1 ? '' : 's'}`}
            {dirty ? ' · unsaved changes' : ''}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => window.api.recordList().then(setList).catch((e) => toast(errorText(e), 'error'))}>
            <Icon name="list" /> Saved records
          </button>
          <button className="btn" onClick={() => (dirty ? setConfirm('new') : startNew())}>
            <Icon name="plus" /> New
          </button>
          <button className="btn danger" disabled={!rec.id} onClick={async () => (await ensureAdmin(`delete the shipping record for ${title}`)) && setConfirm('delete')}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      </div>

      <div className="editor">
        <div className="card">
          <div className="recbar">
            <label className="f">
              Month
              <input type="month" value={rec.month} onChange={(e) => e.target.value && set('month', e.target.value)} />
            </label>
            <label className="f">
              Report date
              <input type="date" value={rec.reportDate} onChange={(e) => set('reportDate', e.target.value)} />
            </label>
            <div className="recadd">
              <label className="f">
                Add a commercial invoice
                <input
                  className="big"
                  list="rec-invoices"
                  value={invNo}
                  onChange={(e) => setInvNo(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && addInvoice()}
                  placeholder="M/26/015"
                  spellCheck={false}
                />
                <datalist id="rec-invoices">
                  {invoices.map((i) => (
                    <option key={i.id} value={i.invoiceNo}>
                      {[i.customer, i.vessel].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </datalist>
              </label>
              <button className="btn dark" onClick={addInvoice} disabled={!!busy}>
                <Icon name="plus" /> Add
              </button>
            </div>
          </div>
          <div className="hint mt muted" style={{ fontSize: 12 }}>
            The details come from the saved commercial invoice, or from the FoxPro table for older invoices. CBM comes from its packing list. Type the CUSDEC no and date, the US$ rate and anything else by hand.
          </div>
          {savedOther && (
            <div className="notice warn mt">
              <Icon name="file" />
              <span className="grow">The shipping record for {title} is already saved. Open it to add to it, or pick another month.</span>
              <button className="btn small dark" onClick={() => open(savedOther)}>
                Open {title}
              </button>
            </div>
          )}
        </div>

        {rec.rows.map((r, i) => (
          <RowCard
            key={r.id}
            row={r}
            index={i}
            onChange={(p) => setRow(r.id, p)}
            onUp={() => moveRow(i, -1)}
            onDown={() => moveRow(i, 1)}
            onRemove={() => set('rows', rec.rows.filter((x) => x.id !== r.id))}
            onRefetch={r.source === 'manual' ? undefined : () => refetch(r)}
          />
        ))}
        {!rec.rows.length && (
          <div className="card">
            <div className="emptystate">
              <div className="ico">
                <Icon name="ship" size={20} />
              </div>
              <b>No invoices in this record yet</b>
              <span>Type a commercial invoice no above and press Add. Each invoice is one row of the report.</span>
            </div>
          </div>
        )}

        {rec.rows.length > 0 && (
          <div className="card">
            <div className="cardhead">
              <h2>Totals</h2>
              <span className="hint">SUB TOTAL / GRAND TOTAL of the report</span>
            </div>
            <div className="totalsbar" style={{ justifyContent: 'flex-start' }}>
              <div className="tbox dark">
                <span className="eyebrow">Total AMT$</span>
                <b>{fmtMoney(totals.total)}</b>
              </div>
              {FACTORIES.map((f) => (
                <div className="tbox" key={f}>
                  <span className="eyebrow">{f}</span>
                  <b>{fmtMoney(totals.byFactory[f])}</b>
                </div>
              ))}
              <div className="tbox">
                <span className="eyebrow">Freight</span>
                <b>{fmtMoney(totals.freight)}</b>
              </div>
              <div className="tbox">
                <span className="eyebrow">Dis / Com / VAT</span>
                <b>{fmtMoney(totals.commDiscVat)}</b>
              </div>
              <div className="tbox">
                <span className="eyebrow">Value in Rs</span>
                <b>{fmtMoney(totals.rupees)}</b>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="stickybar">
        <span className="grow">{busy || `${title} · ${rec.rows.length} invoices · US$ ${fmtMoney(totals.total)}${dirty ? ' · unsaved changes' : ''}`}</span>
        <button className="btn light" onClick={showPreview} disabled={!!busy || !rec.rows.length}>
          <Icon name="eye" /> Preview
        </button>
        <button className="btn light" onClick={savePdf} disabled={!!busy || !rec.rows.length}>
          <Icon name="download" /> Save PDF
        </button>
        <button className="btn light" onClick={print} disabled={!!busy || !rec.rows.length}>
          <Icon name="printer" /> Print
        </button>
        <button className="btn lime" onClick={save} disabled={!!busy}>
          <Icon name={rec.id ? 'lock' : 'check'} /> {rec.id ? 'Save changes' : 'Save'}
        </button>
      </div>

      {preview && (
        <Drawer
          wide
          title={`Preview · ${preview.pages} page${preview.pages === 1 ? '' : 's'}`}
          onClose={() => {
            URL.revokeObjectURL(preview.url)
            setPreview(null)
          }}
          actions={
            <>
              <button className="btn" onClick={savePdf}>
                <Icon name="download" /> Save PDF
              </button>
              <button className="btn dark" onClick={print}>
                <Icon name="printer" /> Print
              </button>
            </>
          }
        >
          <iframe className="pdfframe" src={preview.url} title="Shipping record preview" />
        </Drawer>
      )}

      {list && (
        <Drawer title="Saved shipping records" onClose={() => setList(null)}>
          <div className="list">
            {list.length === 0 && <div className="empty">No shipping records saved yet.</div>}
            {list.map((r) => (
              <div key={r.id} className={r.id === rec.id ? 'row sel' : 'row'} onClick={() => open(r.id)}>
                <div className="ic">
                  <Icon name="file" />
                </div>
                <b style={{ minWidth: 130 }}>{monthTitle(r.month)}</b>
                <span className="grow muted">saved {fmtTime(r.updatedAt)}</span>
                <span className="badge">{r.rowCount} invoices</span>
                <span className="badge soft">US$ {fmtMoney(r.total)}</span>
              </div>
            ))}
          </div>
        </Drawer>
      )}

      {confirm === 'new' && (
        <ConfirmDialog
          title="Start a new shipping record?"
          text="This record has changes that are not saved. They will be lost."
          confirmLabel="Discard and start new"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            startNew()
          }}
        />
      )}
      {confirm === 'delete' && rec.id && (
        <ConfirmDialog
          title={`Delete the shipping record for ${title}?`}
          text="The record is removed from the app's database. The change log keeps a copy of it. The invoices are not touched."
          confirmWord={title}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              toast(await window.api.recordDelete(rec.id!))
              setConfirm(null)
              startNew()
            } catch (e) {
              toast(errorText(e), 'error')
            }
          }}
        />
      )}
    </>
  )
}

function RowCard({
  row, index, onChange, onUp, onDown, onRemove, onRefetch
}: {
  row: RecordRow
  index: number
  onChange: (p: Partial<RecordRow>) => void
  onUp: () => void
  onDown: () => void
  onRemove: () => void
  onRefetch?: () => void
}) {
  const rs = rupees(row)
  const src = SOURCE[row.source]
  const F = ({ k, label, wide, up, type, need }: { k: keyof RecordRow; label: string; wide?: boolean; up?: boolean; type?: string; need?: boolean }) => (
    <label className={`f${wide ? ' span2' : ''}${need && !String(row[k]).trim() ? ' need' : ''}`}>
      {label}
      <input type={type ?? 'text'} value={String(row[k] ?? '')} onChange={(e) => onChange({ [k]: up ? e.target.value.toUpperCase() : e.target.value } as Partial<RecordRow>)} />
    </label>
  )
  return (
    <div className="card recrow">
      <div className="cardhead">
        <span className="recidx">{String(index + 1).padStart(2, '0')}</span>
        <div>
          <h2>{row.invoiceNo || 'New row'}</h2>
          <div className="muted" style={{ fontSize: 12 }}>
            {row.customer || 'no customer'}
          </div>
        </div>
        <span className={src.cls}>{src.label}</span>
        <div className="right">
          <span className="recamt">US$ {fmtMoney(Number(row.totalAmt) || 0)}</span>
          {onRefetch && (
            <button className="roundbtn" title="Fetch again from the invoice (what you typed by hand is kept)" onClick={onRefetch}>
              <Icon name="refresh" />
            </button>
          )}
          <button className="roundbtn" title="Move up" onClick={onUp}>
            <Icon name="up" />
          </button>
          <button className="roundbtn" title="Move down" onClick={onDown}>
            <Icon name="down" />
          </button>
          <button className="roundbtn danger" title="Remove from the record" onClick={onRemove}>
            <Icon name="trash" />
          </button>
        </div>
      </div>

      <div className="recsec">Invoice</div>
      <div className="recgrid">
        {F({ k: 'invoiceNo', label: 'Inv. no', up: true })}
        {F({ k: 'invDate', label: 'Inv. date', type: 'date' })}
        {F({ k: 'cmbRefNo', label: 'CMB ref.', up: true })}
        {F({ k: 'orderNo', label: 'Order no', up: true })}
        {F({ k: 'customer', label: 'Customer', up: true })}
        {F({ k: 'notify', label: 'Second name line', up: true })}
      </div>

      <div className="recsec">Amounts</div>
      <div className="recgrid">
        {F({ k: 'totalAmt', label: 'Total AMT$' })}
        <label className="f">
          Factory (FAC)
          <select value={row.factory} onChange={(e) => onChange({ factory: e.target.value as RecordRow['factory'] })}>
            {FACTORIES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        {F({ k: 'amount', label: 'Amount' })}
        {F({ k: 'commDiscVat', label: 'Comm / disc / VAT' })}
        {F({ k: 'creditTo', label: 'Credit to', up: true })}
        {F({ k: 'totFreight', label: 'Tot. freight' })}
        {F({ k: 'freight', label: 'Freight' })}
        {F({ k: 'freightTo', label: 'Freight to', up: true })}
        {F({ k: 'usRate', label: 'US$ rate', need: true })}
        <label className="f span3">
          Value in Rs (Total AMT$ × US$ rate)
          <div className="rsval">{rs ? `Rs ${fmtMoney(rs)}` : 'Type the US$ rate'}</div>
        </label>
      </div>

      <div className="recsec">Shipping &amp; customs</div>
      <div className="recgrid">
        {F({ k: 'cbm', label: 'Total CBM' })}
        {F({ k: 'volume', label: 'Volume', up: true })}
        {F({ k: 'line', label: 'Line', up: true })}
        {F({ k: 'vessel', label: 'Vessel', up: true })}
        {F({ k: 'payTerms', label: 'Pay terms', up: true })}
        {F({ k: 'cusdecNo', label: 'CUSDEC no', need: true })}
        {F({ k: 'cusdecDate', label: 'CUSDEC date', type: 'date', need: true })}
        {F({ k: 'blDate', label: 'BL date', type: 'date' })}
        {F({ k: 'eta', label: 'ETA', type: 'date' })}
        {F({ k: 'portDischarge', label: 'Port of discharge', up: true })}
        {F({ k: 'portDelivery', label: 'Port of delivery', up: true, wide: true })}
      </div>
    </div>
  )
}
