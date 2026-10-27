import { useEffect, useState } from 'react'
import type { ProformaSummary } from '@shared/proforma'
import type { PmaStatus } from '@shared/types'
import type { OpenRequest, Screen } from '../App'
import { Icon } from '../icons'
import { errorText, fmtDate, fmtMoney, fmtTime, SearchBox, useToast } from '../ui'

/** The proforma invoices in the Product Management App's database (read from a copy). */
export default function Proformas({ go }: { go: (s: Screen, r?: OpenRequest) => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ProformaSummary[] | null>(null)
  const [status, setStatus] = useState<PmaStatus | null>(null)
  const [error, setError] = useState('')

  const load = () =>
    window.api
      .pmaList(q)
      .then((r) => {
        setRows(r)
        setError('')
      })
      .catch((e) => {
        setRows([])
        setError(errorText(e))
      })
      .finally(() => window.api.pmaStatus(false).then(setStatus))

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [q])

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Proforma Invoices</h1>
          <div className="sub">
            From the Product Management App
            {status?.ok ? ` · ${status.proformas} proformas · read ${status.copiedAt ? fmtTime(status.copiedAt) : ''}` : ''}
          </div>
        </div>
        <div className="actions">
          <SearchBox value={q} onChange={setQ} placeholder="PI number, customer or date" />
          <button
            className="btn"
            onClick={async () => {
              setStatus(await window.api.pmaStatus(true))
              load()
              toast('Read the Product Management App database again.')
            }}
          >
            <Icon name="refresh" /> Refresh
          </button>
        </div>
      </div>
      {error && (
        <div className="notice danger" style={{ marginBottom: 14 }}>
          <Icon name="database" />
          <span className="grow">{error}</span>
          <button className="btn small" onClick={() => go('settings')}>
            Settings
          </button>
        </div>
      )}
      <div className="card">
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>PI number</th>
                <th>Date</th>
                <th>Customer</th>
                <th className="num">Items</th>
                <th className="num">Amount US$</th>
                <th>Saved</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows?.map((p) => (
                <tr key={p.id} className="click" onDoubleClick={() => go('invoice', { kind: 'pi', piId: p.id })}>
                  <td>
                    <b>{p.invoiceNo || '(no number)'}</b>
                  </td>
                  <td>{fmtDate(p.date)}</td>
                  <td className="wrap">{p.customerName}</td>
                  <td className="num">{p.lineCount}</td>
                  <td className="num">{fmtMoney(p.amount)}</td>
                  <td className="muted">{fmtTime(p.updatedAt)}</td>
                  <td className="acts">
                    <button className="btn small dark" onClick={() => go('invoice', { kind: 'pi', piId: p.id })}>
                      <Icon name="fetch" /> Make commercial invoice
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows === null && <div className="empty">Reading…</div>}
          {rows?.length === 0 && !error && <div className="empty">No proforma invoices found.</div>}
        </div>
      </div>
    </>
  )
}
