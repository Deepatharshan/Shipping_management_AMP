import { useEffect, useState } from 'react'
import type { ChangeEntry } from '@shared/types'
import { Icon } from '../icons'
import { fmtTime } from '../ui'

const ACTION: Record<ChangeEntry['action'], string> = { create: 'Created', update: 'Updated', delete: 'Deleted', recall: 'Recalled', reindex: 'Rebuilt index' }

/** Every change the app made, in its own database and in the FoxPro table (with old and new values). */
export default function ChangeLog() {
  const [rows, setRows] = useState<ChangeEntry[]>([])
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    window.api.changes().then(setRows)
  }, [])
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Change Log</h1>
          <div className="sub">Every save, delete and index rebuild — in the app and in the FoxPro table.</div>
        </div>
      </div>
      <div className="card">
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>When</th>
                <th>Where</th>
                <th>What</th>
                <th>Invoice no</th>
                <th className="num">Record</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const before = (r.detail.before ?? {}) as Record<string, string>
                const after = (r.detail.after ?? {}) as Record<string, string>
                const diff = Object.keys(after).filter((k) => (before[k] ?? '') !== (after[k] ?? ''))
                const warnings = (r.detail.warnings ?? []) as string[]
                return (
                  <tr key={r.id} className="click" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="muted">{fmtTime(r.at)}</td>
                    <td>{r.target === 'foxpro' ? <span className="badge purple">FoxPro</span> : <span className="badge">App</span>}</td>
                    <td>{ACTION[r.action]}</td>
                    <td>
                      <b>{r.invoiceNo}</b>
                    </td>
                    <td className="num">{r.recno ?? ''}</td>
                    <td style={{ maxWidth: 520 }}>
                      {r.action === 'reindex' && String((r.detail.indexes as string[] | undefined)?.join(', ') ?? '')}
                      {r.target === 'foxpro' && r.action === 'update' && (
                        <span className="muted">
                          {diff.length ? `${diff.length} field${diff.length > 1 ? 's' : ''}: ${diff.slice(0, 5).join(', ')}${diff.length > 5 ? '…' : ''}` : 'no field changed'}
                        </span>
                      )}
                      {warnings.length > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>{warnings.length} cut to fit</span>}
                      {open === r.id && diff.length > 0 && (
                        <div className="kv" style={{ marginTop: 8 }}>
                          {diff.map((k) => (
                            <div key={k} style={{ display: 'contents' }}>
                              <span className="k">{k}</span>
                              <span>
                                <s className="muted">{before[k] || '∅'}</s> <Icon name="chev" size={11} /> {after[k] || '∅'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <div className="empty">Nothing yet.</div>}
        </div>
      </div>
    </>
  )
}
