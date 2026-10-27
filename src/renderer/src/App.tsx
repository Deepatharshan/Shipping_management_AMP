import { useEffect, useState } from 'react'
import type { AppInfo, Session } from '@shared/types'
import type { CommercialInvoice } from '@shared/invoice'
import { Icon } from './icons'
import { ToastProvider } from './ui'
import LoginScreen from './LoginScreen'
import Dashboard from './screens/Dashboard'
import InvoiceEditor from './screens/InvoiceEditor'
import Shipments from './screens/Shipments'
import Proformas from './screens/Proformas'
import FoxRecords from './screens/FoxRecords'
import ChangeLog from './screens/ChangeLog'
import SettingsScreen from './screens/Settings'

export type Screen = 'dashboard' | 'invoice' | 'shipments' | 'proformas' | 'foxpro' | 'log' | 'settings'

const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'invoice', label: 'Commercial Invoice', icon: 'file' },
  { key: 'shipments', label: 'Shipments', icon: 'ship' },
  { key: 'proformas', label: 'Proforma Invoices', icon: 'box' },
  { key: 'foxpro', label: 'FoxPro Records', icon: 'database' },
  { key: 'log', label: 'Change Log', icon: 'log' },
  { key: 'settings', label: 'Settings', icon: 'settings' }
]

/** What the editor should open: a saved invoice, an invoice built elsewhere, or a PI number to fetch. */
export type OpenRequest = { kind: 'invoice'; invoice: CommercialInvoice } | { kind: 'pi'; piId: string } | { kind: 'new' } | null

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const load = () => window.api.session().then(setSession)
  useEffect(() => {
    window.api.appInfo().then((i) => {
      setInfo(i)
      document.title = `${i.name} v${i.version}`
    })
    load()
  }, [])
  if (!session) return null
  if (!session.user) return <LoginScreen version={info?.version} onLoggedIn={load} />
  return (
    <ToastProvider>
      <Shell info={info} session={session} reload={load} />
    </ToastProvider>
  )
}

function Shell({ info, session, reload }: { info: AppInfo | null; session: Session; reload: () => void }) {
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [open, setOpen] = useState<OpenRequest>(null)
  const [linked, setLinked] = useState<{ fox: boolean; pma: boolean }>({ fox: true, pma: true })

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setLinked({ fox: !!s.shippingPath, pma: !!s.pmaDbPath })
      if (!s.shippingPath && !s.pmaDbPath) setScreen('settings')
    })
  }, [screen])

  const go = (s: Screen, req: OpenRequest = null) => {
    if (req) setOpen(req)
    setScreen(s)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <div className="mark">
            <Icon name="anchor" size={17} />
          </div>
          <div>
            Shipping&amp;AMP
            <small>AMP Ceylon (Pvt) Ltd</small>
          </div>
        </div>
        <nav className="pills">
          {NAV.map((n) => (
            <button key={n.key} className={screen === n.key ? 'pill active' : 'pill'} onClick={() => go(n.key)}>
              {screen === n.key && <Icon name={n.icon} />}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="topicons">
          <button className="iconbtn" title="New commercial invoice" onClick={() => go('invoice', { kind: 'new' })}>
            <Icon name="plus" />
          </button>
          <button className="iconbtn" title={linked.fox && linked.pma ? 'Data linked' : 'Something is not linked yet — see Settings'} onClick={() => go('settings')}>
            <Icon name="bell" />
            {(!linked.fox || !linked.pma) && <span className="dot" />}
          </button>
          <button className="iconbtn" title="User guide" onClick={() => window.api.openGuide().catch(() => undefined)}>
            <Icon name="help" />
          </button>
          <button
            className="iconbtn"
            title="Log out"
            onClick={async () => {
              await window.api.logout()
              reload()
            }}
          >
            <Icon name="logout" />
          </button>
          <div className="avatar" title={session.user ?? ''}>
            {(session.user ?? '?').slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>
      <main className="main">
        {screen === 'dashboard' && <Dashboard go={go} />}
        {screen === 'invoice' && <InvoiceEditor request={open} onHandled={() => setOpen(null)} go={go} />}
        {screen === 'shipments' && <Shipments go={go} />}
        {screen === 'proformas' && <Proformas go={go} />}
        {screen === 'foxpro' && <FoxRecords go={go} />}
        {screen === 'log' && <ChangeLog />}
        {screen === 'settings' && <SettingsScreen session={session} reload={reload} />}
      </main>
      <footer className="footer">
        <span>{info && <>v{info.version} · data folder: {info.dataFolder} · SQLite {info.sqlite}</>}</span>
        <span>Developed by P.Deepatharshan</span>
      </footer>
    </div>
  )
}
