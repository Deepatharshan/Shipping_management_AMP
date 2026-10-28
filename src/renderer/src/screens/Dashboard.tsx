import { useEffect, useState } from 'react'
import type { InvoiceSummary, Stats } from '@shared/types'
import type { CommercialInvoice } from '@shared/invoice'
import { invoiceSums, invoiceTotals, todayIso } from '@shared/invoice'
import type { OpenRequest, Screen } from '../App'
import { Icon } from '../icons'
import { MiniContainer } from '../Truck'
import { TrailerCalendar } from '../TrailerCalendar'
import { SalesChart } from '../SalesChart'
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

      {/* 1. key numbers */}
      <div className="card kpicard">
        <div className="kpis">
          <div className="kpi">
            <div className="label">Invoices in {monthLabel}</div>
            <div className="value">{stats?.thisMonth ?? '–'}</div>
            <div className="foot">{stats ? `${stats.invoices.toLocaleString('en-US')} in total` : '\u00a0'}</div>
          </div>
          <div className="kpi">
            <div className="label">Value in {monthLabel}</div>
            <div className="value">
              <span className="cur">US$</span>
              {stats ? fmtMoney(stats.amountThisMonth) : '–'}
            </div>
            <div className="foot">{stats ? `US$ ${fmtMoney(stats.amountTotal)} in total` : '\u00a0'}</div>
          </div>
          <div className="kpi">
            <div className="label">FoxPro records</div>
            <div className="value">{stats ? stats.foxRecords.toLocaleString('en-US') : '–'}</div>
            <div className="foot">{stats ? `${stats.inFoxPro.toLocaleString('en-US')} linked to the app` : '\u00a0'}</div>
          </div>
          <div className="kpi">
            <div className="label">Proformas available</div>
            <div className="value">{stats ? stats.proformas.toLocaleString('en-US') : '–'}</div>
            <div className="foot" title="in the Product Management App">
              in the Product Management App
            </div>
          </div>
        </div>
        {!recent.length && (
          <div className="notice mt">
            <Icon name="box" />
            <span className="grow">No commercial invoices yet. Start one from a proforma invoice: type its number and the items, customer and port fill in.</span>
          </div>
        )}
      </div>

      {/* 2. sales and the shipping calendar */}
      <div className="dgrid">
        <div className="card">
          <SalesChart />
        </div>
        <div className="card calcard">
          <TrailerCalendar compact rows={stats?.upcoming ?? []} onOpen={(id) => window.api.invoiceGet(id).then((ci) => ci && go('invoice', { kind: 'invoice', invoice: ci }))} />
        </div>
      </div>

      {/* 3. recent shipments */}
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

      {/* 4. sailing schedule and the selected shipment's load */}
      <div className="dgrid">
        <Schedule rows={stats?.upcoming ?? []} onOpen={(id) => window.api.invoiceGet(id).then((ci) => ci && go('invoice', { kind: 'invoice', invoice: ci }))} />
        <div className="card floating">
          <div className="cardhead">
            <div>
              <div className="eyebrow">{selInv?.piNo ? `PI ${selInv.piNo}` : 'Container load'}</div>
              <h2>Load Planning</h2>
            </div>
            <div className="right">
              <button className="roundbtn" title="Print" disabled={!selInv} onClick={() => selInv && window.api.invoicePrint(selInv).catch((e) => toast(errorText(e), 'error'))}>
                <Icon name="printer" />
              </button>
              <button className="roundbtn" title="Open in the editor" disabled={!selInv} onClick={() => selInv && go('invoice', { kind: 'invoice', invoice: selInv })}>
                <Icon name="edit" />
              </button>
            </div>
          </div>
          {selInv && (
            <div className="loadsum">
              <div>
                <span>Invoice</span>
                <b>{selInv.invoiceNo}</b>
              </div>
              <div>
                <span>Cartons</span>
                <b>{t?.ctns ?? 0}</b>
              </div>
              <div>
                <span>Amount US$</span>
                <b>{fmtMoney(invoiceSums(selInv).total)}</b>
              </div>
              <div className="wide">
                <span>Vessel · container</span>
                <b>
                  {selInv.vessel || 'no vessel yet'} · {selInv.containerNo || '–'}
                </b>
              </div>
            </div>
          )}
          <div className="list loadlist">
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
            {!selInv && (
              <div className="emptystate">
                <div className="ico">
                  <Icon name="box" size={20} />
                </div>
                <b>No shipment selected</b>
                <span>Pick an invoice card above to see what is in its container, or start a new one.</span>
                <button className="btn small dark" onClick={() => go('invoice', { kind: 'new' })}>
                  <Icon name="plus" /> New commercial invoice
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
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
