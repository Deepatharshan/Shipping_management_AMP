import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  amountInWords, blankLine, CI_UNITS, computeCtns, DEFAULT_CI, DEFAULT_DISCOUNT_LABEL, invoiceSums, invoiceTotals, lineTotal, newInvoice, normalizeInvoice,
  type CiDefaults, type CiLine, type CommercialInvoice, type FoxExtra
} from '@shared/invoice'
import { invoiceFromProforma, type ProformaSummary } from '@shared/proforma'
import { FOX_EXTRA_FIELDS, FOX_MAIN_FIELDS, linkToFox, type FieldInfo } from '@shared/foxMap'
import type { FoxRow, Settings } from '@shared/types'
import type { OpenRequest, Screen } from '../App'
import { Icon } from '../icons'
import { ConfirmDialog, Drawer, errorText, fmtDate, fmtMoney, SearchBox, useAdmin, useToast } from '../ui'

const DRAFT_KEY = 'shp.draft.v1'

function loadDraft(d: CiDefaults): CommercialInvoice {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw) return normalizeInvoice(JSON.parse(raw), d)
  } catch {
    /* ignore */
  }
  return newInvoice(d)
}

type FoxMainKey = keyof typeof FOX_MAIN_FIELDS

export default function InvoiceEditor({ request, onHandled, go }: { request: OpenRequest; onHandled: () => void; go: (s: Screen, r?: OpenRequest) => void }) {
  const toast = useToast()
  const ensureAdmin = useAdmin()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [ci, setCi] = useState<CommercialInvoice | null>(null)
  const [dirty, setDirty] = useState(false)
  const [fields, setFields] = useState<Map<string, FieldInfo>>(new Map())
  const [piNo, setPiNo] = useState('')
  const [piChoices, setPiChoices] = useState<ProformaSummary[] | null>(null)
  const [browse, setBrowse] = useState(false)
  const [foxMatch, setFoxMatch] = useState<FoxRow[]>([])
  const [preview, setPreview] = useState<{ url: string; pages: number } | null>(null)
  const [busy, setBusy] = useState('')
  const [toFox, setToFox] = useState(true)
  const [confirm, setConfirm] = useState<null | { kind: 'replace'; id: string } | { kind: 'delete' } | { kind: 'new' }>(null)
  const [lastSave, setLastSave] = useState<{ fox: string; warnings: string[] } | null>(null)
  const d = settings?.defaults ?? DEFAULT_CI

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s)
      setCi((cur) => cur ?? loadDraft(s.defaults))
    })
    window.api.foxFieldInfo().then((f) => setFields(new Map(f.map((x) => [x.name, x])))).catch(() => undefined)
  }, [])

  // keep an unsaved new invoice on this PC so nothing is lost when switching screens
  useEffect(() => {
    if (!ci) return
    try {
      if (!ci.id) localStorage.setItem(DRAFT_KEY, JSON.stringify(ci))
    } catch {
      /* ignore */
    }
  }, [ci])

  const applyFetched = useCallback(
    async (id: string, base: CommercialInvoice | null) => {
      const pf = await window.api.pmaGet(id)
      if (!pf) return toast('That proforma invoice is no longer in the Product Management App.', 'error')
      const next = invoiceFromProforma(pf, d, base ?? undefined)
      // barcodes are not in the proforma: use the ones typed on earlier invoices for the same items
      const known = await window.api.knownBarcodes().catch(() => ({}) as Record<string, string>)
      let filled = 0
      next.lines = next.lines.map((l) => {
        const b = known[`${l.yourItemNo.trim().toUpperCase()}|${l.ourItem.trim().toUpperCase()}`]
        if (b && !l.barcode) filled++
        return b && !l.barcode ? { ...l, barcode: b } : l
      })
      setCi(next)
      setPiNo(next.piNo)
      setPiChoices(null)
      setDirty(true)
      toast(
        `Fetched PI ${next.piNo}: ${next.lines.length} item${next.lines.length === 1 ? '' : 's'}, ${next.consignee.split('\n')[0] || 'no customer'}.` +
          (filled ? ` ${filled} barcode${filled > 1 ? 's' : ''} filled from earlier invoices.` : '')
      )
    },
    [d, toast]
  )

  // requests from other screens
  useEffect(() => {
    if (!request || !settings) return
    if (request.kind === 'new') {
      const n = newInvoice(settings.defaults)
      setCi(n)
      setPiNo('')
      setDirty(false)
      setLastSave(null)
    } else if (request.kind === 'invoice') {
      setCi(normalizeInvoice(request.invoice, settings.defaults))
      setPiNo(request.invoice.piNo)
      setDirty(false)
      setLastSave(null)
    } else if (request.kind === 'pi') {
      void applyFetched(request.piId, newInvoice(settings.defaults))
    }
    onHandled()
  }, [request, settings])

  // is the invoice no already in the FoxPro table?
  const invNo = ci?.invoiceNo ?? ''
  useEffect(() => {
    if (!invNo.trim()) return setFoxMatch([])
    const t = setTimeout(() => window.api.foxFind(invNo).then(setFoxMatch).catch(() => setFoxMatch([])), 350)
    return () => clearTimeout(t)
  }, [invNo])

  const set = <K extends keyof CommercialInvoice>(k: K, v: CommercialInvoice[K]) => {
    setCi((c) => (c ? { ...c, [k]: v } : c))
    setDirty(true)
  }
  const setFox = (k: keyof FoxExtra, v: string) => {
    setCi((c) => (c ? { ...c, fox: { ...c.fox, [k]: v } } : c))
    setDirty(true)
  }
  const setLine = (id: string, patch: Partial<CiLine>) => {
    setCi((c) => {
      if (!c) return c
      return {
        ...c,
        lines: c.lines.map((l) => {
          if (l.id !== id) return l
          const n = { ...l, ...patch }
          if (('qty' in patch || 'pcsCtn' in patch) && n.pcsCtn.trim() && !('ctns' in patch)) n.ctns = computeCtns(n.qty, n.pcsCtn) || n.ctns
          if ('total' in patch) n.totalEdited = patch.total !== '' && patch.total !== lineTotal(n)
          else if (('qty' in patch || 'price' in patch) && !n.totalEdited) n.total = n.qty.trim() && n.price.trim() ? lineTotal(n) : ''
          return n
        })
      }
    })
    setDirty(true)
  }
  const moveLine = (i: number, by: number) =>
    setCi((c) => {
      if (!c) return c
      const lines = [...c.lines]
      const j = i + by
      if (j < 0 || j >= lines.length) return c
      ;[lines[i], lines[j]] = [lines[j], lines[i]]
      setDirty(true)
      return { ...c, lines }
    })

  const totals = useMemo(() => invoiceTotals(ci?.lines ?? []), [ci?.lines])
  const sums = useMemo(
    () => invoiceSums({ lines: ci?.lines ?? [], discount: ci?.discount ?? '', discountType: ci?.discountType ?? 'percent' }),
    [ci?.lines, ci?.discount, ci?.discountType]
  )

  /** A note when a value is longer than its FoxPro field. */
  const width = (field: string, value: string) => {
    const f = fields.get(field)
    if (!f || f.type !== 'C' || !settings?.writeFoxPro) return null
    const v = value.replace(/\r?\n/g, ' ')
    if (v.length <= f.length) return null
    return <span className="fieldnote">FoxPro keeps {f.length} characters: “{v.slice(0, f.length).trimEnd()}”</span>
  }

  const fetchPi = async () => {
    if (!ci) return
    const no = piNo.trim()
    if (!no) return toast('Type the proforma invoice number.', 'warn')
    setBusy('Fetching…')
    try {
      const found = await window.api.pmaFind(no)
      if (!found.length) toast(`No proforma invoice ${no} in the Product Management App. Check the number, or browse the list.`, 'warn')
      else if (found.length > 1) setPiChoices(found)
      else if (ci.lines.length && ci.piId !== found[0].id) setConfirm({ kind: 'replace', id: found[0].id })
      else await applyFetched(found[0].id, ci)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const linkFoxRecord = async (row: FoxRow) => {
    if (!ci) return
    try {
      const values = await window.api.foxRecordValues(row.recno)
      setCi(linkToFox(ci, values, row.recno))
      setDirty(true)
      toast(`Linked to FoxPro record ${row.recno}. Its values filled the blank fields; saving updates that record.`)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const save = async () => {
    if (!ci) return
    if (!ci.invoiceNo.trim()) return toast('Type the commercial invoice no first.', 'warn')
    if (ci.id && !(await ensureAdmin(`save changes to the saved invoice ${ci.invoiceNo}`))) return
    if (!ci.id && ci.foxRecno && toFox && settings?.writeFoxPro && !(await ensureAdmin(`update FoxPro record ${ci.foxRecno}`))) return
    setBusy('Saving…')
    try {
      const r = await window.api.invoiceSave(ci, toFox)
      setCi(normalizeInvoice(r.invoice, d))
      setDirty(false)
      setLastSave({ fox: r.fox, warnings: r.warnings })
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* ignore */
      }
      const failed = r.fox.includes('NOT in FoxPro')
      toast([`Saved ${r.invoice.invoiceNo}.`, r.fox, ...r.warnings].filter(Boolean).join('\n'), failed ? 'error' : r.warnings.length ? 'warn' : 'info')
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const showPreview = async () => {
    if (!ci) return
    setBusy('Making the PDF…')
    try {
      const r = await window.api.invoicePreview(ci)
      const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
      if (preview) URL.revokeObjectURL(preview.url)
      setPreview({ url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), pages: r.pages })
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const savePdf = async () => {
    if (!ci) return
    setBusy('Saving the PDF…')
    try {
      const p = await window.api.invoiceSavePdf(ci)
      if (p) toast(`PDF saved: ${p}`)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const saveXlsx = async () => {
    if (!ci) return
    setBusy('Saving the Excel file…')
    try {
      const p = await window.api.invoiceSaveXlsx(ci)
      if (p) toast(`Excel file saved: ${p}`)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const print = async () => {
    if (!ci) return
    setBusy('Opening for print…')
    try {
      await window.api.invoicePrint(ci)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  if (!ci || !settings) return <div className="empty">Loading…</div>

  const m = (k: FoxMainKey) => ci[k] as string
  const autoWords = amountInWords(sums.total, ci.currency)
  const writeOn = settings.writeFoxPro

  return (
    <>
      <div className="pagehead">
        <button className="back" title="Back to shipments" onClick={() => go('shipments')}>
          <Icon name="back" />
        </button>
        <div>
          <h1>{ci.invoiceNo ? `Commercial Invoice ${ci.invoiceNo}` : 'New Commercial Invoice'}</h1>
          <div className="sub">
            {ci.id ? 'Saved in the app' : 'Not saved yet'}
            {ci.foxRecno ? ` · FoxPro record ${ci.foxRecno}` : writeOn ? ' · not in FoxPro yet' : ''}
            {ci.piNo ? ` · from PI ${ci.piNo}` : ''}
            {dirty ? ' · unsaved changes' : ''}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => (dirty ? setConfirm({ kind: 'new' }) : go('invoice', { kind: 'new' }))}>
            <Icon name="plus" /> New
          </button>
          <button
            className="btn"
            disabled={!ci.id}
            title="A new invoice with the same details (no FoxPro link)"
            onClick={() => {
              setCi({ ...ci, id: null, invoiceNo: '', foxRecno: null, foxKey: null })
              setDirty(true)
              toast('Copied. Type the new commercial invoice no.')
            }}
          >
            <Icon name="copy" /> Duplicate
          </button>
          <button
            className="btn"
            disabled={!ci.id || dirty}
            title={ci.id ? (dirty ? 'Save the invoice first' : 'Make the packing / weight list for this invoice') : 'Save the invoice first'}
            onClick={() => ci.id && go('packing', { kind: 'packingFromInvoice', invoiceId: ci.id })}
          >
            <Icon name="box" /> Packing list
          </button>
          <button className="btn danger" disabled={!ci.id} onClick={async () => (await ensureAdmin(`delete the invoice ${ci.invoiceNo}`)) && setConfirm({ kind: 'delete' })}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      </div>

      <div className="editor">
        {/* ---- proforma ---- */}
        <div className="card">
          <div className="cardhead">
            <div>
              <div className="eyebrow">Step 1</div>
              <h2>Proforma invoice</h2>
            </div>
            <span className="hint">Type the PI number: customer, port of discharge and every item come from the Product Management App.</span>
          </div>
          <div className="pibox">
            <label className="f">
              Proforma invoice no
              <input className="big" value={piNo} onChange={(e) => setPiNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchPi()} placeholder="e.g. 61001/M/S" spellCheck={false} />
            </label>
            <button className="btn dark" onClick={fetchPi} disabled={!!busy}>
              <Icon name="fetch" /> Fetch details
            </button>
            <button className="btn" onClick={() => setBrowse(true)}>
              <Icon name="list" /> Browse proformas
            </button>
            {ci.piNo && (
              <div className="picard">
                <Icon name="link" />
                <span>
                  From PI <b>{ci.piNo}</b> · {ci.lines.length} items · US$ {fmtMoney(sums.total)}
                </span>
              </div>
            )}
          </div>
          {piChoices && (
            <div className="list mt">
              <div className="eyebrow">Several proformas have this number — pick one:</div>
              {piChoices.map((p) => (
                <div key={p.id} className="row" onClick={() => (ci.lines.length ? setConfirm({ kind: 'replace', id: p.id }) : applyFetched(p.id, ci))}>
                  <b>{p.invoiceNo}</b>
                  <span className="grow">{p.customerName}</span>
                  <span className="muted">{fmtDate(p.date)}</span>
                  <span className="badge">{p.lineCount} items</span>
                  <span className="badge soft">US$ {fmtMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- invoice & shipment ---- */}
        <div className="cols c2">
          <div className="card">
            <div className="cardhead">
              <div>
                <div className="eyebrow">Step 2</div>
                <h2>Invoice &amp; consignee</h2>
              </div>
            </div>
            <div className="cols c2">
              <label className="f">
                Commercial invoice no
                <input value={ci.invoiceNo} onChange={(e) => set('invoiceNo', e.target.value.toUpperCase())} placeholder="M/26/021" spellCheck={false} />
                {width('COM_INV_NO', ci.invoiceNo)}
              </label>
              <label className="f">
                Date
                <input type="date" value={ci.date} onChange={(e) => set('date', e.target.value)} />
              </label>
            </div>
            {!ci.foxRecno && foxMatch.length > 0 && (
              <div className="notice warn mt">
                <Icon name="database" />
                <span className="grow">
                  {ci.invoiceNo} is already in the FoxPro table (record {foxMatch[0].recno}
                  {foxMatch[0].customer ? `, ${foxMatch[0].customer}` : ''}
                  {foxMatch[0].date ? `, ${fmtDate(foxMatch[0].date)}` : ''}). Link this invoice to it so saving updates that record.
                </span>
                <button className="btn small dark" onClick={() => linkFoxRecord(foxMatch[0])}>
                  <Icon name="link" /> Use FoxPro record
                </button>
              </div>
            )}
            {ci.foxRecno && (
              <div className="notice ok mt">
                <Icon name="database" />
                <span className="grow">
                  Linked to FoxPro record {ci.foxRecno}
                  {ci.foxKey && ci.foxKey !== ci.invoiceNo.trim() ? ` (now ${ci.foxKey} there; saving changes it to ${ci.invoiceNo})` : ''}.
                </span>
                <button
                  className="btn small"
                  onClick={() => {
                    set('foxRecno', null)
                    set('foxKey', null)
                  }}
                >
                  Unlink
                </button>
              </div>
            )}
            <label className="f mt">
              Consignee / Notify (printed after “To : M/S.”)
              <textarea rows={6} value={ci.consignee} onChange={(e) => set('consignee', e.target.value)} placeholder={'RNA RESOURCES GROUP LIMITED\nOPERATING AS "LANDMARK"\n…'} />
            </label>
            <label className="f mt">
              ASN no
              <input value={ci.asnNo} onChange={(e) => set('asnNo', e.target.value)} placeholder="CI1HC2255799-NON-PTS" />
            </label>
          </div>

          <div className="card">
            <div className="cardhead">
              <div>
                <div className="eyebrow">Step 3</div>
                <h2>Shipment</h2>
              </div>
              <span className="hint">Typed by hand</span>
            </div>
            <div className="cols c2">
              <label className="f">
                Vessel
                <input value={m('vessel')} onChange={(e) => set('vessel', e.target.value.toUpperCase())} placeholder="SM MAHI" />
                {width('VASSEL', ci.vessel)}
              </label>
              <label className="f">
                Voyage
                <input value={ci.voyage} onChange={(e) => set('voyage', e.target.value.toUpperCase())} placeholder="054W" />
              </label>
              <label className="f">
                ETD
                <input type="date" value={ci.etd} onChange={(e) => set('etd', e.target.value)} />
              </label>
              <label className="f">
                ETA
                <input type="date" value={ci.eta} onChange={(e) => set('eta', e.target.value)} />
              </label>
              <label className="f">
                Container no
                <input value={ci.containerNo} onChange={(e) => set('containerNo', e.target.value.toUpperCase())} placeholder="MRKU0380028" />
                {width('CONT_NO', ci.containerNo)}
              </label>
              <label className="f">
                Container seal no
                <input value={ci.sealNo} onChange={(e) => set('sealNo', e.target.value.toUpperCase())} placeholder="ML-LK0395388" />
                {width('SEAL_NR', ci.sealNo)}
              </label>
              <label className="f span2">
                Payment terms
                <input value={ci.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="T/T" />
                {width('PAY_TERMS', ci.paymentTerms)}
              </label>
            </div>
          </div>
        </div>

        {/* ---- PI block ---- */}
        <div className="card">
          <div className="cardhead">
            <h2>Goods &amp; order</h2>
            <span className="hint">The block above the items on page 1</span>
          </div>
          <div className="cols c4">
            <label className="f">
              Goods
              <input value={ci.goodsTitle} onChange={(e) => set('goodsTitle', e.target.value)} />
            </label>
            <label className="f">
              PI no (printed)
              <input value={ci.piLabel} onChange={(e) => set('piLabel', e.target.value)} placeholder={ci.piNo || 'SM 46262 JW'} />
            </label>
            <label className="f">
              PO no
              <input value={ci.poNo} onChange={(e) => set('poNo', e.target.value)} placeholder="1568821" />
            </label>
            <label className="f">
              POD (port of discharge)
              <input value={ci.pod} onChange={(e) => set('pod', e.target.value.toUpperCase())} placeholder="JEBEL ALI" />
              {width('PORTDIS', ci.pod)}
            </label>
            <label className="f">
              Type
              <input value={ci.type} onChange={(e) => set('type', e.target.value)} />
            </label>
            <label className="f">
              Currency
              <input value={ci.currency} onChange={(e) => set('currency', e.target.value)} />
            </label>
            <label className="f">
              Incoterms
              <input value={ci.incoterms} onChange={(e) => set('incoterms', e.target.value)} />
            </label>
            <label className="f">
              Terms
              <input value={ci.terms} onChange={(e) => set('terms', e.target.value)} />
            </label>
          </div>
        </div>

        {/* ---- items ---- */}
        <div className="card">
          <div className="cardhead">
            <h2>Items shipped</h2>
            <span className="hint">From the proforma; change quantities to what was actually shipped. Total = qty × price unless typed over.</span>
            <div className="right">
              <button
                className="btn small"
                onClick={() => {
                  set('lines', [...ci.lines, blankLine(d)])
                }}
              >
                <Icon name="plus" /> Add line
              </button>
            </div>
          </div>
          <div className="tablewrap">
            <table className="lines">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th style={{ width: '11%' }}>Your item no</th>
                  <th style={{ width: '15%' }}>Our item no / factory</th>
                  <th>Description / packing</th>
                  <th style={{ width: '14%' }}>Colour / barcode</th>
                  <th style={{ width: 70 }}>H.S code</th>
                  <th style={{ width: 70 }} className="num">
                    Ctns
                  </th>
                  <th style={{ width: 120 }} className="num">
                    Qty / unit
                  </th>
                  <th style={{ width: 80 }} className="num">
                    Price
                  </th>
                  <th style={{ width: 96 }} className="num">
                    Total US$
                  </th>
                  <th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {ci.lines.map((l, i) => (
                  <tr key={l.id} className="linerow">
                    <td className="idx">{String(i + 1).padStart(2, '0')}</td>
                    <td>
                      <input value={l.yourItemNo} onChange={(e) => setLine(l.id, { yourItemNo: e.target.value })} />
                    </td>
                    <td>
                      <div className="stack">
                        <input value={l.ourItem} onChange={(e) => setLine(l.id, { ourItem: e.target.value.toUpperCase() })} />
                        <input value={l.factory} onChange={(e) => setLine(l.id, { factory: e.target.value })} placeholder="(AMP)" />
                      </div>
                    </td>
                    <td>
                      <div className="stack">
                        <textarea rows={2} value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} />
                        <input value={l.packing} onChange={(e) => setLine(l.id, { packing: e.target.value })} placeholder="2 pc/box,12 pcs/ctn." />
                      </div>
                    </td>
                    <td>
                      <div className="stack">
                        <input value={l.colour} onChange={(e) => setLine(l.id, { colour: e.target.value.toUpperCase() })} placeholder="PEACH-PN/40+B/251" />
                        <input value={l.barcode} onChange={(e) => setLine(l.id, { barcode: e.target.value })} placeholder="Barcode" />
                      </div>
                    </td>
                    <td>
                      <input value={l.hsCode} onChange={(e) => setLine(l.id, { hsCode: e.target.value })} />
                    </td>
                    <td className="num">
                      <div className="stack">
                        <input value={l.ctns} onChange={(e) => setLine(l.id, { ctns: e.target.value })} />
                        <input value={l.pcsCtn} onChange={(e) => setLine(l.id, { pcsCtn: e.target.value })} title="Pieces per carton (not printed): cartons = qty ÷ this" placeholder="pcs/ctn" />
                      </div>
                    </td>
                    <td className="num">
                      <div className="stack">
                        <input value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} />
                        <select value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value as CiLine['unit'] })}>
                          {CI_UNITS.map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="num">
                      <input value={l.price} onChange={(e) => setLine(l.id, { price: e.target.value })} />
                    </td>
                    <td className="num">
                      <input value={l.total} onChange={(e) => setLine(l.id, { total: e.target.value })} style={l.totalEdited ? { boxShadow: '0 0 0 1.5px var(--warn) inset' } : undefined} title={l.totalEdited ? 'Typed over (not qty × price)' : ''} />
                    </td>
                    <td>
                      <div className="tools">
                        <button className="roundbtn" title="Move up" onClick={() => moveLine(i, -1)}>
                          <Icon name="up" />
                        </button>
                        <button className="roundbtn" title="Move down" onClick={() => moveLine(i, 1)}>
                          <Icon name="down" />
                        </button>
                        <button className="roundbtn danger" title="Remove line" onClick={() => set('lines', ci.lines.filter((x) => x.id !== l.id))}>
                          <Icon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!ci.lines.length && <div className="empty">No items yet — fetch a proforma invoice above, or add lines by hand.</div>}
          </div>
          <div className="totalsbar">
            <div className="tbox">
              <span className="eyebrow">Cartons</span>
              <b>{totals.ctns}</b>
            </div>
            {totals.byUnit.map((u) => (
              <div className="tbox" key={u.unit}>
                <span className="eyebrow">Quantity ({u.unit})</span>
                <b>{u.qty.toLocaleString('en-US')}</b>
              </div>
            ))}
            <div className={sums.hasDiscount ? 'discbox on' : 'discbox'}>
              <span className="eyebrow">Discount (optional)</span>
              <div className="discrow">
                <input
                  value={ci.discount}
                  onChange={(e) => set('discount', e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  inputMode="decimal"
                  title={ci.discountType === 'percent' ? 'Percent of the items total' : 'Amount in US$'}
                />
                <div className="segmini">
                  <button className={ci.discountType === 'percent' ? 'on' : ''} onClick={() => set('discountType', 'percent')}>
                    %
                  </button>
                  <button className={ci.discountType === 'amount' ? 'on' : ''} onClick={() => set('discountType', 'amount')}>
                    US$
                  </button>
                </div>
                {ci.discount && (
                  <button className="roundbtn" title="Remove the discount" onClick={() => set('discount', '')}>
                    <Icon name="x" />
                  </button>
                )}
              </div>
              {sums.hasDiscount && (
                <input className="disclabel" value={ci.discountLabel} onChange={(e) => set('discountLabel', e.target.value)} placeholder={DEFAULT_DISCOUNT_LABEL} title="Printed before the discount amount" />
              )}
              {ci.discount && !sums.hasDiscount && <span className="fieldnote muted">No discount: the items total is 0.</span>}
            </div>
            {sums.hasDiscount && (
              <>
                <div className="tbox">
                  <span className="eyebrow">Subtotal US$</span>
                  <b>{fmtMoney(sums.subtotal)}</b>
                </div>
                <div className="tbox disc">
                  <span className="eyebrow">Discount{sums.percentText ? ` ${sums.percentText}` : ''}</span>
                  <b>− {fmtMoney(sums.discount)}</b>
                </div>
              </>
            )}
            <div className="tbox dark">
              <span className="eyebrow">{sums.hasDiscount ? 'Total after discount US$' : 'Total US$'}</span>
              <b>{fmtMoney(sums.total)}</b>
            </div>
          </div>
        </div>

        {/* ---- last page ---- */}
        <div className="cols c2">
          <div className="card">
            <div className="cardhead">
              <h2>Totals, marks &amp; reference</h2>
              <span className="hint">Printed after the items</span>
            </div>
            <label className="f">
              Label under the totals
              <input value={ci.totalsLabel} onChange={(e) => set('totalsLabel', e.target.value)} />
            </label>
            <label className="f mt">
              Say (amount in words) — leave blank for the automatic text
              <textarea rows={2} value={ci.amountWords} onChange={(e) => set('amountWords', e.target.value)} placeholder={autoWords} />
            </label>
            <label className="f mt">
              Shipping marks
              <textarea rows={3} value={ci.shippingMarks} onChange={(e) => set('shippingMarks', e.target.value)} placeholder="HCJW/46262 and Distribution as Per Purchase Order" />
            </label>
            <label className="f mt">
              Applicant&apos;s order reference
              <textarea rows={3} value={ci.orderReference} onChange={(e) => set('orderReference', e.target.value)} placeholder="JEBEL ALI : HCJW/46262 and Distribution as per Purchase Order" />
            </label>
          </div>
          <div className="card">
            <div className="cardhead">
              <h2>Certificate &amp; HS note</h2>
            </div>
            <label className="f">
              We hereby certify that — one statement per line (printed a), b), c) …)
              <textarea rows={5} value={ci.certify} onChange={(e) => set('certify', e.target.value)} />
            </label>
            <label className="f mt">
              HS code note
              <textarea rows={2} value={ci.hsNote} onChange={(e) => set('hsNote', e.target.value)} />
            </label>
          </div>
        </div>

        <div className="card">
          <div className="cardhead">
            <h2>Beneficiary &amp; bank</h2>
            <span className="hint">The defaults come from Settings; change them here for this invoice only.</span>
            <div className="right">
              <button
                className="btn small"
                onClick={() => {
                  set('beneficiary', d.beneficiary)
                  set('bank', d.bank)
                }}
              >
                <Icon name="undo" /> Use the defaults
              </button>
            </div>
          </div>
          <div className="cols c2">
            <label className="f">
              Beneficiary
              <textarea rows={7} value={ci.beneficiary} onChange={(e) => set('beneficiary', e.target.value)} />
            </label>
            <label className="f">
              Bank
              <textarea rows={7} value={ci.bank} onChange={(e) => set('bank', e.target.value)} />
            </label>
          </div>
        </div>

        <details className="card more">
          <summary>
            <span className="chev">
              <Icon name="chev" size={16} />
            </span>
            <h2>FoxPro details</h2>
            <span className="hint">Saved only in the FoxPro shipping table (not printed). Customer fields come from the proforma.</span>
          </summary>
          <div className="cols c4 mt">
            {(Object.keys(FOX_EXTRA_FIELDS) as (keyof FoxExtra)[]).map((k) => {
              const fname = FOX_EXTRA_FIELDS[k]
              const f = fields.get(fname)
              const isDate = f?.type === 'D'
              return (
                <label className="f" key={k}>
                  <span>
                    {LABELS[k]} <span className="muted" style={{ fontWeight: 400 }}>· {fname}{f && f.type === 'C' ? ` (${f.length})` : ''}</span>
                  </span>
                  <input type={isDate ? 'date' : 'text'} value={ci.fox[k]} onChange={(e) => setFox(k, e.target.value)} />
                  {width(fname, ci.fox[k])}
                </label>
              )
            })}
          </div>
        </details>
      </div>

      <div className="stickybar">
        <span className="grow">
          {busy ||
            (lastSave && !dirty
              ? [lastSave.fox || 'Saved.', ...lastSave.warnings].join('  ·  ')
              : `${ci.lines.length} items · ${totals.ctns} cartons · US$ ${fmtMoney(sums.total)}${sums.hasDiscount ? ` (after US$ ${fmtMoney(sums.discount)} discount)` : ''}${dirty ? ' · unsaved changes' : ''}`)}
        </span>
        {writeOn && (
          <label className="check" style={{ color: '#fff' }} title="Also create / update the record in the FoxPro shipping table">
            <input type="checkbox" checked={toFox} onChange={(e) => setToFox(e.target.checked)} /> also FoxPro
          </label>
        )}
        <button className="btn light" onClick={showPreview} disabled={!!busy}>
          <Icon name="eye" /> Preview
        </button>
        <button className="btn light" onClick={savePdf} disabled={!!busy}>
          <Icon name="download" /> Save PDF
        </button>
        <button className="btn light" onClick={saveXlsx} disabled={!!busy} title="Save as an Excel workbook">
          <Icon name="grid" /> Excel
        </button>
        <button className="btn light" onClick={print} disabled={!!busy}>
          <Icon name="printer" /> Print
        </button>
        <button className="btn lime" onClick={save} disabled={!!busy}>
          <Icon name="check" /> {writeOn && toFox ? 'Save to app + FoxPro' : 'Save'}
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
              <button className="btn" onClick={saveXlsx}>
                <Icon name="grid" /> Excel
              </button>
              <button className="btn dark" onClick={print}>
                <Icon name="printer" /> Print
              </button>
            </>
          }
        >
          <iframe className="pdfframe" src={preview.url} title="Invoice preview" />
        </Drawer>
      )}

      {browse && <ProformaBrowser onClose={() => setBrowse(false)} onPick={(p) => { setBrowse(false); setPiNo(p.invoiceNo); ci.lines.length ? setConfirm({ kind: 'replace', id: p.id }) : applyFetched(p.id, ci) }} />}

      {confirm?.kind === 'replace' && (
        <ConfirmDialog
          title="Replace the items?"
          text="This invoice already has items. Fetching the proforma replaces the items, the consignee and the customer. Everything else you typed (vessel, container, ASN, marks …) is kept."
          confirmLabel="Replace with the proforma"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await applyFetched(confirm.id, ci)
            setConfirm(null)
          }}
        />
      )}
      {confirm?.kind === 'new' && (
        <ConfirmDialog
          title="Start a new invoice?"
          text="This invoice has changes that are not saved. They will be lost."
          confirmLabel="Discard and start new"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            go('invoice', { kind: 'new' })
          }}
        />
      )}
      {confirm?.kind === 'delete' && ci.id && <DeleteInvoice ci={ci} onClose={() => setConfirm(null)} onDone={() => (setConfirm(null), go('shipments'))} />}
    </>
  )
}

export function DeleteInvoice({ ci, onClose, onDone }: { ci: Pick<CommercialInvoice, 'id' | 'invoiceNo' | 'foxRecno'>; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  return (
    <ConfirmDialog
      title={`Delete ${ci.invoiceNo}?`}
      text={`The invoice is removed from the app's database. The change log keeps a copy of it.${ci.foxRecno ? ` FoxPro record ${ci.foxRecno} is not touched — records in the FoxPro table are never deleted from this app.` : ''}`}
      confirmWord={ci.invoiceNo}
      confirmLabel="Delete"
      danger
      onClose={onClose}
      onConfirm={async () => {
        try {
          toast(await window.api.invoiceDelete(ci.id!))
          onDone()
        } catch (e) {
          toast(errorText(e), 'error')
        }
      }}
    />
  )
}

export function ProformaBrowser({ onClose, onPick }: { onClose: () => void; onPick: (p: ProformaSummary) => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ProformaSummary[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(
      () =>
        window.api
          .pmaList(q)
          .then(setRows)
          .catch((e) => {
            setRows([])
            toast(errorText(e), 'error')
          }),
      200
    )
  }, [q])
  return (
    <Drawer title="Proforma invoices" onClose={onClose}>
      <SearchBox value={q} onChange={setQ} placeholder="Search by PI number, customer or date" autoFocus />
      <div className="list mt">
        {rows === null && <div className="empty">Reading the Product Management App database…</div>}
        {rows?.length === 0 && <div className="empty">No proforma invoices found.</div>}
        {rows?.map((p) => (
          <div key={p.id} className="row" onClick={() => onPick(p)}>
            <div className="ic">
              <Icon name="file" />
            </div>
            <b style={{ minWidth: 110 }}>{p.invoiceNo || '(no number)'}</b>
            <span className="grow">{p.customerName}</span>
            <span className="muted">{fmtDate(p.date)}</span>
            <span className="badge">{p.lineCount} items</span>
            <span className="badge soft">US$ {fmtMoney(p.amount)}</span>
          </div>
        ))}
      </div>
    </Drawer>
  )
}

const LABELS: Record<keyof FoxExtra, string> = {
  cmbRefNo: 'CMB ref no', custCode: 'Customer code', custName: 'Customer name', street1: 'Street 1', street2: 'Street 2', city: 'City',
  country: 'Country', shipTerms: 'Ship terms', shipLine: 'Shipping line', contNo2: 'Container no 2', contSize: 'Container size',
  conType: 'Container type', conHeight: 'Container height', conLength: 'Container length', lcNo: 'LC no', lcExpDate: 'LC expiry date',
  billLading: 'Bill of lading date', bankCode: 'Bank code', creditTo: 'Credit to', creditAmt: 'Credit amount', commAmt: 'Commission',
  gstAmt: 'GST amount', invNoAmp: 'Invoice no AMP', courNo: 'Courier no', courDate: 'Courier date', portDel: 'Port of delivery',
  desGoods: 'Description of goods', remark: 'Remark'
}
