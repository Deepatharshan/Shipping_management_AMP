import { useEffect, useState } from 'react'
import type { InvoiceSummary, Stats } from '@shared/types'
import type { CommercialInvoice } from '@shared/invoice'
import { invoiceTotals, todayIso } from '@shared/invoice'
import type { OpenRequest, Screen } from '../App'
import { Icon } from '../icons'
import { MiniContainer } from '../Truck'
import { TrailerCalendar } from '../TrailerCalendar'
import { errorText, fmtDate, fmtMoney, useToast } from '../ui'

export default function Dashboard({ go }: { go: (s: Screen, r?: OpenRequest) => void }) {
  const toast = useToast()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recent, setRecent] = useState<InvoiceSummary[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [selInv, setSelInv] = useState<CommercialInvoice | null>(null)

  useEffect(() => {
    window.api.stats().then(setStats).catch((e) => toast(errorText(e), 'error'))
    window.api.invoiceList('').then((r) => {
      setRecent(r)
      if (r[0]) setSel(r[0].id)
    })
  }, [])

  useEffect(() => {
    if (!sel) return setSelInv(null)
    window.api.invoiceGet(sel).then(setSelInv)
  }, [sel])

  const t = selInv ? invoiceTotals(selInv.lines) : null
  const monthLabel = new Date().toLocaleString('en-US', { month: 'long' })

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Shipments Overview</h1>
          <div className="sub">Commercial invoices made from proforma invoices, kept in the app and in the FoxPro shipping table.</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => go('proformas')}>
            <Icon name="box" /> Pick a proforma
          </button>
          <button className="btn dark" onClick={() => go('invoice', { kind: 'new' })}>
            <Icon name="plus" /> New commercial invoice
          </button>
        </div>
      </div>

      <div className="hero">
        <div className="card stage">
          <div className="kpis">
            <div className="kpi">
              <div className="label">Invoices in {monthLabel}</div>
              <div className="value">
                {stats?.thisMonth ?? '–'} <span className="badge lime">{stats ? `${stats.invoices} total` : ''}</span>
              </div>
            </div>
            <div className="kpi">
              <div className="label">Value in {monthLabel} (US$)</div>
              <div className="value">{stats ? fmtMoney(stats.amountThisMonth) : '–'}</div>
            </div>
            <div className="kpi">
              <div className="label">FoxPro records</div>
              <div className="value">
                {stats ? stats.foxRecords.toLocaleString('en-US') : '–'} <span className="badge soft">{stats ? `${stats.inFoxPro} linked` : ''}</span>
              </div>
            </div>
            <div className="kpi">
              <div className="label">Proformas available</div>
              <div className="value">{stats ? stats.proformas.toLocaleString('en-US') : '–'}</div>
            </div>
          </div>
          {selInv && (
            <div className="row wrap" style={{ marginTop: 28, gap: 18, fontSize: 12.5 }}>
              <span className="muted">Selected</span>
              <b>{selInv.invoiceNo}</b>
              <span>{selInv.vessel || 'no vessel yet'}</span>
              <span className="muted">Container</span> <span>{selInv.containerNo || '–'}</span>
              <span className="muted">Cartons</span> <b>{t?.ctns ?? 0}</b>
              <span className="muted">Amount</span> <b>US$ {fmtMoney(t?.amount ?? 0)}</b>
            </div>
          )}
          {!recent.length && (
            <div className="notice mt">
              <Icon name="box" />
              <span className="grow">No commercial invoices yet. Start one from a proforma invoice: type its number and the items, customer and port fill in.</span>
            </div>
          )}
          <TrailerCalendar rows={stats?.upcoming ?? []} onOpen={(id) => window.api.invoiceGet(id).then((ci) => ci && go('invoice', { kind: 'invoice', invoice: ci }))} />
        </div>

        <div className="card floating">
          <div className="cardhead">
            <div>
              <div className="eyebrow">{selInv?.piNo ? `PI ${selInv.piNo}` : 'Container load'}</div>
              <h2>Load Planning</h2>
            </div>
            <div className="right">
              <button className="roundbtn" title="Open in the editor" disabled={!selInv} onClick={() => selInv && go('invoice', { kind: 'invoice', invoice: selInv })}>
                <Icon name="edit" />
              </button>
            </div>
          </div>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            <button className="chipbtn" disabled={!selInv} onClick={() => selInv && window.api.invoicePrint(selInv).catch((e) => toast(errorText(e), 'error'))}>
              <Icon name="printer" size={13} /> Print
            </button>
            <button className="chipbtn" onClick={() => go('invoice', { kind: 'new' })}>
              <Icon name="plus" size={13} /> Create New Invoice
            </button>
          </div>
          <div className="list" style={{ maxHeight: 300, overflow: 'auto' }}>
            {(selInv?.lines ?? []).map((l, i) => (
              <div key={l.id} className="row">
                <div className="ic">
                  <Icon name="box" />
                </div>
                <span style={{ width: 22 }} className="muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="grow">
                  <b>{l.ourItem || '—'}</b> <span className="muted">{l.colour}</span>
                </span>
                <span className="badge">{l.ctns || '–'} ctns</span>
              </div>
            ))}
            {selInv && !selInv.lines.length && <div className="empty">No items on this invoice yet.</div>}
            {!selInv && <div className="empty">Select a shipment below.</div>}
          </div>
        </div>
      </div>

      <div className="shipcards">
        {recent.slice(0, 5).map((r) => (
          <div key={r.id} className={sel === r.id ? 'shipcard sel' : 'shipcard'} onClick={() => setSel(r.id)} onDoubleClick={() => window.api.invoiceGet(r.id).then((ci) => ci && go('invoice', { kind: 'invoice', invoice: ci }))}>
            <span className="eyebrow">Invoice number</span>
            <b>{r.invoiceNo}</b>
            <MiniContainer />
            <div className="meta">
              {r.customer || '—'} · US$ {fmtMoney(r.amount)}
            </div>
          </div>
        ))}
        {Array.from({ length: Math.max(0, 5 - recent.length) }, (_, i) => (
          <div key={`e${i}`} className="shipcard" style={{ opacity: 0.55 }} onClick={() => go('invoice', { kind: 'new' })}>
            <span className="eyebrow">Invoice number</span>
            <b className="muted">—</b>
            <MiniContainer />
            <div className="meta">New invoice</div>
          </div>
        ))}
      </div>

      <Schedule rows={stats?.upcoming ?? []} onOpen={(id) => window.api.invoiceGet(id).then((ci) => ci && go('invoice', { kind: 'invoice', invoice: ci }))} />
    </>
  )
}

const DAY = 86400000
const isoToMs = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN
}

/** ETD → ETA bars over four weeks around today (the Gantt chart). */
function Schedule({ rows, onOpen }: { rows: InvoiceSummary[]; onOpen: (id: string) => void }) {
  const [offset, setOffset] = useState(0) // weeks
  const today = isoToMs(todayIso())
  const start = today - 7 * DAY + offset * 7 * DAY
  const days = 28
  const end = start + days * DAY
  const weeks = Array.from({ length: 4 }, (_, i) => start + i * 7 * DAY)
  const shown = rows.filter((r) => !Number.isNaN(isoToMs(r.etd)) || !Number.isNaN(isoToMs(r.eta)))
  const pct = (ms: number) => ((ms - start) / (end - start)) * 100
  return (
    <div className="card gantt">
      <div className="cardhead">
        <h2>Sailing Schedule</h2>
        <span className="hint">ETD → ETA of each shipment</span>
        <div className="right">
          <button className="roundbtn" onClick={() => setOffset((o) => o - 1)} title="Earlier">
            <Icon name="back" />
          </button>
          <button className="chipbtn" onClick={() => setOffset(0)}>
            Today
          </button>
          <button className="roundbtn" onClick={() => setOffset((o) => o + 1)} title="Later" style={{ transform: 'scaleX(-1)' }}>
            <Icon name="back" />
          </button>
        </div>
      </div>
      <div className="scale" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {weeks.map((w) => (
          <div key={w}>
            <b>{new Date(w).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b>
            {new Date(w).toLocaleDateString('en-GB', { weekday: 'short' })} – {new Date(w + 6 * DAY).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
          </div>
        ))}
      </div>
      <div className="grow" style={{ ['--day' as string]: `${100 / days}%` }}>
        {shown.length === 0 && <div className="empty">Shipments with an ETD or ETA show here.</div>}
        {shown.map((r) => {
          const a = isoToMs(r.etd)
          const b = isoToMs(r.eta)
          const from = Number.isNaN(a) ? b - DAY : a
          const to = Number.isNaN(b) ? a + DAY : b
          const left = Math.max(0, pct(from))
          const right = Math.min(100, pct(to + DAY))
          const visible = right > 0 && left < 100 && right > left
          return (
            <div key={r.id} className="grow-row">
              <div className="who">
                {r.invoiceNo}
                <small>{r.vessel || r.customer || '—'}</small>
              </div>
              <div className="track" style={{ ['--day' as string]: `calc(100% / ${days})` }}>
                {visible && (
                  <div
                    className={to < today ? 'bar done' : 'bar'}
                    style={{ left: `${left}%`, width: `${right - left}%` }}
                    title={`${r.invoiceNo}: ETD ${fmtDate(r.etd)} → ETA ${fmtDate(r.eta)}`}
                    onClick={() => onOpen(r.id)}
                  >
                    <span>{r.vessel || r.invoiceNo}</span>
                    <span style={{ opacity: 0.85 }}>{r.containerNo}</span>
                  </div>
                )}
                {today >= start && today <= end && <div className="now" style={{ left: `${pct(today + DAY / 2)}%` }} />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
