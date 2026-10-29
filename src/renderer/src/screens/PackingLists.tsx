import { useEffect, useState } from 'react'
import type { PackingSummary } from '@shared/packing'
import type { OpenRequest, Screen } from '../App'
import { Icon } from '../icons'
import { errorText, fmtDate, SearchBox, useAdmin, useToast } from '../ui'
import { DeletePacking } from './PackingEditor'

const kg = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Every saved packing / weight list. */
export default function PackingLists({ go }: { go: (s: Screen, r?: OpenRequest) => void }) {
  const toast = useToast()
  const ensureAdmin = useAdmin()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<PackingSummary[]>([])
  const [del, setDel] = useState<PackingSummary | null>(null)
  const load = () => window.api.packingList(q).then(setRows).catch((e) => toast(errorText(e), 'error'))
  useEffect(() => {
    const t = setTimeout(load, 150)
    return () => clearTimeout(t)
  }, [q])
  const open = async (id: string) => {
    const pl = await window.api.packingGet(id)
    if (pl) go('packing', { kind: 'packing', packing: pl })
  }
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Packing Lists</h1>
          <div className="sub">Every packing / weight list saved in the app. Double-click to open; changing or deleting one needs edit access.</div>
        </div>
        <div className="actions">
          <SearchBox value={q} onChange={setQ} placeholder="Invoice no, PI, customer, vessel, container, item…" />
          <button className="btn dark" onClick={() => go('packing', { kind: 'packingNew' })}>
            <Icon name="plus" /> New packing list
          </button>
        </div>
      </div>
      <div className="card">
        <div className="cardhead">
          <h2>
            {rows.length} packing list{rows.length === 1 ? '' : 's'}
          </h2>
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
                <th className="num">Cartons</th>
                <th className="num">Nett kg</th>
                <th className="num">Gross kg</th>
                <th className="num">CBM</th>
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
                  <td className="num">{r.ctns}</td>
                  <td className="num">{kg(r.nett)}</td>
                  <td className="num">{kg(r.gross)}</td>
                  <td className="num">{r.cbm.toFixed(2)}</td>
                  <td className="acts">
                    <button className="roundbtn" title="Open" onClick={() => open(r.id)}>
                      <Icon name="edit" />
                    </button>
                    <button
                      className="roundbtn"
                      title="Print"
                      onClick={async () => {
                        const pl = await window.api.packingGet(r.id)
                        if (pl) window.api.packingPrint(pl).catch((e) => toast(errorText(e), 'error'))
                      }}
                    >
                      <Icon name="printer" />
                    </button>
                    <button className="roundbtn danger" title="Delete (admin)" onClick={async () => (await ensureAdmin(`delete the packing list ${r.invoiceNo}`)) && setDel(r)}>
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">{q ? 'Nothing matches the search.' : 'No packing lists yet. Open a saved invoice and click “Packing list”, or start a new one.'}</div>}
        </div>
      </div>
      {del && <DeletePacking id={del.id} invoiceNo={del.invoiceNo} onClose={() => setDel(null)} onDone={() => (setDel(null), load())} />}
    </>
  )
}
