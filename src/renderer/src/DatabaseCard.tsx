import { useEffect, useState } from 'react'
import type { DbFolderCheck, DbStatus } from '@shared/types'
import { Icon } from './icons'
import { ConfirmDialog, errorText, useToast } from './ui'

const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** Settings → App database: where invoices, packing lists, shipping records and the change log are kept. */
export function DatabaseCard() {
  const toast = useToast()
  const [st, setSt] = useState<DbStatus | null>(null)
  const [check, setCheck] = useState<DbFolderCheck | null>(null)
  const load = () => window.api.dbStatus().then(setSt).catch((e) => toast(errorText(e), 'error'))
  useEffect(() => {
    load()
  }, [])

  const pick = async (folder?: string) => {
    const f = folder ?? (await window.api.pickFolder())
    if (!f) return
    try {
      const c = await window.api.dbCheckFolder(f)
      if (c.sameAsNow) return toast('The app already uses the database in this folder.')
      setCheck(c)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  if (!st) return null
  return (
    <div className="card dbcard">
      <div className="cardhead">
        <Icon name="database" />
        <h2>App database</h2>
        <span className="hint">Invoices, packing lists, shipping records and the change log</span>
        <div className="right">
          {st.isDefault ? <span className="badge">default folder</span> : <span className="badge soft">chosen folder</span>}
          {st.network && <span className="badge warn">network</span>}
        </div>
      </div>
      <div className="dbpath">
        <Icon name="folder" />
        <code>{st.file}</code>
      </div>
      <div className="dbstats">
        <span>
          <b>{st.invoices}</b> invoices
        </span>
        <span>
          <b>{st.packingLists}</b> packing lists
        </span>
        <span>
          <b>{st.records}</b> shipping records
        </span>
        <span>
          <b>{size(st.size)}</b> on disk
        </span>
      </div>
      <div className="row wrap mt">
        <button className="btn dark" onClick={() => pick()}>
          <Icon name="folder" /> Choose folder…
        </button>
        <button className="btn" onClick={() => window.api.dbOpenFolder().catch((e) => toast(errorText(e), 'error'))}>
          <Icon name="eye" /> Open folder
        </button>
        {!st.isDefault && (
          <button className="btn ghost" onClick={() => pick(st.defaultFolder)}>
            <Icon name="undo" /> Back to the default folder
          </button>
        )}
      </div>
      <div className="muted mt" style={{ fontSize: 12, lineHeight: 1.5 }}>
        Choose a folder and the database is moved there (a checked copy; the old file is kept as a backup), or — if the folder already holds an app
        database — the app switches to that one. Settings, logins and edit access stay on this PC. For a network folder, let only one PC use it at a time;
        a folder on this PC (and regular backups) is the safest.
      </div>

      {check && (
        <ConfirmDialog
          title={check.hasDb ? 'Use the database in this folder?' : 'Move the database to this folder?'}
          text={
            <>
              <code>{check.folder}</code>
              <br />
              <br />
              {check.hasDb ? (
                <>
                  This folder already has an app database
                  {check.invoices !== null ? ` with ${check.invoices} invoice${check.invoices === 1 ? '' : 's'}` : ''}. The app will use it from now on, and the
                  database used now ({st.invoices} invoices) stays where it is.
                </>
              ) : (
                <>
                  A checked copy of the database ({st.invoices} invoices, {st.packingLists} packing lists, {st.records} shipping records) is made in this folder,
                  and the app uses it from now on. The old file is kept as a backup.
                </>
              )}
              {check.network && (
                <>
                  <br />
                  <br />
                  <b>Network folder:</b> only one PC should use it at a time.
                </>
              )}
            </>
          }
          confirmLabel={check.hasDb ? 'Use the database there' : 'Move the database'}
          onClose={() => setCheck(null)}
          onConfirm={async () => {
            try {
              toast(await window.api.dbSetFolder(check.folder, check.hasDb ? 'use' : 'move'))
              setCheck(null)
              await load()
            } catch (e) {
              toast(errorText(e), 'error')
            }
          }}
        />
      )}
    </div>
  )
}
