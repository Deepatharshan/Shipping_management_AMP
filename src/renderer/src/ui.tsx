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

export const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** "1 h 20 min", "12 min" */
export function timeLeft(until: number, now = Date.now()): string {
  const min = Math.max(1, Math.ceil((until - now) / 60_000))
  const h = Math.floor(min / 60)
  return h ? `${h} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`
}

interface EditAccessApi {
  /** resolves true at once when edit access is open (or the admin is in), else after the code / password */
  ensure: (what: string) => Promise<boolean>
  /** open the edit-access window without an action waiting */
  open: () => void
}
const EditCtx = createContext<EditAccessApi>({ ensure: async () => false, open: () => undefined })

/**
 * Edit access, like the Product Management App: changing or deleting saved documents and editing FoxPro
 * records need it. `ensure(what)` returns true when it is open (or the admin is logged in); otherwise it
 * shows the request-code / access-code window and waits.
 */
export const useEditAccess = () => useContext(EditCtx).ensure
export const useOpenEditAccess = () => useContext(EditCtx).open
/** kept for the screens that ask before an action */
export const useAdmin = useEditAccess

export function AdminProvider({ children, onUnlocked }: { children: ReactNode; onUnlocked: () => void }) {
  const [ask, setAsk] = useState<{ what: string | null; resolve: (ok: boolean) => void } | null>(null)
  const ensure = useCallback(async (what: string) => {
    const s = await window.api.session()
    if (s.canEdit) return true
    return new Promise<boolean>((resolve) => setAsk({ what, resolve }))
  }, [])
  const open = useCallback(() => setAsk({ what: null, resolve: () => undefined }), [])
  const close = (ok: boolean) => {
    ask?.resolve(ok)
    setAsk(null)
    onUnlocked()
  }
  return (
    <EditCtx.Provider value={{ ensure, open }}>
      {children}
      {ask && <EditAccessDialog what={ask.what} onDone={close} onChanged={onUnlocked} />}
    </EditCtx.Provider>
  )
}

function EditAccessDialog({ what, onDone, onChanged }: { what: string | null; onDone: (ok: boolean) => void; onChanged: () => void }) {
  const [session, setSession] = useState<import('@shared/types').Session | null>(null)
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [useAdminPw, setUseAdminPw] = useState(false)
  const reload = () => window.api.session().then(setSession)
  useEffect(() => {
    reload()
  }, [])
  if (!session) return null
  const request = session.request

  const generate = async () => {
    if (request && !window.confirm('Make a new request code? The code shown now will stop working.')) return
    await window.api.newAccessRequest()
    setCode('')
    setMsg(null)
    await reload()
  }
  const enter = async () => {
    if (!code.trim() || busy) return
    setBusy(true)
    const r = await window.api.enterAccessCode(code).finally(() => setBusy(false))
    setMsg({ text: r.message, ok: r.ok })
    if (r.ok) {
      setCode('')
      onChanged()
      if (what) onDone(true)
      else await reload()
    }
  }
  const adminIn = async () => {
    if (!pw || busy) return
    setBusy(true)
    const r = await window.api.adminLogin(pw).finally(() => setBusy(false))
    if (r.ok) return onDone(true)
    setMsg({ text: r.message, ok: false })
    setPw('')
  }
  const copy = async () => {
    if (!request) return
    await navigator.clipboard.writeText(request.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog
      title="Edit access"
      onClose={() => onDone(false)}
      footer={
        <button className="btn" onClick={() => onDone(false)}>
          {session.canEdit && !what ? 'Done' : 'Cancel'}
        </button>
      }
    >
      {what && <p>To {what}, edit access must be open.</p>}
      {session.editUntil ? (
        <div className="acc-open">
          <div className="acc-big">
            <Icon name="unlock" /> Open until <b>{clock(session.editUntil)}</b> <span className="muted">({timeLeft(session.editUntil)} left)</span>
          </div>
          <p className="muted">Saved invoices, packing lists and shipping records can be changed or deleted, and FoxPro records edited. It closes by itself when the time is over.</p>
          <button
            className="btn danger"
            onClick={async () => {
              await window.api.endEditAccess()
              onChanged()
              await reload()
            }}
          >
            Close edit access now
          </button>
        </div>
      ) : session.admin ? (
        <p className="acc-note">
          <b>Admin is unlocked:</b> editing is open until admin is locked or you log out.
        </p>
      ) : (
        <ol className="acc-steps">
          <li>
            <b>Generate a request code</b> and send it to P.Deepatharshan (phone, WhatsApp or e-mail).
            <div className="acc-row">
              {request ? (
                <>
                  <span className="acc-code">{request.code}</span>
                  <button className="btn small" onClick={copy}>
                    <Icon name="copy" /> {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button className="btn small ghost" onClick={generate}>
                    New code
                  </button>
                </>
              ) : (
                <button className="btn dark" onClick={generate}>
                  <Icon name="refresh" /> Generate request code
                </button>
              )}
            </div>
            {request && <div className="acc-hint">Made at {clock(request.createdAt)} · valid for 24 hours, once.</div>}
          </li>
          <li>
            <b>Type the access code</b> you receive. Editing opens for the time chosen (15 minutes to 10 hours).
            <div className="acc-row">
              <input
                className="acc-input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && enter()}
                placeholder="XXXXX-XXXXX"
                disabled={!request}
                spellCheck={false}
                autoComplete="off"
              />
              <button className="btn dark" disabled={!request || !code.trim() || busy} onClick={enter}>
                <Icon name="unlock" /> Open edit access
              </button>
            </div>
          </li>
        </ol>
      )}
      {msg && <p className={msg.ok ? 'acc-ok' : 'error'}>{msg.text}</p>}
      {!session.canEdit && (
        <div className="acc-admin">
          {useAdminPw ? (
            <div className="acc-row">
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adminIn()} placeholder="Admin password" autoFocus />
              <button className="btn" disabled={!pw || busy} onClick={adminIn}>
                <Icon name="lock" /> Unlock as admin
              </button>
            </div>
          ) : (
            <button className="linkbtn" onClick={() => setUseAdminPw(true)}>
              Admin? Use the admin password instead
            </button>
          )}
        </div>
      )}
    </Dialog>
  )
}

/** Admin: turn a request code from the shipping manager into an access code for a chosen time. */
const ACCESS_TIMES = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 300, label: '5 hours' },
  { minutes: 600, label: '10 hours' }
]
export function AccessCodeCard() {
  const [request, setRequest] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [result, setResult] = useState<{ code: string; request: string; label: string } | null>(null)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const generate = async () => {
    setMessage('')
    setResult(null)
    try {
      const code = await window.api.makeAccessCode(request, minutes)
      setResult({ code, request: request.toUpperCase(), label: ACCESS_TIMES.find((t) => t.minutes === minutes)!.label })
    } catch (err) {
      setMessage(errorText(err))
    }
  }
  return (
    <div className="card">
      <div className="cardhead">
        <Icon name="shield" />
        <h2>Access codes for editing</h2>
      </div>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
        The shipping manager clicks <b>Edit access → Generate request code</b> and sends you that code. Type it here, choose how long editing should stay
        open, and send back the access code. It works only for that request code, only once.
      </p>
      <div className="acc-row">
        <input className="acc-input" value={request} onChange={(e) => setRequest(e.target.value.toUpperCase())} placeholder="Request code, e.g. K7Q2-M9XD" spellCheck={false} autoComplete="off" />
      </div>
      <div className="seg acc-times">
        {ACCESS_TIMES.map((t) => (
          <button key={t.minutes} className={minutes === t.minutes ? 'on' : ''} onClick={() => setMinutes(t.minutes)}>
            {t.label}
          </button>
        ))}
      </div>
      <button className="btn dark mt" disabled={!request.trim()} onClick={generate}>
        <Icon name="unlock" /> Generate access code
      </button>
      {message && <p className="error mt">{message}</p>}
      {result && (
        <div className="acc-result">
          <div className="acc-hint">
            Access code for request {result.request}, open for {result.label}:
          </div>
          <div className="acc-row">
            <span className="acc-code big">{result.code}</span>
            <button
              className="btn small"
              onClick={async () => {
                await navigator.clipboard.writeText(result.code)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              <Icon name="copy" /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
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
