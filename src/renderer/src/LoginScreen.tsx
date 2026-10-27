import { useState } from 'react'
import { Icon } from './icons'
import { errorText } from './ui'

export default function LoginScreen({ version, onLoggedIn }: { version?: string; onLoggedIn: () => void }) {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user.trim() || !password || busy) return
    setBusy(true)
    try {
      const r = await window.api.login(user, password)
      if (r.ok) return onLoggedIn()
      setMessage(r.message)
      setPassword('')
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="loginpage">
      <form className="loginbox" onSubmit={submit}>
        <div className="logo">
          <div className="mark">
            <Icon name="anchor" size={17} />
          </div>
          Shipping&amp;AMP
        </div>
        <h1>Welcome back</h1>
        <div className="sub">Commercial invoices, shipments and the FoxPro shipping table.</div>
        <label className="f">
          User name
          <input value={user} onChange={(e) => setUser(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />
        </label>
        <label className="f">
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </label>
        {message && <p className="error">{message}</p>}
        <button className="btn dark" type="submit" disabled={!user.trim() || !password || busy}>
          {busy ? 'Checking…' : 'Log in'}
        </button>
        <div className="credit">
          {version && <>v{version} · </>}AMP Ceylon (Pvt) Ltd · Developed by P.Deepatharshan
        </div>
      </form>
    </div>
  )
}
