import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './icons'

/** An error from the main process as plain text, without Electron's "Error invoking remote method ..." prefix. */
export function errorText(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

type ToastKind = 'info' | 'error' | 'warn'
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: ToastKind } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((msg: string, kind: ToastKind = 'info') => {
    setT({ msg, kind })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setT(null), kind === 'info' ? 3500 : 9000)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className={`toast ${t.kind === 'info' ? '' : t.kind}`} onClick={() => setT(null)}>
          {t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

export function Drawer({ title, onClose, children, actions, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'drawer wide' : 'drawer'}>
        <div className="dhead">
          <h2>{title}</h2>
          <div className="right">
            {actions}
            <button className="roundbtn" onClick={onClose} title="Close">
              <Icon name="x" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Dialog({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer: ReactNode }) {
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <h2>{title}</h2>
        {children}
        <div className="dfoot">{footer}</div>
      </div>
    </div>
  )
}

/** Ask before something that cannot be undone easily. The user types the given word to confirm. */
export function ConfirmDialog({
  title, text, confirmWord, confirmLabel, danger, onConfirm, onClose, extra
}: {
  title: string
  text: ReactNode
  confirmWord?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
  extra?: ReactNode
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = !confirmWord || typed.trim().toUpperCase() === confirmWord.trim().toUpperCase()
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={danger ? 'btn dark danger' : 'btn dark'}
            style={danger ? { background: 'var(--danger)', color: '#fff' } : undefined}
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p>{text}</p>
      {extra}
      {confirmWord && (
        <label className="f">
          Type <b style={{ color: 'var(--text)' }}>{confirmWord}</b> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
      )}
    </Dialog>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span>{label}</span>
    </label>
  )
}

export const fmtMoney = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return iso || ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

export const fmtTime = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="search">
      <Icon name="search" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false} />
    </div>
  )
}

/**
 * Asks for the admin password when an action needs it (changing or deleting something already saved).
 * `ensureAdmin(what)` resolves true at once when the admin is already unlocked, else after the password.
 */
const AdminCtx = createContext<(what: string) => Promise<boolean>>(async () => false)
export const useAdmin = () => useContext(AdminCtx)

export function AdminProvider({ children, onUnlocked }: { children: ReactNode; onUnlocked: () => void }) {
  const [ask, setAsk] = useState<{ what: string; resolve: (ok: boolean) => void } | null>(null)
  const ensure = useCallback(async (what: string) => {
    const s = await window.api.session()
    if (s.admin) return true
    return new Promise<boolean>((resolve) => setAsk({ what, resolve }))
  }, [])
  const close = (ok: boolean) => {
    ask?.resolve(ok)
    setAsk(null)
    if (ok) onUnlocked()
  }
  return (
    <AdminCtx.Provider value={ensure}>
      {children}
      {ask && <AdminPasswordDialog what={ask.what} onDone={close} />}
    </AdminCtx.Provider>
  )
}

function AdminPasswordDialog({ what, onDone }: { what: string; onDone: (ok: boolean) => void }) {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!pw || busy) return
    setBusy(true)
    const r = await window.api.adminLogin(pw)
    setBusy(false)
    if (r.ok) onDone(true)
    else {
      setMsg(r.message)
      setPw('')
    }
  }
  return (
    <Dialog
      title="Admin password needed"
      onClose={() => onDone(false)}
      footer={
        <>
          <button className="btn" onClick={() => onDone(false)}>
            Cancel
          </button>
          <button className="btn dark" disabled={!pw || busy} onClick={submit}>
            <Icon name="unlock" /> Unlock
          </button>
        </>
      }
    >
      <p>Only the admin can {what}. Admin stays unlocked until you lock it or log out.</p>
      <label className="f">
        Admin password
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus />
      </label>
      {msg && <p className="error mt">{msg}</p>}
    </Dialog>
  )
}

/** A whole screen that only the admin may open. */
export function AdminGate({ title, sub, button, onOpen }: { title: string; sub: string; button: string; onOpen: () => void }) {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{title}</h1>
          <div className="sub">{sub}</div>
        </div>
      </div>
      <form
        className="card"
        style={{ maxWidth: 440 }}
        onSubmit={async (e) => {
          e.preventDefault()
          const r = await window.api.adminLogin(pw)
          if (r.ok) onOpen()
          else {
            setMsg(r.message)
            setPw('')
          }
        }}
      >
        <div className="cardhead">
          <Icon name="lock" />
          <h2>Admin password</h2>
        </div>
        <label className="f">
          Password
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </label>
        {msg && <p className="error mt">{msg}</p>}
        <button className="btn dark mt" disabled={!pw}>
          {button}
        </button>
      </form>
    </>
  )
}
