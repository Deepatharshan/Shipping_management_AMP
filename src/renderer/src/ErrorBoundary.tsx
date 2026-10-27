import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Shows a message and a way out instead of a blank page when a screen fails. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unexpected error:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: 24, background: '#fff', borderRadius: 20 }}>
        <h2 style={{ color: '#d92d20', marginTop: 0 }}>Something went wrong on this screen</h2>
        <p style={{ color: '#7a8089' }}>
          Your saved invoices and the FoxPro table are safe. Start a new invoice to carry on — this clears the half-finished invoice kept on this PC.
        </p>
        <p style={{ fontFamily: 'Consolas, monospace', fontSize: 12, color: '#777', wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn dark"
            onClick={() => {
              try {
                localStorage.removeItem('shp.draft.v1')
              } catch {
                /* ignore */
              }
              location.reload()
            }}
          >
            Start a new invoice
          </button>
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
