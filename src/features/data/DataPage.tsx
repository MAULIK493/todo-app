import { useQueryClient } from '@tanstack/react-query'
import { Download, FileUp, Lock, ShieldAlert } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useVault } from '@/features/security/vault'
import { useWorkspaces } from '@/features/workspaces/api'
import { lockParamsOf, WORKSPACE_COLORS, type Workspace } from '@/features/workspaces/types'
import { cn } from '@/lib/cn'
import { downloadBlob } from '@/lib/download'
import { fadeUp } from '@/lib/motion'
import { useToasts } from '@/stores/toasts'
import { runExport, ExportCancelled, type ExportFormat } from './exporter'
import { ImportCancelled, ImportFailed, runImport, type ImportResult, type Target } from './importer'
import { MAX_FILE_BYTES, parseJsonExport, parseTodoCsv, sniffFormat, summarize, type ImportPlan } from './parse'
import { createExportSource, createImportSink } from './supabaseData'
import { DeleteAccount } from './DeleteAccount'

/** Warn before closing the tab while a long export or import is running. */
function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'json', label: 'Full backup (JSON)', hint: 'Todos, subtasks, notes, tags and folders. The only format that can restore everything.' },
  { id: 'csv-todos', label: 'Todos (CSV)', hint: 'Opens in Excel, Numbers or Google Sheets.' },
  { id: 'csv-notes', label: 'Notes (CSV)', hint: 'Note titles and plain text, one note per row.' },
]

export default function DataPage() {
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" className="mx-auto max-w-3xl space-y-4 pb-12">
      <h1 className="gradient-text text-3xl font-bold">Your data</h1>
      <ExportCard />
      <ImportCard />
      <DeleteAccount />
    </motion.div>
  )
}

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="glass space-y-4 rounded-2xl p-5" aria-label={title}>
      <h2 className="flex items-center gap-2 font-semibold">{icon} {title}</h2>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------------------------------

function ExportCard() {
  const { data: workspaces = [] } = useWorkspaces()
  const keys = useVault((s) => s.keys)
  const push = useToasts((s) => s.push)
  const [picked, setPicked] = useState<Set<string> | null>(null) // null = everything
  const [format, setFormat] = useState<ExportFormat>('json')
  const [includePrivate, setIncludePrivate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  useLeaveWarning(busy)

  const isPrivate = (w: Workspace) => lockParamsOf(w) !== null || w.lock_state !== 'none'
  const privateOnes = workspaces.filter(isPrivate)
  const openPrivate = privateOnes.filter((w) => keys[w.id])
  const lockedPrivate = privateOnes.filter((w) => !keys[w.id])

  const toggle = (id: string) => {
    const next = new Set(picked ?? workspaces.map((w) => w.id))
    if (next.has(id)) next.delete(id); else next.add(id)
    setPicked(next.size === workspaces.length ? null : next)
  }

  const start = async () => {
    setBusy(true); setError(null); setMessage(null); setProgress(0)
    controller.current = new AbortController()
    try {
      const r = await runExport(createExportSource(), {
        workspaceIds: picked ? [...picked] : null, format, includePrivate, appVersion: __APP_VERSION__, signal: controller.current.signal,
        onProgress: (p) => setProgress(p.done),
      })
      downloadBlob(r.blob, r.filename)
      const parts = [`${r.counts.todos.toLocaleString()} todo${r.counts.todos === 1 ? '' : 's'}`, ...(format === 'csv-todos' ? [] : [`${r.counts.notes.toLocaleString()} note${r.counts.notes === 1 ? '' : 's'}`])]
      setMessage(`Exported ${parts.join(' and ')}.${r.skippedPrivate.length ? ` Not included: ${r.skippedPrivate.join(', ')} (private).` : ''}`)
      push('Export ready')
    } catch (e) {
      if (!(e instanceof ExportCancelled)) setError(e instanceof Error ? e.message : 'The export failed.')
      else setMessage('Export cancelled.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Export" icon={<Download size={18} aria-hidden />}>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-medium">What to export</legend>
        {workspaces.map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!picked || picked.has(w.id)} onChange={() => toggle(w.id)} disabled={busy} />
            <span className="size-2.5 rounded-full" style={{ background: w.color }} aria-hidden />
            {w.name}
            {isPrivate(w) && <span className="flex items-center gap-1 text-xs text-muted"><Lock size={11} /> {keys[w.id] ? 'private, unlocked' : 'private, locked'}</span>}
          </label>
        ))}
        {workspaces.length === 0 && <p className="text-sm text-muted">No workspaces yet.</p>}
      </fieldset>

      <div role="radiogroup" aria-label="Format" className="grid gap-2 sm:grid-cols-3">
        {FORMATS.map((f) => (
          <button key={f.id} role="radio" aria-checked={format === f.id} onClick={() => setFormat(f.id)} disabled={busy} className={cn('glass rounded-xl p-3 text-left text-sm', format === f.id && 'ring-2 ring-accent')}>
            <span className="block font-medium">{f.label}</span>
            <span className="block text-xs text-muted">{f.hint}</span>
          </button>
        ))}
      </div>

      {privateOnes.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm">
          <label className={cn('flex items-start gap-2', openPrivate.length === 0 && 'opacity-60')}>
            <input type="checkbox" className="mt-1" checked={includePrivate} disabled={busy || openPrivate.length === 0} onChange={(e) => setIncludePrivate(e.target.checked)} />
            <span>
              <b>Include private workspaces</b> ({openPrivate.length} unlocked)
              <span className="block text-xs text-muted">The file will contain readable, unencrypted text from them. Keep it somewhere safe.</span>
            </span>
          </label>
          {lockedPrivate.length > 0 && <p className="text-xs text-muted">Locked, so they can’t be included: {lockedPrivate.map((w) => w.name).join(', ')}. Unlock them first to include them.</p>}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => void start()} disabled={busy || workspaces.length === 0 || (picked !== null && picked.size === 0)} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Exporting…' : 'Export'}
        </button>
        {busy && <button onClick={() => controller.current?.abort()} className="glass rounded-xl px-4 py-2 text-sm">Cancel</button>}
        {busy && <span className="text-sm text-muted" role="status">{progress.toLocaleString()} items so far…</span>}
      </div>
      {message && <p className="text-sm text-green-400" role="status">{message}</p>}
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
    </Card>
  )
}

// ---------------------------------------------------------------------------------------------------------------------

type Loaded = { plan: ImportPlan; fileName: string }

function ImportCard() {
  const qc = useQueryClient()
  const { data: workspaces = [] } = useWorkspaces()
  const keys = useVault((s) => s.keys)
  const push = useToasts((s) => s.push)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [targets, setTargets] = useState<string[]>([]) // per group: 'new' or an existing workspace id
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  useLeaveWarning(busy)

  const usable = workspaces.filter((w) => w.lock_state === 'none' || !!keys[w.id]) // a locked private workspace can't be written to

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setLoaded(null); setResult(null); setError(null)
    if (file.size > MAX_FILE_BYTES) return setError('That file is too large (limit 25 MB).')
    const text = await file.text()
    const base = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Imported'
    const parsed = sniffFormat(file.name, text) === 'json' ? parseJsonExport(text) : parseTodoCsv(text, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, defaultWorkspace: base })
    if (!parsed.ok) return setError(parsed.error)
    setLoaded({ plan: parsed.plan, fileName: file.name })
    setTargets(parsed.plan.groups.map(() => 'new'))
  }

  const start = async () => {
    if (!loaded) return
    setBusy(true); setError(null); setResult(null)
    controller.current = new AbortController()
    const resolved: Target[] = loaded.plan.groups.map((g, i) => {
      const t = targets[i]
      const ws = workspaces.find((w) => w.id === t)
      return t === 'new' || !ws
        ? { kind: 'new', name: g.name, color: g.color ?? WORKSPACE_COLORS[i % WORKSPACE_COLORS.length] }
        : { kind: 'existing', id: ws.id, name: ws.name, private: ws.lock_state !== 'none' }
    })
    try {
      const r = await runImport(loaded.plan, resolved, createImportSink(), { signal: controller.current.signal, onProgress: setProgress })
      setResult(r)
      setLoaded(null)
      push('Import finished')
    } catch (e) {
      const partial = e instanceof ImportFailed || e instanceof ImportCancelled ? e.result : null
      setError(e instanceof ImportCancelled ? 'Import cancelled.' : e instanceof Error ? e.message : 'The import failed.')
      if (partial) setResult(partial)
    } finally {
      setBusy(false)
      for (const key of ['workspaces', 'todos', 'notes', 'tags', 'subtasks']) void qc.invalidateQueries({ queryKey: [key] })
    }
  }

  const summary = loaded ? summarize(loaded.plan) : null

  return (
    <Card title="Import" icon={<FileUp size={18} aria-hidden />}>
      <p className="text-sm text-muted">Restore a backup made here, or bring todos from a spreadsheet or another app (CSV with a title column).</p>
      <label className="glass flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-border p-5 text-center text-sm hover:border-accent">
        <span className="font-medium">Choose a .json or .csv file</span>
        <span className="text-xs text-muted">Up to 25 MB. Nothing is uploaded until you press Import.</span>
        <input type="file" className="sr-only" accept=".json,.csv,application/json,text/csv" disabled={busy} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
      </label>

      {loaded && summary && (
        <div className="space-y-3" aria-label="Import preview">
          <p className="text-sm">
            <b>{loaded.fileName}</b>: {summary.todos.toLocaleString()} todo{summary.todos === 1 ? '' : 's'}
            {summary.notes > 0 && <>, {summary.notes.toLocaleString()} note{summary.notes === 1 ? '' : 's'}</>} in {summary.workspaces} group{summary.workspaces === 1 ? '' : 's'}.
          </p>
          <ul className="space-y-2">
            {loaded.plan.groups.map((g, i) => (
              <li key={i} className="glass flex flex-wrap items-center gap-3 rounded-xl p-3 text-sm">
                <span className="flex-1">
                  <b>{g.name}</b>
                  <span className="block text-xs text-muted">{g.todos.length} todos{g.notes.length ? `, ${g.notes.length} notes` : ''}</span>
                </span>
                <label className="flex items-center gap-2 text-xs text-muted">
                  Add to
                  <select aria-label={`Where to put ${g.name}`} value={targets[i]} onChange={(e) => setTargets((t) => t.map((x, j) => (j === i ? e.target.value : x)))} className="glass rounded-lg px-2 py-1 text-sm text-text outline-none" disabled={busy}>
                    <option value="new" className="text-black">New workspace “{g.name}”</option>
                    {usable.map((w) => <option key={w.id} value={w.id} className="text-black">{w.name}{w.lock_state !== 'none' ? ' (private)' : ''}</option>)}
                  </select>
                </label>
              </li>
            ))}
          </ul>
          {loaded.plan.warnings.length > 0 && (
            <details className="text-xs text-amber-400">
              <summary className="cursor-pointer">{loaded.plan.warnings.length} thing{loaded.plan.warnings.length === 1 ? '' : 's'} to know about</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{loaded.plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </details>
          )}
          <p className="text-xs text-muted">Imported todos don’t earn XP. Importing the same file twice adds everything twice.</p>
          <div className="flex items-center gap-3">
            <button onClick={() => void start()} disabled={busy} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Importing…' : 'Import'}</button>
            {busy && <button onClick={() => controller.current?.abort()} className="glass rounded-xl px-4 py-2 text-sm">Cancel</button>}
            {busy && (
              <span className="flex-1" role="status">
                <span className="block h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></span>
                <span className="text-xs text-muted">{progress.done.toLocaleString()} of {progress.total.toLocaleString()}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className={cn('rounded-xl p-3 text-sm', error ? 'bg-amber-500/10' : 'bg-green-500/10')} role="status">
          {error ? 'Stopped part-way. ' : 'Done. '}Added {result.todos.toLocaleString()} todo{result.todos === 1 ? '' : 's'}{result.notes > 0 && ` and ${result.notes.toLocaleString()} note${result.notes === 1 ? '' : 's'}`}
          {result.workspacesCreated > 0 && `, creating ${result.workspacesCreated} workspace${result.workspacesCreated === 1 ? '' : 's'}`}.
          {result.warnings.map((w) => <span key={w} className="mt-1 block text-xs text-muted">{w}</span>)}
        </div>
      )}
      {error && <p className="flex items-start gap-1 text-sm text-red-400" role="alert"><ShieldAlert size={15} className="mt-0.5 shrink-0" /> {error}</p>}
    </Card>
  )
}

