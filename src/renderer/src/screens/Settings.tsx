import { useEffect, useState } from 'react'
import type { FoxStatus, PmaStatus, Session, Settings } from '@shared/types'
import type { CiDefaults } from '@shared/invoice'
import { Icon } from '../icons'
import { AdminGate, ConfirmDialog, errorText, fmtDate, fmtTime, Switch, useToast } from '../ui'

export default function SettingsScreen({ session, reload }: { session: Session; reload: () => void }) {
  if (!session.admin) return <AdminGate title="Settings" sub="Links to the data, FoxPro writing, invoice defaults and logins." button="Open Settings" onOpen={reload} />
  return <SettingsForm reload={reload} />
}

function SettingsForm({ reload }: { reload: () => void }) {
  const toast = useToast()
  const [s, setS] = useState<Settings | null>(null)
  const [saved, setSaved] = useState<Settings | null>(null)
  const [fox, setFox] = useState<FoxStatus | null>(null)
  const [pma, setPma] = useState<PmaStatus | null>(null)
  const [localPma, setLocalPma] = useState<string | null>(null)
  const [confirmWrite, setConfirmWrite] = useState(false)
  const [busy, setBusy] = useState('')
  const [logins, setLogins] = useState({ user: '', password: '', adminPassword: '' })

  const refreshStatus = () => {
    window.api.foxStatus().then(setFox)
    window.api.pmaStatus(true).then(setPma)
  }
  useEffect(() => {
    window.api.getSettings().then((x) => (setS(x), setSaved(x)))
    window.api.detectPma().then(setLocalPma)
    refreshStatus()
  }, [])

  if (!s) return <div className="empty">Loading…</div>
  const dirty = JSON.stringify(s) !== JSON.stringify(saved)
  const up = (p: Partial<Settings>) => setS({ ...s, ...p })
  const upD = (p: Partial<CiDefaults>) => setS({ ...s, defaults: { ...s.defaults, ...p } })

  const save = async (next = s) => {
    setBusy('Saving…')
    try {
      const r = await window.api.saveSettings(next)
      setS(r)
      setSaved(r)
      refreshStatus()
      toast('Settings saved.')
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const pickTable = async () => {
    const p = await window.api.pickFile('dbf')
    if (!p) return
    try {
      // tick the .IDX files next to it that index this table's invoice no (SHIPPING.IDX)
      const next = { ...s, shippingPath: p, shippingIndexes: [] as string[] }
      await window.api.saveSettings(next)
      const candidates = (await window.api.foxStatus()).indexCandidates
      await window.api.saveSettings({ ...next, shippingIndexes: candidates })
      const st = await window.api.foxStatus()
      await save({ ...next, shippingIndexes: st.indexes.filter((i) => i.field === 'COM_INV_NO').map((i) => i.path) })
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Settings</h1>
          <div className="sub">Admin · links to the data, FoxPro writing, invoice defaults and logins.</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => window.api.adminLogout().then(reload)}>
            <Icon name="lock" /> Lock Settings
          </button>
          <button className="btn dark" disabled={!dirty || !!busy} onClick={() => save()}>
            <Icon name="check" /> Save settings
          </button>
        </div>
      </div>

      <div className="cols c2">
        {/* FoxPro */}
        <div className="card">
          <div className="cardhead">
            <Icon name="database" />
            <h2>FoxPro shipping table</h2>
            <div className="right">{fox?.ok ? <span className="badge ok">linked</span> : <span className="badge warn">not linked</span>}</div>
          </div>
          <label className="f">
            Table (deldem shipping.DBF)
            <div className="inrow">
              <input value={s.shippingPath} readOnly placeholder="Choose the shipping table…" />
              <button className="btn small" onClick={pickTable}>
                <Icon name="folder" /> Choose
              </button>
            </div>
          </label>
          {fox?.configured && (
            <div className="kv mt">
              <span className="k">Records</span>
              <span>
                {fox.records.toLocaleString('en-US')} ({fox.deleted} deleted)
              </span>
              <span className="k">Last change</span>
              <span>{fox.lastUpdate ? fmtDate(fox.lastUpdate) : '–'}</span>
              <span className="k">Format</span>
              <span>
                {fox.version} · code page {fox.codePage}
              </span>
              <span className="k">Memo file</span>
              <span>{fox.memoFile ?? 'not found (the app never writes memo fields)'}</span>
              {!fox.ok && (
                <>
                  <span className="k">Problem</span>
                  <span className="error">{fox.message}</span>
                </>
              )}
            </div>
          )}
          <div className="eyebrow mt">Index files kept in step (rebuilt after the app adds a record or changes an invoice no)</div>
          <div className="list" style={{ marginTop: 6 }}>
            {(fox?.indexCandidates ?? []).map((c) => {
              const info = fox?.indexes.find((i) => i.path === c)
              const on = s.shippingIndexes.includes(c)
              return (
                <label key={c} className="row" style={{ cursor: 'default' }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => up({ shippingIndexes: e.target.checked ? [...s.shippingIndexes, c] : s.shippingIndexes.filter((x) => x !== c) })}
                  />
                  <code>{c.split(/[\\/]/).pop()}</code>
                  <span className="grow muted">
                    {info ? (info.matches ? `on ${info.field} · ${info.keys.toLocaleString('en-US')} keys · matches the table` : info.note) : on ? 'save to check' : ''}
                  </span>
                  {info && (info.matches ? <span className="badge ok">OK</span> : <span className="badge danger">check</span>)}
                </label>
              )
            })}
            {fox?.configured && !fox.indexCandidates.length && <div className="muted">No .IDX file next to the table.</div>}
          </div>
          <div className="row mt">
            <button
              className="btn small"
              disabled={!s.shippingIndexes.length || dirty}
              onClick={async () => {
                try {
                  const r = await window.api.foxRebuildIndexes()
                  toast(`Rebuilt ${r.join(', ')} from the table.`)
                  refreshStatus()
                } catch (e) {
                  toast(errorText(e), 'error')
                }
              }}
            >
              <Icon name="refresh" /> Rebuild ticked indexes
            </button>
            <span className="muted" style={{ fontSize: 11.5 }}>
              Like FoxPro’s REINDEX. Close FoxPro first.
            </span>
          </div>
          <div className="notice mt" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <Switch
                checked={s.writeFoxPro}
                onChange={(v) => (v ? setConfirmWrite(true) : up({ writeFoxPro: false }))}
                label={<b>Save to the FoxPro shipping table</b>}
              />
              <div className="muted" style={{ marginTop: 6, lineHeight: 1.5 }}>
                When on, saving an invoice also creates or updates its record in the table, deleting can mark it deleted, and FoxPro records can be edited. Off: the app only reads the table.
                A copy of the table and its indexes is kept before the first write each day.
              </div>
            </div>
          </div>
        </div>

        {/* Product Management App */}
        <div className="card">
          <div className="cardhead">
            <Icon name="box" />
            <h2>Product Management App database</h2>
            <div className="right">{pma?.ok ? <span className="badge ok">{pma.proformas} proformas</span> : <span className="badge warn">not linked</span>}</div>
          </div>
          <label className="f">
            quotations.db (proforma invoices)
            <div className="inrow">
              <input value={s.pmaDbPath} onChange={(e) => up({ pmaDbPath: e.target.value })} placeholder="\\PRODUCT-PC\quotations\quotations.db" spellCheck={false} />
              <button
                className="btn small"
                onClick={async () => {
                  const p = await window.api.pickFile('db')
                  if (p) up({ pmaDbPath: p })
                }}
              >
                <Icon name="folder" /> Choose
              </button>
            </div>
          </label>
          {localPma && localPma !== s.pmaDbPath && (
            <button className="btn small mt" onClick={() => up({ pmaDbPath: localPma })}>
              <Icon name="link" /> Use the one on this PC
            </button>
          )}
          {pma?.configured && (
            <div className="kv mt">
              <span className="k">Status</span>
              <span className={pma.ok ? '' : 'error'}>{pma.ok ? 'Read OK' : pma.message}</span>
              {pma.copiedAt && (
                <>
                  <span className="k">Last read</span>
                  <span>{fmtTime(pma.copiedAt)}</span>
                </>
              )}
              {pma.sourceModified && (
                <>
                  <span className="k">Database changed</span>
                  <span>{fmtTime(pma.sourceModified)}</span>
                </>
              )}
            </div>
          )}
          <div className="notice mt" style={{ alignItems: 'flex-start', lineHeight: 1.55 }}>
            <Icon name="help" />
            <div className="grow">
              <b>Connecting to the product manager’s PC</b>
              <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li>
                  On that PC open <code>%APPDATA%\Photo Quotation Generator</code>, right-click the <code>quotations</code> folder → Properties → Sharing → Share (Read is enough).
                </li>
                <li>
                  Here, choose <code>\\PC-NAME\quotations\quotations.db</code> (type it, or use Choose → Network).
                </li>
                <li>Save. The app reads a copy each time you fetch a PI, so the other app is never disturbed.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <div className="cols c2 mt">
        <div className="card">
          <div className="cardhead">
            <h2>Company header</h2>
            <span className="hint">Printed at the top of every page</span>
          </div>
          <label className="f">
            Line above the name (page 1)
            <input value={s.company.headerNote} onChange={(e) => up({ company: { ...s.company, headerNote: e.target.value } })} />
          </label>
          <label className="f mt">
            Company name
            <input value={s.company.name} onChange={(e) => up({ company: { ...s.company, name: e.target.value } })} />
          </label>
          <label className="f mt">
            Address
            <input value={s.company.address} onChange={(e) => up({ company: { ...s.company, address: e.target.value } })} />
          </label>
          <label className="f mt">
            Tel / fax
            <input value={s.company.telFax} onChange={(e) => up({ company: { ...s.company, telFax: e.target.value } })} />
          </label>
          <label className="f mt">
            Email (printed on the packing list)
            <input value={s.company.email ?? ''} onChange={(e) => up({ company: { ...s.company, email: e.target.value } })} placeholder="dgl@eureka.lk" />
          </label>
        </div>
        <div className="card">
          <div className="cardhead">
            <h2>New invoice defaults</h2>
          </div>
          <div className="cols c3">
            {(
              [
                ['goodsTitle', 'Goods'], ['type', 'Type'], ['currency', 'Currency'], ['incoterms', 'Incoterms'], ['terms', 'Terms'], ['totalsLabel', 'Label under totals'],
                ['paymentTerms', 'Payment terms'], ['hsCode', 'H.S code'], ['factory', 'Factory label'], ['shipTerms', 'FoxPro ship terms'], ['creditTo', 'FoxPro credit to']
              ] as [keyof CiDefaults, string][]
            ).map(([k, label]) => (
              <label className="f" key={k}>
                {label}
                <input value={s.defaults[k]} onChange={(e) => upD({ [k]: e.target.value })} />
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt">
        <div className="cardhead">
          <h2>Default closing blocks</h2>
          <span className="hint">Certificate, HS note, beneficiary and bank on every new invoice</span>
        </div>
        <div className="cols c2">
          <label className="f">
            We hereby certify that (one per line)
            <textarea rows={4} value={s.defaults.certify} onChange={(e) => upD({ certify: e.target.value })} />
          </label>
          <label className="f">
            HS code note
            <textarea rows={4} value={s.defaults.hsNote} onChange={(e) => upD({ hsNote: e.target.value })} />
          </label>
          <label className="f">
            Beneficiary
            <textarea rows={7} value={s.defaults.beneficiary} onChange={(e) => upD({ beneficiary: e.target.value })} />
          </label>
          <label className="f">
            Bank
            <textarea rows={7} value={s.defaults.bank} onChange={(e) => upD({ bank: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="cols c2 mt">
        <div className="card">
          <div className="cardhead">
            <Icon name="shield" />
            <h2>Backup</h2>
          </div>
          <label className="f">
            Backup folder
            <div className="inrow">
              <input value={s.backupPath} readOnly placeholder="Choose a folder (another drive is best)" />
              <button
                className="btn small"
                onClick={async () => {
                  const p = await window.api.pickFolder()
                  if (p) up({ backupPath: p })
                }}
              >
                <Icon name="folder" /> Choose
              </button>
            </div>
          </label>
          <button
            className="btn dark mt"
            disabled={!s.backupPath || dirty}
            onClick={async () => {
              setBusy('Backing up…')
              try {
                toast(`Backup made: ${await window.api.backupNow()}`)
              } catch (e) {
                toast(errorText(e), 'error')
              } finally {
                setBusy('')
              }
            }}
          >
            <Icon name="download" /> Back up now
          </button>
          <div className="muted mt" style={{ fontSize: 12 }}>
            Copies the FoxPro shipping table, its memo and index files, the app database and settings into a new dated folder.
          </div>
        </div>
        <div className="card">
          <div className="cardhead">
            <Icon name="lock" />
            <h2>Logins</h2>
            <span className="hint">Leave a box blank to keep it</span>
          </div>
          <div className="cols c3">
            <label className="f">
              App user name
              <input value={logins.user} onChange={(e) => setLogins({ ...logins, user: e.target.value })} />
            </label>
            <label className="f">
              New app password
              <input type="password" value={logins.password} onChange={(e) => setLogins({ ...logins, password: e.target.value })} />
            </label>
            <label className="f">
              New admin password
              <input type="password" value={logins.adminPassword} onChange={(e) => setLogins({ ...logins, adminPassword: e.target.value })} />
            </label>
          </div>
          <button
            className="btn mt"
            disabled={!logins.user && !logins.password && !logins.adminPassword}
            onClick={async () => {
              try {
                await window.api.changeLogins(logins)
                setLogins({ user: '', password: '', adminPassword: '' })
                toast('Logins changed.')
              } catch (e) {
                toast(errorText(e), 'error')
              }
            }}
          >
            <Icon name="check" /> Change logins
          </button>
        </div>
      </div>

      {confirmWrite && (
        <ConfirmDialog
          title="Write to the FoxPro shipping table?"
          text="The app will add, change and mark-delete records in the FoxPro table, and rebuild its ticked index files. Make sure nobody has the table open for writing in FoxPro while the app saves, and keep backups. FoxPro’s own record locks are not used."
          confirmWord="FOXPRO"
          confirmLabel="Switch on"
          onClose={() => setConfirmWrite(false)}
          onConfirm={() => {
            up({ writeFoxPro: true })
            setConfirmWrite(false)
          }}
        />
      )}
    </>
  )
}
