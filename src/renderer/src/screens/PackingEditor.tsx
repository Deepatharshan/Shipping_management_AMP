import { useCallback, useEffect, useMemo, useState } from 'react'
import { CI_UNITS, DEFAULT_CI, newInvoice } from '@shared/invoice'
import {
  autoCbm, blankPlLine, newPackingList, normalizePackingList, numberCartons, packingFromInvoice, packingFromProforma, packingTotals,
  type PackingList, type PlLine
} from '@shared/packing'
import { invoiceFromProforma, normInvoiceNo, type ProformaSummary } from '@shared/proforma'
import type { InvoiceSummary, Settings } from '@shared/types'
import type { OpenRequest, Screen } from '../App'
import { Icon } from '../icons'
import { ConfirmDialog, Drawer, errorText, fmtDate, useAdmin, useToast } from '../ui'
import { ProformaBrowser } from './InvoiceEditor'

const DRAFT_KEY = 'shp.packing.draft.v1'

function loadDraft(s: Settings): PackingList {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw) return normalizePackingList(JSON.parse(raw), s.defaults)
  } catch {
    /* ignore */
  }
  return newPackingList(s.defaults)
}

const kg = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The packing / weight list editor: items from a proforma or a saved invoice, weights and carton sizes by hand. */
export default function PackingEditor({ request, onHandled, go }: { request: OpenRequest; onHandled: () => void; go: (s: Screen, r?: OpenRequest) => void }) {
  const toast = useToast()
  const ensureAdmin = useAdmin()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [pl, setPl] = useState<PackingList | null>(null)
  const [dirty, setDirty] = useState(false)
  const [piNo, setPiNo] = useState('')
  const [piChoices, setPiChoices] = useState<ProformaSummary[] | null>(null)
  const [browse, setBrowse] = useState(false)
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([])
  const [preview, setPreview] = useState<{ url: string; pages: number } | null>(null)
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState<null | { kind: 'delete' } | { kind: 'new' } | { kind: 'replacePi'; id: string }>(null)
  const d = settings?.defaults ?? DEFAULT_CI

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s)
      setPl((cur) => cur ?? loadDraft(s))
    })
    window.api.invoiceList('').then(setInvoices).catch(() => undefined)
  }, [])

  // keep an unsaved new list on this PC so nothing is lost when switching screens
  useEffect(() => {
    if (!pl || pl.id) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(pl))
    } catch {
      /* ignore */
    }
  }, [pl])

  const fromInvoice = useCallback(
    async (invoiceId: string, base: PackingList) => {
      const ci = await window.api.invoiceGet(invoiceId)
      if (!ci) return toast('That commercial invoice is no longer saved in the app.', 'error')
      // a packing list for this invoice may already be saved: open it instead of starting a second one
      if (!base.id) {
        const saved = (await window.api.packingList(ci.invoiceNo)).find((p) => normInvoiceNo(p.invoiceNo) === normInvoiceNo(ci.invoiceNo))
        if (saved) {
          const existing = await window.api.packingGet(saved.id)
          if (existing) {
            setPl(existing)
            setPiNo(existing.piNo)
            setDirty(false)
            return toast(`The packing list for ${ci.invoiceNo} is already saved — opened it.`)
          }
        }
      }
      const next = packingFromInvoice(ci, base)
      setPl(next)
      setPiNo(next.piNo)
      setDirty(true)
      toast(`Filled from commercial invoice ${ci.invoiceNo}: ${next.lines.length} items. Type the weights and carton sizes.`)
    },
    [toast]
  )

  const fromProforma = useCallback(
    async (id: string, base: PackingList) => {
      const pf = await window.api.pmaGet(id)
      if (!pf) return toast('That proforma invoice is no longer in the Product Management App.', 'error')
      const next = packingFromProforma(invoiceFromProforma(pf, d, newInvoice(d)), base)
      setPl(next)
      setPiNo(next.piNo)
      setPiChoices(null)
      setDirty(true)
      toast(`Fetched PI ${next.piNo}: ${next.lines.length} item${next.lines.length === 1 ? '' : 's'}.`)
    },
    [d, toast]
  )

  // requests from other screens
  useEffect(() => {
    if (!request || !settings) return
    if (request.kind === 'packingNew') {
      setPl(newPackingList(settings.defaults))
      setPiNo('')
      setDirty(false)
    } else if (request.kind === 'packing') {
      setPl(normalizePackingList(request.packing, settings.defaults))
      setPiNo(request.packing.piNo)
      setDirty(false)
    } else if (request.kind === 'packingFromInvoice') {
      void fromInvoice(request.invoiceId, newPackingList(settings.defaults))
    }
    onHandled()
  }, [request, settings])

  // saved invoices made from the same PI (offered after fetching a proforma)
  const samePi = useMemo(
    () => (pl?.piNo && !pl.invoiceId ? invoices.filter((i) => i.piNo && normInvoiceNo(i.piNo) === normInvoiceNo(pl.piNo)) : []),
    [pl?.piNo, pl?.invoiceId, invoices]
  )
  // the typed invoice no matches a saved invoice
  const typedMatch = useMemo(
    () => (pl?.invoiceNo.trim() ? invoices.find((i) => normInvoiceNo(i.invoiceNo) === normInvoiceNo(pl.invoiceNo)) ?? null : null),
    [pl?.invoiceNo, invoices]
  )

  const set = <K extends keyof PackingList>(k: K, v: PackingList[K]) => {
    setPl((c) => (c ? { ...c, [k]: v } : c))
    setDirty(true)
  }
  const setLine = (id: string, patch: Partial<PlLine>) => {
    setPl((c) => {
      if (!c) return c
      return {
        ...c,
        lines: c.lines.map((l) => {
          if (l.id !== id) return l
          const n = { ...l, ...patch }
          if ('cbm' in patch) n.cbmEdited = patch.cbm !== '' && patch.cbm !== autoCbm(n)
          return n
        })
      }
    })
    setDirty(true)
  }
  const moveLine = (i: number, by: number) =>
    setPl((c) => {
      if (!c) return c
      const lines = [...c.lines]
      const j = i + by
      if (j < 0 || j >= lines.length) return c
      ;[lines[i], lines[j]] = [lines[j], lines[i]]
      setDirty(true)
      return { ...c, lines }
    })

  const totals = useMemo(() => packingTotals(pl?.lines ?? []), [pl?.lines])

  const fetchPi = async () => {
    if (!pl) return
    const no = piNo.trim()
    if (!no) return toast('Type the proforma invoice number.', 'warn')
    setBusy('Fetching…')
    try {
      const found = await window.api.pmaFind(no)
      if (!found.length) toast(`No proforma invoice ${no} in the Product Management App. Check the number, or browse the list.`, 'warn')
      else if (found.length > 1) setPiChoices(found)
      else if (pl.lines.length && pl.piId !== found[0].id) setConfirm({ kind: 'replacePi', id: found[0].id })
      else await fromProforma(found[0].id, pl)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const save = async () => {
    if (!pl) return
    if (!pl.invoiceNo.trim()) return toast('Type or pick the commercial invoice no first.', 'warn')
    if (pl.id && !(await ensureAdmin(`save changes to the saved packing list ${pl.invoiceNo}`))) return
    setBusy('Saving…')
    try {
      const saved = await window.api.packingSave(pl)
      setPl(normalizePackingList(saved, d))
      setDirty(false)
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* ignore */
      }
      toast(`Saved the packing list for ${saved.invoiceNo}.`)
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
      const r = await window.api.packingPreview(pl!)
      const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
      if (preview) URL.revokeObjectURL(preview.url)
      setPreview({ url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), pages: r.pages })
    })
  const savePdf = () =>
    run('Saving the PDF…', async () => {
      const p = await window.api.packingSavePdf(pl!)
      if (p) toast(`PDF saved: ${p}`)
    })
  const saveXlsx = () =>
    run('Saving the Excel file…', async () => {
      const p = await window.api.packingSaveXlsx(pl!)
      if (p) toast(`Excel file saved: ${p}`)
    })
  const print = () => run('Opening for print…', () => window.api.packingPrint(pl!))

  if (!pl || !settings) return <div className="empty">Loading…</div>

  return (
    <>
      <div className="pagehead">
        <button className="back" title="All packing lists" onClick={() => go('packinglists')}>
          <Icon name="back" />
        </button>
        <div>
          <h1>{pl.invoiceNo ? `Packing / Weight List ${pl.invoiceNo}` : 'New Packing / Weight List'}</h1>
          <div className="sub">
            {pl.id ? 'Saved in the app — changes need edit access' : 'Not saved yet'}
            {pl.piNo ? ` · from PI ${pl.piNo}` : ''}
            {pl.invoiceId ? ' · linked to the saved invoice' : ''}
            {dirty ? ' · unsaved changes' : ''}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => go('packinglists')}>
            <Icon name="list" /> All packing lists
          </button>
          <button className="btn" onClick={() => (dirty ? setConfirm({ kind: 'new' }) : go('packing', { kind: 'packingNew' }))}>
            <Icon name="plus" /> New
          </button>
          <button className="btn danger" disabled={!pl.id} onClick={async () => (await ensureAdmin(`delete the packing list ${pl.invoiceNo}`)) && setConfirm({ kind: 'delete' })}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      </div>

      <div className="editor">
        {/* ---- where the items come from ---- */}
        <div className="cols c2">
          <div className="card">
            <div className="cardhead">
              <div>
                <div className="eyebrow">Step 1</div>
                <h2>Proforma invoice</h2>
              </div>
              <span className="hint">Items, customer and port come from the Product Management App.</span>
            </div>
            <div className="pibox">
              <label className="f">
                Proforma invoice no
                <input className="big" value={piNo} onChange={(e) => setPiNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchPi()} placeholder="e.g. SM 46262 JW" spellCheck={false} />
              </label>
              <button className="btn dark" onClick={fetchPi} disabled={!!busy}>
                <Icon name="fetch" /> Fetch
              </button>
              <button className="btn" onClick={() => setBrowse(true)}>
                <Icon name="list" /> Browse
              </button>
            </div>
            {piChoices && (
              <div className="list mt">
                <div className="eyebrow">Several proformas have this number — pick one:</div>
                {piChoices.map((p) => (
                  <div key={p.id} className="row" onClick={() => (pl.lines.length ? setConfirm({ kind: 'replacePi', id: p.id }) : fromProforma(p.id, pl))}>
                    <b>{p.invoiceNo}</b>
                    <span className="grow">{p.customerName}</span>
                    <span className="muted">{fmtDate(p.date)}</span>
                    <span className="badge">{p.lineCount} items</span>
                  </div>
                ))}
              </div>
            )}
            {samePi.length > 0 && (
              <div className="notice ok mt">
                <Icon name="file" />
                <span className="grow">
                  Commercial invoice <b>{samePi[0].invoiceNo}</b> was made from this PI. Use it for the invoice no, vessel, container, cartons and units.
                </span>
                <button className="btn small dark" onClick={() => fromInvoice(samePi[0].id, pl)}>
                  <Icon name="link" /> Use {samePi[0].invoiceNo}
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="cardhead">
              <div>
                <div className="eyebrow">Step 2</div>
                <h2>Commercial invoice</h2>
              </div>
              <span className="hint">Pick a saved invoice to fill everything, or type the number.</span>
            </div>
            <div className="cols c2">
              <label className="f">
                Commercial invoice no
                <input
                  list="pl-invoices"
                  value={pl.invoiceNo}
                  spellCheck={false}
                  placeholder="M/23/002"
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase()
                    set('invoiceNo', v)
                    // picked from the list (not typed): fill from that invoice at once
                    const picked = (e.nativeEvent as InputEvent).inputType === undefined || (e.nativeEvent as InputEvent).inputType === 'insertReplacementText'
                    const hit = invoices.find((i) => normInvoiceNo(i.invoiceNo) === normInvoiceNo(v))
                    if (picked && hit && hit.id !== pl.invoiceId) void fromInvoice(hit.id, { ...pl, invoiceNo: v })
                  }}
                />
                <datalist id="pl-invoices">
                  {invoices.map((i) => (
                    <option key={i.id} value={i.invoiceNo}>
                      {[i.customer, i.vessel, fmtDate(i.date)].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </datalist>
              </label>
              <label className="f">
                Date
                <input type="date" value={pl.date} onChange={(e) => set('date', e.target.value)} />
              </label>
            </div>
            {typedMatch && typedMatch.id !== pl.invoiceId && (
              <div className="notice mt">
                <Icon name="file" />
                <span className="grow">
                  {typedMatch.invoiceNo} is a saved invoice ({typedMatch.customer || 'no customer'}{typedMatch.vessel ? `, ${typedMatch.vessel}` : ''}).
                </span>
                <button className="btn small dark" onClick={() => fromInvoice(typedMatch.id, pl)}>
                  <Icon name="fetch" /> Fill from it
                </button>
              </div>
            )}
            {pl.invoiceId && (
              <div className="notice ok mt">
                <Icon name="link" />
                <span className="grow">Filled from the saved invoice. Everything below can still be changed.</span>
                <button className="btn small" onClick={() => fromInvoice(pl.invoiceId!, pl)} title="Fetch the invoice again; weights and sizes you typed are kept">
                  <Icon name="refresh" /> Fetch again
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ---- consignee & shipment ---- */}
        <div className="cols c2">
          <div className="card">
            <div className="cardhead">
              <h2>Consignee &amp; shipping marks</h2>
            </div>
            <label className="f">
              Consignee / Notify (printed after “To : M/S.”)
              <textarea rows={6} value={pl.consignee} onChange={(e) => set('consignee', e.target.value)} placeholder={'RNA RESOURCES GROUP LIMITED\nOPERATING AS "LANDMARK"\n…'} />
            </label>
            <label className="f mt">
              Shipping marks
              <textarea rows={3} value={pl.shippingMarks} onChange={(e) => set('shippingMarks', e.target.value)} placeholder="HCJW/46262 and Distribution as per Purchase Order" />
            </label>
            <label className="f mt">
              ASN no
              <input value={pl.asnNo} onChange={(e) => set('asnNo', e.target.value)} placeholder="CI1HC2255799-NON-PTS" />
            </label>
          </div>
          <div className="card">
            <div className="cardhead">
              <h2>Shipment</h2>
              <span className="hint">{pl.invoiceId ? 'From the invoice — change if needed' : 'Typed by hand'}</span>
            </div>
            <div className="cols c2">
              <label className="f">
                Vessel
                <input value={pl.vessel} onChange={(e) => set('vessel', e.target.value.toUpperCase())} placeholder="SM MAHI" />
              </label>
              <label className="f">
                Voyage
                <input value={pl.voyage} onChange={(e) => set('voyage', e.target.value.toUpperCase())} placeholder="054W" />
              </label>
              <label className="f">
                ETD
                <input type="date" value={pl.etd} onChange={(e) => set('etd', e.target.value)} />
              </label>
              <label className="f">
                ETA
                <input type="date" value={pl.eta} onChange={(e) => set('eta', e.target.value)} />
              </label>
              <label className="f">
                Container no
                <input value={pl.containerNo} onChange={(e) => set('containerNo', e.target.value.toUpperCase())} placeholder="MRKU0380028" />
              </label>
              <label className="f">
                Container seal no
                <input value={pl.sealNo} onChange={(e) => set('sealNo', e.target.value.toUpperCase())} placeholder="ML-LK0395388" />
              </label>
              <label className="f span2">
                Payment terms
                <input value={pl.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="T/T" />
              </label>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="cardhead">
            <h2>Goods &amp; order</h2>
            <span className="hint">The block above the items</span>
          </div>
          <div className="cols c4">
            <label className="f">
              Goods
              <input value={pl.goodsTitle} onChange={(e) => set('goodsTitle', e.target.value)} />
            </label>
            <label className="f">
              PI no (printed)
              <input value={pl.piLabel} onChange={(e) => set('piLabel', e.target.value)} placeholder={pl.piNo || 'SM 46262 JW'} />
            </label>
            <label className="f">
              PO no
              <input value={pl.poNo} onChange={(e) => set('poNo', e.target.value)} placeholder="1568821" />
            </label>
            <label className="f">
              POD
              <input value={pl.pod} onChange={(e) => set('pod', e.target.value.toUpperCase())} placeholder="JEBEL ALI" />
            </label>
            <label className="f">
              Type
              <input value={pl.type} onChange={(e) => set('type', e.target.value)} />
            </label>
            <label className="f">
              Currency
              <input value={pl.currency} onChange={(e) => set('currency', e.target.value)} />
            </label>
            <label className="f">
              Amount
              <input value={pl.amount} onChange={(e) => set('amount', e.target.value)} placeholder="32301.12" />
            </label>
            <label className="f">
              Incoterms
              <input value={pl.incoterms} onChange={(e) => set('incoterms', e.target.value)} />
            </label>
            <label className="f span2">
              Terms
              <input value={pl.terms} onChange={(e) => set('terms', e.target.value)} />
            </label>
          </div>
        </div>

        {/* ---- items ---- */}
        <div className="card">
          <div className="cardhead">
            <h2>Cartons, weights &amp; sizes</h2>
            <span className="hint">CBM = length × width × height (cm) ÷ 1,000,000 × cartons. Nett / gross are kg per carton.</span>
            <div className="right">
              <button className="btn small" title="Carton numbers one after the other: 001-136, 137-261 …" disabled={!pl.lines.length} onClick={() => set('lines', numberCartons(pl.lines))}>
                <Icon name="list" /> Number cartons
              </button>
              <button className="btn small" onClick={() => set('lines', [...pl.lines, blankPlLine()])}>
                <Icon name="plus" /> Add line
              </button>
            </div>
          </div>
          <div className="tablewrap">
            <table className="lines pltable">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th style={{ width: '15%' }}>Item no / colour</th>
                  <th style={{ width: '10%' }}>Customer item</th>
                  <th style={{ width: 84 }}>Ctn no</th>
                  <th style={{ width: 64 }}>Packing</th>
                  <th style={{ width: 62 }} className="num">Ctns</th>
                  <th style={{ width: 92 }} className="num">Units</th>
                  <th style={{ width: 66 }} className="num">Nett/ctn</th>
                  <th style={{ width: 66 }} className="num">Gross/ctn</th>
                  <th style={{ width: 196 }}>Measurements L × W × H cm</th>
                  <th style={{ width: 80 }} className="num">CBM</th>
                  <th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {pl.lines.map((l, i) => {
                  const auto = autoCbm(l)
                  const per = (Number(l.length) * Number(l.width) * Number(l.height)) / 1e6
                  return (
                    <tr key={l.id} className="linerow">
                      <td className="idx">{String(i + 1).padStart(2, '0')}</td>
                      <td>
                        <div className="stack">
                          <input value={l.itemNo} onChange={(e) => setLine(l.id, { itemNo: e.target.value.toUpperCase() })} placeholder="Y39AZPE44/E035" />
                          <input value={l.colour} onChange={(e) => setLine(l.id, { colour: e.target.value.toUpperCase() })} placeholder="PEACH" />
                        </div>
                      </td>
                      <td>
                        <input value={l.customerItemNo} onChange={(e) => setLine(l.id, { customerItemNo: e.target.value })} />
                      </td>
                      <td>
                        <input value={l.ctnNo} onChange={(e) => setLine(l.id, { ctnNo: e.target.value })} placeholder="001-136" />
                      </td>
                      <td>
                        <input value={l.packing} onChange={(e) => setLine(l.id, { packing: e.target.value })} placeholder="2/ 12" />
                      </td>
                      <td className="num">
                        <input value={l.ctns} onChange={(e) => setLine(l.id, { ctns: e.target.value })} />
                      </td>
                      <td className="num">
                        <div className="stack">
                          <input value={l.units} onChange={(e) => setLine(l.id, { units: e.target.value })} />
                          <select value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value as PlLine['unit'] })}>
                            {CI_UNITS.map((u) => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="num">
                        <input value={l.nettCtn} onChange={(e) => setLine(l.id, { nettCtn: e.target.value })} placeholder="kg" />
                      </td>
                      <td className="num">
                        <input value={l.grossCtn} onChange={(e) => setLine(l.id, { grossCtn: e.target.value })} placeholder="kg" />
                      </td>
                      <td>
                        <div className="dims">
                          <input value={l.length} onChange={(e) => setLine(l.id, { length: e.target.value })} placeholder="L" />
                          <span>×</span>
                          <input value={l.width} onChange={(e) => setLine(l.id, { width: e.target.value })} placeholder="W" />
                          <span>×</span>
                          <input value={l.height} onChange={(e) => setLine(l.id, { height: e.target.value })} placeholder="H" />
                        </div>
                      </td>
                      <td className="num">
                        <input
                          value={l.cbmEdited ? l.cbm : auto}
                          onChange={(e) => setLine(l.id, { cbm: e.target.value })}
                          style={l.cbmEdited ? { boxShadow: '0 0 0 1.5px var(--warn) inset' } : undefined}
                          title={l.cbmEdited ? `Typed over (worked out: ${auto || '—'}). Clear it to use the worked-out value.` : 'Worked out from the size and cartons'}
                        />
                        {per > 0 && <small className="calc">{per.toFixed(4)} × {l.ctns || 0}</small>}
                      </td>
                      <td>
                        <div className="tools">
                          <button className="roundbtn" title="Move up" onClick={() => moveLine(i, -1)}>
                            <Icon name="up" />
                          </button>
                          <button className="roundbtn" title="Move down" onClick={() => moveLine(i, 1)}>
                            <Icon name="down" />
                          </button>
                          <button className="roundbtn danger" title="Remove line" onClick={() => set('lines', pl.lines.filter((x) => x.id !== l.id))}>
                            <Icon name="trash" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!pl.lines.length && <div className="empty">No items yet — fetch a proforma or pick a saved commercial invoice above, or add lines by hand.</div>}
          </div>
          <div className="totalsbar">
            <div className="tbox">
              <span className="eyebrow">Cartons</span>
              <b>{totals.ctns}</b>
            </div>
            {totals.byUnit.map((u) => (
              <div className="tbox" key={u.unit}>
                <span className="eyebrow">Units ({u.unit})</span>
                <b>{u.qty.toLocaleString('en-US')}</b>
              </div>
            ))}
            <div className="tbox">
              <span className="eyebrow">Total CBM</span>
              <b>{totals.cbm.toFixed(2)}</b>
            </div>
            <div className="tbox">
              <span className="eyebrow">Nett weight kg</span>
              <b>{kg(totals.nett)}</b>
            </div>
            <div className="tbox">
              <span className="eyebrow">Gross weight kg</span>
              <b>{kg(totals.gross)}</b>
            </div>
            <div className="tbox dark">
              <span className="eyebrow">Difference kg</span>
              <b>{kg(totals.difference)}</b>
            </div>
          </div>
        </div>
      </div>

      <div className="stickybar">
        <span className="grow">
          {busy || `${pl.lines.length} items · ${totals.ctns} cartons · ${totals.cbm.toFixed(2)} CBM · gross ${kg(totals.gross)} kg${dirty ? ' · unsaved changes' : ''}`}
        </span>
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
          <Icon name={pl.id ? 'lock' : 'check'} /> {pl.id ? 'Save changes' : 'Save'}
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
          <iframe className="pdfframe" src={preview.url} title="Packing list preview" />
        </Drawer>
      )}

      {browse && (
        <ProformaBrowser
          onClose={() => setBrowse(false)}
          onPick={(p) => {
            setBrowse(false)
            setPiNo(p.invoiceNo)
            if (pl.lines.length && pl.piId !== p.id) setConfirm({ kind: 'replacePi', id: p.id })
            else void fromProforma(p.id, pl)
          }}
        />
      )}

      {confirm?.kind === 'replacePi' && (
        <ConfirmDialog
          title="Replace the items?"
          text="This packing list already has items. The items are replaced by the proforma's; weights, sizes and carton numbers you typed are kept for the same items."
          confirmLabel="Replace with the proforma"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await fromProforma(confirm.id, pl)
            setConfirm(null)
          }}
        />
      )}
      {confirm?.kind === 'new' && (
        <ConfirmDialog
          title="Start a new packing list?"
          text="This packing list has changes that are not saved. They will be lost."
          confirmLabel="Discard and start new"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            try {
              localStorage.removeItem(DRAFT_KEY)
            } catch {
              /* ignore */
            }
            go('packing', { kind: 'packingNew' })
          }}
        />
      )}
      {confirm?.kind === 'delete' && pl.id && (
        <DeletePacking
          id={pl.id}
          invoiceNo={pl.invoiceNo}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null)
            go('packinglists')
          }}
        />
      )}
    </>
  )
}

export function DeletePacking({ id, invoiceNo, onClose, onDone }: { id: string; invoiceNo: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  return (
    <ConfirmDialog
      title={`Delete the packing list for ${invoiceNo}?`}
      text="The packing list is removed from the app's database. The change log keeps a copy of it. The commercial invoice is not touched."
      confirmWord={invoiceNo}
      confirmLabel="Delete"
      danger
      onClose={onClose}
      onConfirm={async () => {
        try {
          toast(await window.api.packingDelete(id))
          onDone()
        } catch (e) {
          toast(errorText(e), 'error')
        }
      }}
    />
  )
}

