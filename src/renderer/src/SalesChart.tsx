import { useEffect, useMemo, useRef, useState } from 'react'
import type { SalePoint } from '@shared/types'

type Range = 'year' | 'month' | 'week'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY = 86400000

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

interface Period {
  label: string // "2026", "October", "This week"
  /** bucket index of an invoice date in this period, or -1 */
  bucket: (dateIso: string) => number
}

interface View {
  x: string[] // bucket labels
  /** labels shown in the tooltip */
  long: string[]
  cur: Period
  prev: Period
  /** buckets of the current period that have happened (the line stops there) */
  upTo: number
}

function view(range: Range, now = new Date()): View {
  const y = now.getFullYear()
  const m = now.getMonth()
  if (range === 'year') {
    const per = (yy: number): Period => ({ label: String(yy), bucket: (d) => (d.startsWith(`${yy}-`) ? Number(d.slice(5, 7)) - 1 : -1) })
    return { x: MONTHS, long: MONTHS.map((n) => n), cur: per(y), prev: per(y - 1), upTo: m }
  }
  if (range === 'month') {
    const pm = new Date(y, m - 1, 1)
    const days = Math.max(new Date(y, m + 1, 0).getDate(), new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate())
    const per = (yy: number, mm: number): Period => {
      const prefix = `${yy}-${String(mm + 1).padStart(2, '0')}-`
      return { label: new Date(yy, mm, 1).toLocaleString('en-US', { month: 'long' }), bucket: (d) => (d.startsWith(prefix) ? Number(d.slice(8, 10)) - 1 : -1) }
    }
    const x = Array.from({ length: days }, (_, i) => String(i + 1))
    return { x, long: x.map((d) => `Day ${d}`), cur: per(y, m), prev: per(pm.getFullYear(), pm.getMonth()), upTo: now.getDate() - 1 }
  }
  const monday = new Date(y, m, now.getDate() - ((now.getDay() + 6) % 7))
  const per = (start: Date, label: string): Period => {
    const keys = Array.from({ length: 7 }, (_, i) => iso(new Date(start.getTime() + i * DAY + 3600000)))
    return { label, bucket: (d) => keys.indexOf(d) }
  }
  return { x: DAYS, long: DAYS, cur: per(monday, 'This week'), prev: per(new Date(monday.getTime() - 7 * DAY), 'Last week'), upTo: (now.getDay() + 6) % 7 }
}

/** Monotone cubic path through the points: smooth, but never dips below zero or overshoots a peak. */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  const n = pts.length
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0])
  const s = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / dx[i])
  const t = pts.map((_, i) => (i === 0 ? s[0] : i === n - 1 ? s[n - 2] : s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i] / s[i]
    const b = t[i + 1] / s[i]
    const h = a * a + b * b
    if (h > 9) {
      const k = 3 / Math.sqrt(h)
      t[i] = k * a * s[i]
      t[i + 1] = k * b * s[i]
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`
  }
  return d
}

const short = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(Math.round(n))
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

/** A round step (1, 2 or 5 × 10ⁿ) so the axis has about four lines. */
function niceStep(max: number): number {
  if (max <= 0) return 1
  const raw = max / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

const running = (a: number[]) => {
  let t = 0
  return a.map((x) => (t += x))
}

/** Sales (invoice amounts) this year / month / week, against the one before, from the FoxPro table and the app. */
export function SalesChart() {
  const [data, setData] = useState<SalePoint[] | null>(null)
  const [range, setRange] = useState<Range>('year')
  const [hover, setHover] = useState<number | null>(null)
  const [w, setW] = useState(640)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.salesSeries().then(setData).catch(() => setData([]))
  }, [])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const v = useMemo(() => view(range), [range])
  const agg = useMemo(() => {
    const n = v.x.length
    const cur = Array(n).fill(0)
    const prev = Array(n).fill(0)
    const curN = Array(n).fill(0)
    const prevN = Array(n).fill(0)
    for (const p of data ?? []) {
      const a = v.cur.bucket(p.date)
      if (a >= 0 && a < n) {
        cur[a] += p.amount
        curN[a]++
        continue
      }
      const b = v.prev.bucket(p.date)
      if (b >= 0 && b < n) {
        prev[b] += p.amount
        prevN[b]++
      }
    }
    const upTo = Math.min(v.upTo, n - 1)
    const cumulative = range !== 'year'
    const curLine = cumulative ? running(cur) : cur
    const prevLine = cumulative ? running(prev) : prev
    const sum = (a: number[], to: number) => a.slice(0, to + 1).reduce((s, x) => s + x, 0)
    const revenue = sum(cur, upTo)
    const prevSame = sum(prev, upTo) // the previous period up to the same point, so the change is fair
    return { cur, prev, curLine, prevLine, cumulative, curN, prevN, upTo, revenue, count: sum(curN, upTo), change: prevSame > 0 ? ((revenue - prevSame) / prevSame) * 100 : null }
  }, [data, v, range])

  const H = 230
  const pad = { l: 44, r: 58, t: 14, b: 28 }
  const pw = w - pad.l - pad.r
  const ph = H - pad.t - pad.b
  const n = v.x.length
  const step = niceStep(Math.max(...agg.curLine.slice(0, agg.upTo + 1), ...agg.prevLine, 0))
  const max = Math.max(step, Math.ceil(Math.max(...agg.curLine.slice(0, agg.upTo + 1), ...agg.prevLine, 0) / step) * step)
  const X = (i: number) => pad.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw)
  const Y = (val: number) => pad.t + ph - (val / max) * ph
  const curPts = agg.curLine.slice(0, agg.upTo + 1).map((val, i) => [X(i), Y(val)] as [number, number])
  const prevPts = agg.prevLine.map((val, i) => [X(i), Y(val)] as [number, number])
  const curPath = smooth(curPts)
  const area = curPts.length > 1 ? `${curPath} L${curPts[curPts.length - 1][0]},${Y(0)} L${curPts[0][0]},${Y(0)} Z` : ''
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const every = n > 20 ? 5 : 1
  const showMarkers = n <= 12
  const empty = data !== null && agg.cur.every((x) => !x) && agg.prev.every((x) => !x)

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  const last = curPts[curPts.length - 1]
  const tip = hover !== null ? { i: hover, x: X(hover) } : null
  const vsLabel = range === 'year' ? v.prev.label : range === 'month' ? v.prev.label : 'last week'

  return (
    <div className="sales">
      <div className="sales-head">
        <div className="big">
          <b>{agg.count.toLocaleString('en-US')}</b>
          <span>Invoices</span>
        </div>
        <div className="big">
          <b>
            <small>US$</small>
            {money(agg.revenue)}
          </b>
          <span>
            Sales
            {agg.change !== null && (
              <em className={agg.change >= 0 ? 'up' : 'down'}>
                {agg.change >= 0 ? '↑' : '↓'} {Math.abs(agg.change).toFixed(0)}% vs {vsLabel}
              </em>
            )}
          </span>
        </div>
        <div className="seg" role="tablist">
          {(['year', 'month', 'week'] as Range[]).map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => (setRange(r), setHover(null))}>
              {r[0].toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="sales-legend">
        <span>
          <i className="ln cur" /> {v.cur.label}
        </span>
        <span>
          <i className="ln prev" /> {v.prev.label}
        </span>
        <span className="note">{agg.cumulative ? 'Running total of sales (US$)' : 'Sales per month (US$)'}</span>
      </div>
      <div className="sales-plot" ref={box}>
        {data === null && <div className="sales-msg">Reading the invoices…</div>}
        {empty && <div className="sales-msg">No invoices with a date in this period or the one before.</div>}
        <svg width={w} height={H} role="img" aria-label={`Sales by ${range === 'year' ? 'month' : 'day'}, ${v.cur.label} against ${v.prev.label}`}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--purple)" stopOpacity=".18" />
              <stop offset="100%" stopColor="var(--purple)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + pw} y1={Y(t)} y2={Y(t)} className="grid" />
              <text x={pad.l - 8} y={Y(t) + 3.5} className="ytick">
                {short(t)}
              </text>
            </g>
          ))}
          {v.x.map((lbl, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={i} x={X(i)} y={H - 8} className={i === agg.upTo ? 'xtick now' : 'xtick'}>
                {lbl}
              </text>
            ) : null
          )}
          <path d={smooth(prevPts)} className="prev" />
          {area && <path d={area} fill="url(#salesFill)" />}
          <path d={curPath} className="cur" />
          {showMarkers && curPts.slice(0, -1).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} className="mk" />)}
          {last && <circle cx={last[0]} cy={last[1]} r={5} className="mk end" />}
          {last && (
            <g transform={`translate(${pad.l + pw + 10},${Math.min(Math.max(last[1], pad.t + 8), pad.t + ph - 8)})`}>
              <rect x={0} y={-9} width={42} height={18} rx={9} className="tag cur" />
              <text x={21} y={3.5} className="tagt cur">
                {v.cur.label.length > 5 ? v.cur.label.slice(0, 3) : v.cur.label}
              </text>
            </g>
          )}
          {prevPts.length > 0 && (
            <g transform={`translate(${pad.l + pw + 10},${Math.min(Math.max(prevPts[n - 1][1], pad.t + 8), pad.t + ph - 8) + (last && Math.abs(prevPts[n - 1][1] - last[1]) < 20 ? 20 : 0)})`}>
              <rect x={0} y={-9} width={42} height={18} rx={9} className="tag prev" />
              <text x={21} y={3.5} className="tagt">
                {v.prev.label.length > 5 ? v.prev.label.slice(0, 3) : v.prev.label}
              </text>
            </g>
          )}
          {tip && (
            <g>
              <line x1={tip.x} x2={tip.x} y1={pad.t} y2={pad.t + ph} className="cross" />
              {tip.i <= agg.upTo && <circle cx={tip.x} cy={Y(agg.curLine[tip.i])} r={5} className="mk end" />}
              <circle cx={tip.x} cy={Y(agg.prevLine[tip.i])} r={4} className="mk prevmk" />
            </g>
          )}
          <rect x={pad.l} y={pad.t} width={pw} height={ph} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {tip && (
          <div className="sales-tip" style={{ left: Math.min(Math.max(tip.x, 90), w - 90) }}>
            <b>
              {v.long[tip.i]}
              {agg.cumulative ? ' · so far' : ''}
            </b>
            <div>
              <i className="ln cur" /> {v.cur.label}
              <span>{tip.i <= agg.upTo ? `US$ ${money(agg.curLine[tip.i])}` : '—'}</span>
            </div>
            <div>
              <i className="ln prev" /> {v.prev.label}
              <span>US$ {money(agg.prevLine[tip.i])}</span>
            </div>
            <div className="sub">
              Invoices that {range === 'year' ? 'month' : 'day'}: {tip.i <= agg.upTo ? agg.curN[tip.i] : '–'} / {agg.prevN[tip.i]}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
