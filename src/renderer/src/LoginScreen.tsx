import { useState } from 'react'
import { Icon } from './icons'
import { AmpLogo } from './Logo'
import { errorText } from './ui'

const FEATURES: { icon: string; text: string }[] = [
  { icon: 'receipt', text: 'Commercial invoices from proforma invoices' },
  { icon: 'box', text: 'Packing / weight lists with CBM and weights' },
  { icon: 'clipboard', text: 'Monthly shipping records' },
  { icon: 'database', text: 'Kept in step with the FoxPro shipping table' }
]

export default function LoginScreen({ version, onLoggedIn }: { version?: string; onLoggedIn: () => void }) {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
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
      <div className="loginshell">
        <aside className="loginbrand">
          <div className="lb-top">
            <AmpLogo size={52} />
            <div>
              <div className="lb-name">Shipping&amp;AMP</div>
              <div className="lb-co">AMP Ceylon (Pvt) Ltd</div>
            </div>
          </div>
          <div className="lb-mid">
            <h2>Shipping management</h2>
            <p>Everything the shipping office prints and keeps, in one place.</p>
            <ul>
              {FEATURES.map((f) => (
                <li key={f.text}>
                  <span className="lb-ic">
                    <Icon name={f.icon} />
                  </span>
                  {f.text}
                </li>
              ))}
            </ul>
          </div>
          <svg className="lb-waves" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 30 C 50 10, 100 50, 150 30 S 250 10, 300 30 S 380 45, 400 32 V60 H0 Z" fill="rgba(255,255,255,.05)" />
            <path d="M0 40 C 60 22, 110 58, 170 40 S 270 22, 330 40 S 390 50, 400 44 V60 H0 Z" fill="rgba(255,255,255,.06)" />
          </svg>
        </aside>

        <form className="loginform" onSubmit={submit}>
          <h1>Sign in</h1>
          <div className="sub">Use the shipping office login.</div>

          <label className="f">
            User name
            <div className="lf-input">
              <Icon name="user" />
              <input value={user} onChange={(e) => setUser(e.target.value)} autoFocus autoComplete="off" spellCheck={false} placeholder="User name" />
            </div>
          </label>
          <label className="f">
            Password
            <div className="lf-input">
              <Icon name="lock" />
              <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder="Password" />
              <button type="button" className="lf-eye" title={show ? 'Hide the password' : 'Show the password'} onClick={() => setShow((v) => !v)}>
                <Icon name={show ? 'eyeoff' : 'eye'} />
              </button>
            </div>
          </label>
          {message && (
            <div className="lf-error">
              <Icon name="x" /> {message}
            </div>
          )}
          <button className="lf-submit" type="submit" disabled={!user.trim() || !password || busy}>
            {busy ? 'Checking…' : 'Sign in'}
            {!busy && <Icon name="chev" />}
          </button>
          <div className="credit">
            {version && <>v{version} · </>}Developed by P.Deepatharshan
          </div>
        </form>
      </div>
    </div>
  )
}
