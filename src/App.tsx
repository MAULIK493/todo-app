import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { BackgroundLayer } from '@/features/appearance/BackgroundLayer'
import { AppShell } from '@/components/AppShell'
import { Toaster } from '@/components/Toaster'
import { SetupScreen } from '@/components/SetupScreen'
import { LoginPage } from '@/features/auth/LoginPage'
import { isSupabaseConfigured } from '@/lib/supabase'
import { HomePage } from '@/routes/HomePage'
import { TodosTab, WorkspacePage } from '@/routes/WorkspacePage'
import { useAuth } from '@/stores/auth'

// Loaded on demand so the settings screen doesn't weigh down every page load.
const LandingPage = lazy(() => import('@/features/landing/LandingPage'))
const PrivacyPage = lazy(() => import('@/routes/PrivacyPage'))
const DataPage = lazy(() => import('@/features/data/DataPage'))
const RewardsPage = lazy(() => import('@/features/rewards/RewardsPage').then((m) => ({ default: m.RewardsPage })))
// The notes editor brings the whole rich-text engine with it, so it only loads when someone opens notes.
const NotesPage = lazy(() => import('@/features/notes/NotesPage').then((m) => ({ default: m.NotesPage })))
const EmptyNotePane = lazy(() => import('@/features/notes/NoteEditorPane').then((m) => ({ default: m.EmptyNotePane })))
const NoteEditorPane = lazy(() => import('@/features/notes/NoteEditorPane').then((m) => ({ default: m.NoteEditorPane })))

const Loading = () => <div className="glass shimmer h-64 rounded-2xl" role="status" aria-busy aria-label="Loading" />
const later = (node: React.ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>

export default function App() {
  const { session, loading } = useAuth()

  return (
    <>
      <BackgroundLayer />
      <Toaster />
      {!isSupabaseConfigured ? (
        <SetupScreen />
      ) : loading ? null : !session ? (
        <Routes>
          <Route path="/" element={<Suspense fallback={null}><LandingPage /></Suspense>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<Suspense fallback={null}><PrivacyPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="rewards" element={later(<RewardsPage />)} />
            <Route path="data" element={later(<DataPage />)} />
            <Route path="w/:workspaceId" element={<WorkspacePage />}>
              <Route index element={<TodosTab />} />
              <Route path="notes" element={later(<NotesPage />)}>
                <Route index element={later(<EmptyNotePane />)} />
                <Route path=":noteId" element={later(<NoteEditorPane />)} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </>
  )
}
