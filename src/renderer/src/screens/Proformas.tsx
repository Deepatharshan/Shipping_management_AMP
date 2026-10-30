import { useEffect, useState } from 'react'
import type { ProformaSummary } from '@shared/proforma'
import type { PmaStatus } from '@shared/types'
import type { OpenRequest, Screen } from '../App'
import { Icon } from '../icons'
import { Drawer, errorText, fmtDate, fmtMoney, fmtTime, SearchBox, useToast } from '../ui'

/** The proforma invoices in the Product Management App's database (read from a copy). */
export default function Proformas({ go }: { go: (s: Screen, r?: OpenRequest) => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ProformaSummary[] | null>(null)
  const [status, setStatus] = useState<PmaStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; no: string; url: string; pages: number } | null>(null)

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    try {
      await fn()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(null)
    }
  }
  const showPreview = (p: ProformaSummary) =>
    run(p.id, async () => {
      const r = await window.api.pmaPreview(p.id)
      const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
      if (preview) URL.revokeObjectURL(preview.url)
      setPreview({ id: p.id, no: p.invoiceNo, url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), pages: r.pages })
    })
  const download = (id: string) =>
    run(id, async () => {
      const f = await window.api.pmaSavePdf(id)
      if (f) toast(`PDF saved: ${f}`)
    })
  const saveXlsx = (id: string) =>
    run(id, async () => {
      const f = await window.api.pmaSaveXlsx(id)
      if (f) toast(`Excel file saved: ${f}`)
    })
  const print = (id: string) => run(id, () => window.api.pmaPrint(id))

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
                    <button className="roundbtn" title="Preview the proforma invoice" disabled={busy === p.id} onClick={() => showPreview(p)}>
                      <Icon name="eye" />
                    </button>
                    <button className="roundbtn" title="Download as PDF" disabled={busy === p.id} onClick={() => download(p.id)}>
                      <Icon name="download" />
                    </button>
                    <button className="roundbtn" title="Save as an Excel workbook" disabled={busy === p.id} onClick={() => saveXlsx(p.id)}>
                      <Icon name="grid" />
                    </button>
                    <button className="roundbtn" title="Print" disabled={busy === p.id} onClick={() => print(p.id)}>
                      <Icon name="printer" />
                    </button>
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
      {preview && (
        <Drawer
          wide
          title={`Proforma ${preview.no} · ${preview.pages} page${preview.pages === 1 ? '' : 's'}`}
          onClose={() => {
            URL.revokeObjectURL(preview.url)
            setPreview(null)
          }}
          actions={
            <>
              <button className="btn" onClick={() => download(preview.id)}>
                <Icon name="download" /> Download PDF
              </button>
              <button className="btn" onClick={() => saveXlsx(preview.id)}>
                <Icon name="grid" /> Excel
              </button>
              <button className="btn dark" onClick={() => print(preview.id)}>
                <Icon name="printer" /> Print
              </button>
            </>
          }
        >
          <iframe className="pdfframe" src={preview.url} title="Proforma preview" />
        </Drawer>
      )}
    </>
  )
}
