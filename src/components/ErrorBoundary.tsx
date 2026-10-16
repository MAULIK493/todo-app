import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isStaleBundleError, reportError } from '@/lib/errorReporting'

type Props = {
  /** 'app' replaces the whole screen; 'page' replaces just the main area so the sidebar keeps working. */
  scope: 'app' | 'page'
  /** When this changes (for example the route), a shown error is cleared so the next screen gets a fresh start. */
  resetKey?: string
  children: ReactNode
}
type State = { error: Error | null }

/** Catches errors while rendering, reports them, and shows a way forward instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { scope: this.props.scope, where: (info.componentStack ?? '').trim().split('\n')[0]?.trim().slice(0, 80) ?? '' })
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isStaleBundleError(error.message)

    return (
      <div role="alert" className={this.props.scope === 'app' ? 'grid min-h-screen place-items-center p-6' : 'grid place-items-center p-6'}>
        <div className="glass max-w-md space-y-3 rounded-2xl p-6 text-center">
          <h1 className="text-xl font-semibold">{stale ? 'A new version is available' : 'Something went wrong'}</h1>
          <p className="text-sm text-muted">
            {stale
              ? 'The app was updated while this page was open. Reload to get the latest version.'
              : 'This part of the app hit an unexpected problem. Your data is safe. The problem has been reported so it can be fixed.'}
          </p>
          <div className="flex justify-center gap-2">
            <button onClick={() => location.reload()} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">Reload</button>
            {!stale && this.props.scope === 'page' && <button onClick={() => this.setState({ error: null })} className="glass rounded-xl px-4 py-2 text-sm">Try again</button>}
          </div>
        </div>
      </div>
    )
  }
}
