import { useEffect, useState } from 'react'
import type { FoxPage, FoxRecord, FoxRow, FoxStatus } from '@shared/types'
import { FIELD_LABELS, KEY_FIELD, WRITTEN_FIELDS } from '@shared/foxMap'
import type { OpenRequest, Screen } from '../App'
import { Icon } from '../icons'
import { ConfirmDialog, Drawer, errorText, fmtDate, fmtMoney, SearchBox, Switch, useAdmin, useToast } from '../ui'

const PAGE = 40

/** Browse and edit records of the FoxPro shipping table (the old database). Editing needs the admin; records are never deleted. */
export default function FoxRecords({ go }: { go: (s: Screen, r?: OpenRequest) => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [showDeleted, setShowDeleted] = useState(false)
  const [data, setData] = useState<FoxPage | null>(null)
  const [status, setStatus] = useState<FoxStatus | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = () =>
    window.api
      .foxList(q, page, PAGE, showDeleted)
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => setError(errorText(e)))

  useEffect(() => {
    window.api.foxStatus().then(setStatus)
  }, [])
  useEffect(() => {
    const t = setTimeout(load, 150)
    return () => clearTimeout(t)
  }, [q, page, showDeleted])
  useEffect(() => setPage(0), [q, showDeleted])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>FoxPro Records</h1>
          <div className="sub">
            {status?.configured ? (
              <>
                {status.path} · {status.records.toLocaleString('en-US')} records ({status.deleted} deleted) · last change {status.lastUpdate ? fmtDate(status.lastUpdate) : '–'} ·{' '}
                {status.writeOn ? <span className="badge purple">writing on</span> : <span className="badge">read-only</span>}
              </>
            ) : (
              'The shipping table is not linked yet.'
            )}
          </div>
        </div>
        <div className="actions">
          <SearchBox value={q} onChange={setQ} placeholder="Invoice no, customer, vessel, container, record no…" />
          <Switch checked={showDeleted} onChange={setShowDeleted} label="Show deleted" />
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
      {status?.indexes.some((i) => !i.matches) && (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          <Icon name="shield" />
          <span className="grow">An index file does not match the table, so the app will not write to FoxPro until it is rebuilt (Settings).</span>
        </div>
      )}
      <div className="card">
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th className="num">Rec</th>
                <th>Invoice no</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Country</th>
                <th>Vessel</th>
                <th>Container</th>
                <th>ETD → ETA</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r) => (
                <tr key={r.recno} className={r.deleted ? 'click deleted' : 'click'} onClick={() => setOpen(r.recno)}>
                  <td className="num muted">{r.recno}</td>
                  <td>
                    <b>{r.invoiceNo}</b> {r.appId && <span className="badge soft">in app</span>}
                  </td>
                  <td>{fmtDate(r.date)}</td>
                  <td className="wrap">{r.customer}</td>
                  <td>{r.country}</td>
                  <td>{r.vessel}</td>
                  <td className="mono">{r.containerNo}</td>
                  <td>
                    {fmtDate(r.etd)}
                    {r.eta ? ` → ${fmtDate(r.eta)}` : ''}
                  </td>
                  <td className="num">{fmtMoney(r.amount)}</td>
                  <td className="acts">{r.deleted ? <span className="badge danger">deleted</span> : <Icon name="chev" size={14} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.rows.length && <div className="empty">No records match.</div>}
        </div>
        {data && (
          <div className="pager">
            {data.total.toLocaleString('en-US')} records · page {page + 1} of {pages}
            <button className="roundbtn" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <Icon name="back" />
            </button>
            <button className="roundbtn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} style={{ transform: 'scaleX(-1)' }}>
              <Icon name="back" />
            </button>
          </div>
        )}
      </div>
      {open !== null && (
        <RecordDrawer
          recno={open}
          writeOn={!!status?.writeOn}
          onClose={() => setOpen(null)}
          onChanged={load}
          onOpenInvoice={async () => {
            try {
              const ci = await window.api.foxOpenAsInvoice(open)
              go('invoice', { kind: 'invoice', invoice: ci })
            } catch (e) {
              toast(errorText(e), 'error')
            }
          }}
        />
      )}
    </>
  )
}

function RecordDrawer({ recno, writeOn, onClose, onChanged, onOpenInvoice }: { recno: number; writeOn: boolean; onClose: () => void; onChanged: () => void; onOpenInvoice: () => void }) {
  const toast = useToast()
  const ensureAdmin = useAdmin()
  const [rec, setRec] = useState<FoxRecord | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'recall' | null>(null)
  const [allFields, setAllFields] = useState(false)

  const load = () => window.api.foxRecord(recno).then((r) => (setRec(r), setEdits({}))).catch((e) => toast(errorText(e), 'error'))
  useEffect(() => {
    load()
  }, [recno])

  if (!rec) return <Drawer title={`Record ${recno}`} onClose={onClose}><div className="empty">Reading…</div></Drawer>

  const key = rec.fields.find((f) => f.name === KEY_FIELD)?.value ?? ''
  const changed = Object.keys(edits).filter((k) => edits[k] !== rec.fields.find((f) => f.name === k)?.value)
  const shown = rec.fields.filter((f) => allFields || WRITTEN_FIELDS.includes(f.name) || f.value.trim())

  const save = async () => {
    if (!(await ensureAdmin(`change FoxPro record ${recno}`))) return
    setBusy(true)
    try {
      const values: Record<string, string> = {}
      for (const k of changed) values[k] = edits[k]
      const r = await window.api.foxUpdateFields(recno, key, values)
      toast([`Record ${recno} saved in FoxPro.`, r.reindexed.length ? `${r.reindexed.join(', ')} rebuilt.` : '', ...r.warnings].filter(Boolean).join('\n'), r.warnings.length ? 'warn' : 'info')
      await load()
      onChanged()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      wide
      title={
        <>
          Record {recno} · {key || '(no invoice no)'} {rec.deleted && <span className="badge danger">deleted</span>}
        </>
      }
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onOpenInvoice} disabled={rec.deleted}>
            <Icon name="file" /> Open as invoice
          </button>
          {writeOn && rec.deleted && (
            <button className="btn" onClick={async () => (await ensureAdmin(`recall FoxPro record ${recno}`)) && setConfirm('recall')}>
              <Icon name="undo" /> Recall
            </button>
          )}
          {writeOn && (
            <button className="btn dark" disabled={!changed.length || busy || rec.deleted} onClick={save} title="Needs edit access">
              <Icon name="lock" /> Save {changed.length ? `${changed.length} change${changed.length > 1 ? 's' : ''}` : ''}
            </button>
          )}
        </>
      }
    >
      {!writeOn ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          <Icon name="lock" />
          <span className="grow">Read-only: saving to the FoxPro table is switched off in Settings.</span>
        </div>
      ) : (
        <div className="notice" style={{ marginBottom: 12 }}>
          <Icon name="shield" />
          <span className="grow">Saving changes to this record needs edit access (an access code, or the admin). Records in the FoxPro table cannot be deleted from this app.</span>
        </div>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <Switch checked={allFields} onChange={setAllFields} label="Show every field (including the empty expense fields)" />
      </div>
      <div className="fieldgrid">
        {shown.map((f) => {
          const v = edits[f.name] ?? f.value
          const isDate = f.type === 'D'
          const can = writeOn && f.writable && !rec.deleted
          return (
            <label key={f.name} className={changed.includes(f.name) ? 'f changed' : 'f'}>
              <span>
                {FIELD_LABELS[f.name] ?? f.name} <span className="fn">{f.name} {f.type}{f.length}{f.decimals ? `.${f.decimals}` : ''}</span>
              </span>
              <input
                type={isDate ? 'date' : 'text'}
                value={v}
                readOnly={!can}
                maxLength={f.type === 'C' ? f.length : undefined}
                onChange={(e) => setEdits({ ...edits, [f.name]: e.target.value })}
              />
            </label>
          )
        })}
      </div>
      {confirm === 'recall' && (
        <ConfirmDialog
          title={`Recall record ${recno}?`}
          text="The deleted mark is removed, like FoxPro’s RECALL."
          confirmLabel="Recall"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await window.api.foxSetDeleted(recno, key, false)
              toast(`Record ${recno} recalled.`)
              setConfirm(null)
              await load()
              onChanged()
            } catch (e) {
              toast(errorText(e), 'error')
            }
          }}
        />
      )}
    </Drawer>
  )
}

export type { FoxRow }
