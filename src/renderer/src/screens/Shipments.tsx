import { useEffect, useState } from 'react'
import type { InvoiceSummary } from '@shared/types'
import type { OpenRequest, Screen } from '../App'
import { Icon } from '../icons'
import { errorText, fmtDate, fmtMoney, SearchBox, useToast } from '../ui'
import { DeleteInvoice } from './InvoiceEditor'

export default function Shipments({ go }: { go: (s: Screen, r?: OpenRequest) => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<InvoiceSummary[]>([])
  const [del, setDel] = useState<InvoiceSummary | null>(null)
  const [writeOn, setWriteOn] = useState(false)
  const load = () => window.api.invoiceList(q).then(setRows).catch((e) => toast(errorText(e), 'error'))
  useEffect(() => {
    const t = setTimeout(load, 150)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    window.api.getSettings().then((s) => setWriteOn(s.writeFoxPro))
  }, [])
  const open = async (id: string) => {
    const ci = await window.api.invoiceGet(id)
    if (ci) go('invoice', { kind: 'invoice', invoice: ci })
  }
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0)
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Shipments</h1>
          <div className="sub">Every commercial invoice saved in the app. Double-click to open.</div>
        </div>
        <div className="actions">
          <SearchBox value={q} onChange={setQ} placeholder="Invoice no, PI, customer, vessel, container, item…" />
          <button className="btn dark" onClick={() => go('invoice', { kind: 'new' })}>
            <Icon name="plus" /> New invoice
          </button>
        </div>
      </div>
      <div className="card">
        <div className="cardhead">
          <h2>{rows.length} invoice{rows.length === 1 ? '' : 's'}</h2>
          <span className="hint">US$ {fmtMoney(total)}</span>
        </div>
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>Invoice no</th>
                <th>Date</th>
                <th>PI no</th>
                <th>Customer</th>
                <th>Vessel</th>
                <th>Container</th>
                <th>ETD → ETA</th>
                <th className="num">Items</th>
                <th className="num">Amount US$</th>
                <th>FoxPro</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="click" onDoubleClick={() => open(r.id)}>
                  <td>
                    <b>{r.invoiceNo}</b>
                  </td>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.piNo}</td>
                  <td className="wrap">{r.customer}</td>
                  <td>{r.vessel}</td>
                  <td className="mono">{r.containerNo}</td>
                  <td>
                    {fmtDate(r.etd)} {r.eta ? `→ ${fmtDate(r.eta)}` : ''}
                  </td>
                  <td className="num">{r.lineCount}</td>
                  <td className="num">{fmtMoney(r.amount)}</td>
                  <td>{r.foxRecno ? <span className="badge ok">rec {r.foxRecno}</span> : <span className="badge">app only</span>}</td>
                  <td className="acts">
                    <button className="roundbtn" title="Open" onClick={() => open(r.id)}>
                      <Icon name="edit" />
                    </button>
                    <button
                      className="roundbtn"
                      title="Print"
                      onClick={async () => {
                        const ci = await window.api.invoiceGet(r.id)
                        if (ci) window.api.invoicePrint(ci).catch((e) => toast(errorText(e), 'error'))
                      }}
                    >
                      <Icon name="printer" />
                    </button>
                    {r.pdfPath && (
                      <button className="roundbtn" title={`Open the saved PDF: ${r.pdfPath}`} onClick={() => window.api.openPath(r.pdfPath!).catch((e) => toast(errorText(e), 'error'))}>
                        <Icon name="download" />
                      </button>
                    )}
                    <button className="roundbtn danger" title="Delete" onClick={() => setDel(r)}>
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">{q ? 'Nothing matches the search.' : 'No invoices yet.'}</div>}
        </div>
      </div>
      {del && <DeleteInvoice ci={del} writeOn={writeOn} onClose={() => setDel(null)} onDone={() => (setDel(null), load())} />}
    </>
  )
}
