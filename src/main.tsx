import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { persister, shouldPersist } from './features/offline/persist'
import { useVault } from './features/security/vault'
import { installErrorReporting } from './lib/errorReporting'
import { queryClient } from './lib/queryClient'

installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 60 * 60 * 1000, // a week-old copy is better than nothing offline, older is stale
        buster: __APP_VERSION__, // a new release discards the old copy, so changed data shapes can't break it
        dehydrateOptions: {
          // Only what is safe to keep unencrypted on the device (never content from private workspaces).
          shouldDehydrateQuery: (q) => q.state.status === 'success' && shouldPersist(q.queryKey, q.state.data, useVault.getState().states),
        },
      }}
      onSuccess={() => { void queryClient.resumePausedMutations() }}
    >
      <ErrorBoundary scope="app">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </PersistQueryClientProvider>
  </StrictMode>,
)
