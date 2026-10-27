import { useMemo, useState } from 'react'
import type { InvoiceSummary } from '@shared/types'
import { todayIso } from '@shared/invoice'
import { Icon } from './icons'

type Mark = { id: string; invoiceNo: string; kind: 'ETD' | 'ETA' }

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** A month calendar drawn inside a box trailer. Each day shows the shipments that sail (ETD) or arrive (ETA) on it. */
export function TrailerCalendar({ rows, onOpen }: { rows: InvoiceSummary[]; onOpen: (id: string) => void }) {
  const today = todayIso()
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const [sel, setSel] = useState(today)

  const marks = useMemo(() => {
    const map = new Map<string, Mark[]>()
    const add = (day: string, mk: Mark) => {
      if (!day) return
      map.set(day, [...(map.get(day) ?? []), mk])
    }
    for (const r of rows) {
      add(r.etd, { id: r.id, invoiceNo: r.invoiceNo, kind: 'ETD' })
      add(r.eta, { id: r.id, invoiceNo: r.invoiceNo, kind: 'ETA' })
    }
    return map
  }, [rows])

  // Weeks start on Monday; show only the weeks this month touches.
  const first = new Date(month.y, month.m, 1)
  const lead = (first.getDay() + 6) % 7
  const daysIn = new Date(month.y, month.m + 1, 0).getDate()
  const weeks = Math.ceil((lead + daysIn) / 7)
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(month.y, month.m, i - lead + 1)
    return { key: iso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), out: d.getMonth() !== month.m }
  })

  const shift = (n: number) => setMonth(({ y, m }) => {
    const d = new Date(y, m + n, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const goToday = () => {
    const d = new Date()
    setMonth({ y: d.getFullYear(), m: d.getMonth() })
    setSel(today)
  }

  const selMarks = marks.get(sel) ?? []
  const label = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const selLabel = new Date(sel + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="tcal">
      <div className="tcal-head">
        <div>
          <div className="eyebrow">Shipping calendar</div>
          <b>{label}</b>
        </div>
        <div className="legend">
          <span><i className="dot etd" /> ETD</span>
          <span><i className="dot eta" /> ETA</span>
        </div>
        <button className="chipbtn" onClick={goToday}>Today</button>
      </div>

      <div className="trailer">
        <div className="tbody">
          <button className="tnav l" onClick={() => shift(-1)} title="Previous month">
            <Icon name="back" />
          </button>
          <div className="tgrid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
              <div key={w} className="wd">{w}</div>
            ))}
            {cells.map((c) => {
              const ms = marks.get(c.key) ?? []
              const cls = ['tc', c.out && 'out', c.key === today && 'today', c.key === sel && 'sel'].filter(Boolean).join(' ')
              return (
                <div key={c.key} className={cls} onClick={() => setSel(c.key)} onDoubleClick={() => ms[0] && onOpen(ms[0].id)} title={ms.map((m) => `${m.kind} ${m.invoiceNo}`).join('\n')}>
                  <span className="dn">{c.day}</span>
                  {ms.length > 0 && (
                    <span className="mk">
                      {ms.slice(0, 2).map((m, i) => (
                        <i key={i} className={m.kind === 'ETD' ? 'dot etd' : 'dot eta'} />
                      ))}
                      <small>{ms.length === 1 ? ms[0].invoiceNo : `${ms.length} shipments`}</small>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <button className="tnav r" onClick={() => shift(1)} title="Next month">
            <Icon name="back" />
          </button>
        </div>
        <div className="chassis">
          <div className="rail" />
          <svg className="leg" viewBox="0 0 40 44" aria-hidden="true">
            <rect x="8" y="0" width="5" height="38" rx="1" fill="#9aa0a8" />
            <rect x="26" y="0" width="5" height="38" rx="1" fill="#9aa0a8" />
            <path d="M10 6 L29 30 M29 6 L10 30" stroke="#b6bbc2" strokeWidth="2" />
            <rect x="3" y="37" width="15" height="4" rx="1.5" fill="#6d737b" />
            <rect x="21" y="37" width="15" height="4" rx="1.5" fill="#6d737b" />
          </svg>
          <svg className="bogie" viewBox="0 0 150 52" aria-hidden="true">
            <path d="M6 22 Q6 4 38 4 Q70 4 72 22 Z M78 22 Q80 4 112 4 Q144 4 144 22 Z" fill="#d7dade" />
            {[38, 112].map((x) => (
              <g key={x}>
                <circle cx={x} cy="28" r="22" fill="#1b1d21" />
                <circle cx={x} cy="28" r="13" fill="#cfd3d8" />
                <circle cx={x} cy="28" r="9" fill="#a6acb4" />
                <circle cx={x} cy="28" r="4" fill="#5d636b" />
                {Array.from({ length: 6 }, (_, i) => {
                  const a = (i * Math.PI) / 3
                  return <circle key={i} cx={x + Math.cos(a) * 7} cy={28 + Math.sin(a) * 7} r="1.2" fill="#e8eaed" />
                })}
              </g>
            ))}
          </svg>
          <div className="bumper" />
          <div className="ground" />
        </div>
      </div>

      <div className="tcal-day">
        <span className="muted">{selLabel}</span>
        {selMarks.length === 0 && <span className="muted">· no sailings or arrivals</span>}
        {selMarks.map((m, i) => (
          <button key={i} className="chipbtn" onClick={() => onOpen(m.id)}>
            <i className={m.kind === 'ETD' ? 'dot etd' : 'dot eta'} /> {m.kind} · {m.invoiceNo}
          </button>
        ))}
      </div>
    </div>
  )
}
