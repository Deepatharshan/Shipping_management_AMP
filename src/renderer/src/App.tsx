import { useEffect, useState } from 'react'
import type { AppInfo, Session } from '@shared/types'
import type { CommercialInvoice } from '@shared/invoice'
import type { PackingList } from '@shared/packing'
import { Icon } from './icons'
import { AdminProvider, clock, timeLeft, ToastProvider, useOpenEditAccess } from './ui'
import { AmpLogo } from './Logo'
import LoginScreen from './LoginScreen'
import Dashboard from './screens/Dashboard'
import InvoiceEditor from './screens/InvoiceEditor'
import Shipments from './screens/Shipments'
import Proformas from './screens/Proformas'
import FoxRecords from './screens/FoxRecords'
import ChangeLog from './screens/ChangeLog'
import PackingEditor from './screens/PackingEditor'
import PackingLists from './screens/PackingLists'
import ShippingRecordScreen from './screens/ShippingRecordScreen'
import SettingsScreen from './screens/Settings'

export type Screen = 'dashboard' | 'invoice' | 'packing' | 'packinglists' | 'record' | 'shipments' | 'proformas' | 'foxpro' | 'log' | 'settings'

/** The sidebar: pages grouped by what they are for. */
const NAV: { group: string; items: { key: Screen; label: string; icon: string; also?: Screen[] }[] }[] = [
  { group: 'Overview', items: [{ key: 'dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    group: 'Documents',
    items: [
      { key: 'invoice', label: 'Commercial Invoice', icon: 'receipt' },
      { key: 'packing', label: 'Packing List', icon: 'box', also: ['packinglists'] },
      { key: 'record', label: 'Shipping Record', icon: 'clipboard' }
    ]
  },
  {
    group: 'Records',
    items: [
      { key: 'shipments', label: 'Shipments', icon: 'ship' },
      { key: 'proformas', label: 'Proforma Invoices', icon: 'files' },
      { key: 'foxpro', label: 'FoxPro Records', icon: 'database' }
    ]
  },
  {
    group: 'Admin',
    items: [
      { key: 'log', label: 'Change Log', icon: 'log' },
      { key: 'settings', label: 'Settings', icon: 'settings' }
    ]
  }
]

const SIDEBAR_KEY = 'shp.sidebar.collapsed'

/** What the editor should open: a saved invoice, an invoice built elsewhere, or a PI number to fetch. */
export type OpenRequest =
  | { kind: 'invoice'; invoice: CommercialInvoice }
  | { kind: 'pi'; piId: string }
  | { kind: 'new' }
  | { kind: 'packing'; packing: PackingList }
  | { kind: 'packingNew' }
  | { kind: 'packingFromInvoice'; invoiceId: string }
  | null

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
      <AdminProvider onUnlocked={load}>
        <Shell info={info} session={session} reload={load} />
      </AdminProvider>
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

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !c
    })
  const allLinked = linked.fox && linked.pma
  const openAccess = useOpenEditAccess()
  // keep the time left fresh, and notice when edit access runs out
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => {
      tick((n) => n + 1)
      if (session.editUntil && Date.now() >= session.editUntil) reload()
    }, 30_000)
    return () => clearInterval(t)
  }, [session.editUntil])

  return (
    <div className={collapsed ? 'app collapsed' : 'app'}>
      <aside className="sidebar">
        <div className="sb-brand">
          <AmpLogo size={38} />
          <div className="sb-name">
            Shipping&amp;AMP
            <small>AMP Ceylon (Pvt) Ltd</small>
          </div>
          <button className="sb-toggle" title={collapsed ? 'Show the menu' : 'Hide the menu labels'} onClick={toggle}>
            <Icon name="sidebar" />
          </button>
        </div>

        <button className="sb-cta" title="New commercial invoice" onClick={() => go('invoice', { kind: 'new' })}>
          <Icon name="plus" />
          <span>New invoice</span>
        </button>

        <nav className="sb-nav">
          {NAV.map((g) => (
            <div key={g.group} className="sb-group">
              <div className="sb-label">{g.group}</div>
              {g.items.map((n) => {
                const active = screen === n.key || !!n.also?.includes(screen)
                const locked = (n.key === 'log' || n.key === 'settings') && !session.admin
                const warn = n.key === 'settings' && !allLinked
                return (
                  <button key={n.key} className={active ? 'sb-item active' : 'sb-item'} title={n.label} onClick={() => go(n.key)}>
                    <span className="ic">
                      <Icon name={n.icon} />
                      {warn && <i className="sb-dot" />}
                    </span>
                    <span className="lbl">{n.label}</span>
                    {locked && (
                      <span className="sb-lock" title="Needs the admin password">
                        <Icon name="lock" size={12} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <button className={allLinked ? 'sb-status ok' : 'sb-status warn'} title={allLinked ? 'FoxPro table and Product Management App are linked' : 'Something is not linked yet — open Settings'} onClick={() => go('settings')}>
            <i />
            <span className="lbl">{allLinked ? 'Data linked' : 'Not linked — Settings'}</span>
          </button>
          <button
            className={session.canEdit ? 'sb-access on' : 'sb-access'}
            title={session.editUntil ? `Edit access open until ${clock(session.editUntil)}` : session.admin ? 'Admin is unlocked' : 'Open edit access with a code'}
            onClick={openAccess}
          >
            <Icon name={session.canEdit ? 'unlock' : 'lock'} size={14} />
            <span className="lbl">
              {session.editUntil ? `Edit access · ${timeLeft(session.editUntil)} left` : session.admin ? 'Admin unlocked' : 'Edit access'}
            </span>
          </button>
          {session.admin && (
            <button
              className="sb-access"
              title="Lock admin again"
              onClick={async () => {
                await window.api.adminLogout()
                reload()
              }}
            >
              <Icon name="lock" size={14} />
              <span className="lbl">Lock admin</span>
            </button>
          )}
          <div className="sb-user">
            <div className="avatar" title={session.user ?? ''}>
              {(session.user ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="who">
              <b>{session.user}</b>
              <small>{session.admin ? 'Admin' : 'Signed in'}</small>
            </div>
            <button className="sb-icon" title="User guide" onClick={() => window.api.openGuide().catch(() => undefined)}>
              <Icon name="help" />
            </button>
            <button
              className="sb-icon"
              title="Log out"
              onClick={async () => {
                await window.api.logout()
                reload()
              }}
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <div className="content">
      <main className="main">
        {screen === 'dashboard' && <Dashboard go={go} />}
        {screen === 'invoice' && <InvoiceEditor request={open} onHandled={() => setOpen(null)} go={go} />}
        {screen === 'packing' && <PackingEditor request={open} onHandled={() => setOpen(null)} go={go} />}
        {screen === 'packinglists' && <PackingLists go={go} />}
        {screen === 'record' && <ShippingRecordScreen />}
        {screen === 'shipments' && <Shipments go={go} />}
        {screen === 'proformas' && <Proformas go={go} />}
        {screen === 'foxpro' && <FoxRecords go={go} />}
        {screen === 'log' && <ChangeLog session={session} reload={reload} />}
        {screen === 'settings' && <SettingsScreen session={session} reload={reload} />}
      </main>
        <footer className="footer">
          <span>{info && <>v{info.version} · data folder: {info.dataFolder} · SQLite {info.sqlite}</>}</span>
          <span>Developed by P.Deepatharshan</span>
        </footer>
      </div>
    </div>
  )
}
