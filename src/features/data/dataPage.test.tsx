// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '@/features/security/vault'
import { useToasts } from '@/stores/toasts'
import type { Workspace } from '@/features/workspaces/types'
import type { ExportSource } from './exporter'
import type { ExportTodo } from './formats'
import type { ImportSink } from './importer'
import { FORMAT } from './formats'

const mk = (id: string, name: string, over: Partial<Workspace> = {}): Workspace => ({
  id, name, color: '#22c55e', icon: 'folder', position: 0, background: null, lock_state: 'none', lock_type: null, lock_salt: null,
  lock_iterations: null, wrapped_key: null, recovery_salt: null, recovery_wrapped_key: null, ...over,
})
const priv = (id: string, name: string) => mk(id, name, { lock_state: 'locked', lock_type: 'pin', lock_salt: 's', lock_iterations: 600000, wrapped_key: 'k' })
const workspaces: Workspace[] = []
vi.mock('@/features/workspaces/api', () => ({ useWorkspaces: () => ({ data: workspaces }) }))

const download = vi.fn()
vi.mock('@/lib/download', () => ({ downloadBlob: (...a: unknown[]) => download(...a) }))

const todoRows: Record<string, ExportTodo[]> = {}
const sinkCalls = { workspaces: [] as string[], todos: [] as string[], failOn: 0 }
vi.mock('./supabaseData', () => ({
  createExportSource: (): ExportSource => ({
    workspaces: async () => workspaces.map((w) => ({ id: w.id, name: w.name, color: w.color, icon: w.icon, position: 0, private: w.lock_state !== 'none', locked: w.lock_state !== 'none' && !useVault.getState().keys[w.id] })),
    folders: async () => [],
    todoPage: async (id, after) => (after ? [] : todoRows[id] ?? []),
    notePage: async () => [],
  }),
  createImportSink: (): ImportSink => ({
    createWorkspace: async (name) => { sinkCalls.workspaces.push(name); return { id: `new-${name}` } },
    insertFolders: async () => undefined,
    insertTodos: async (ws, rows) => { if (sinkCalls.failOn && sinkCalls.todos.length >= sinkCalls.failOn) throw new Error('database unavailable'); sinkCalls.todos.push(...rows.map((r) => `${ws}:${r.title}`)) },
    linkTags: async () => undefined, insertNotes: async () => undefined, tagNotes: async () => undefined,
  }),
}))

const signOut = vi.fn()
const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: () => getSession(), signOut: () => signOut() } }, isSupabaseConfigured: true }))

const { default: DataPage } = await import('./DataPage')

const todo = (id: string, ws: string, title: string): ExportTodo => ({ id, workspace_id: ws, parent_id: null, title, description: '', status: 'open', priority: 0, due_at: null, reminder_at: null, recurrence: null, tags: [], position: 0, completed_at: null, created_at: '2026-10-01T00:00:00Z' })
const wrap = () => render(<QueryClientProvider client={new QueryClient()}><DataPage /></QueryClientProvider>)
const file = (name: string, text: string, type = 'text/plain') => new File([text], name, { type })

// jsdom's File has no text(); read it the way a browser would.
beforeEach(() => {
  workspaces.length = 0
  for (const k of Object.keys(todoRows)) delete todoRows[k]
  Object.assign(sinkCalls, { workspaces: [], todos: [], failOn: 0 })
  download.mockReset(); signOut.mockReset(); getSession.mockReset()
  useVault.setState({ keys: {}, states: {} })
  useToasts.setState({ toasts: [] })
  if (!File.prototype.text) File.prototype.text = function (this: File) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Export', () => {
  it('downloads a backup of the chosen workspaces and says what it contained', async () => {
    workspaces.push(mk('w1', 'Home'), mk('w2', 'Work'))
    todoRows.w1 = [todo('a', 'w1', 'Buy milk')]; todoRows.w2 = [todo('b', 'w2', 'Send invoice')]
    wrap()
    fireEvent.click(screen.getByLabelText('Work')) // untick Work
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [blob, filename] = download.mock.calls[0]
    expect(filename).toMatch(/^todo-export-\d{4}-\d{2}-\d{2}\.json$/)
    const json = JSON.parse(await (blob as Blob).text())
    expect(json.todos.map((t: ExportTodo) => t.title)).toEqual(['Buy milk'])
    expect((await screen.findByText(/Exported 1 todo and 0 notes/)).textContent).toBeTruthy()
  })

  it('cannot export with nothing selected', () => {
    workspaces.push(mk('w1', 'Home'))
    wrap()
    fireEvent.click(screen.getByLabelText('Home'))
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers CSV for todos', async () => {
    workspaces.push(mk('w1', 'Home'))
    todoRows.w1 = [todo('a', 'w1', '=evil()')]
    wrap()
    fireEvent.click(screen.getByRole('radio', { name: /Todos \(CSV\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(download).toHaveBeenCalled())
    expect(download.mock.calls[0][1]).toMatch(/\.csv$/)
    expect(await (download.mock.calls[0][0] as Blob).text()).toContain("'=evil()") // formulas are defused
  })

  it('keeps private workspaces out unless they are unlocked and the user opts in', async () => {
    workspaces.push(mk('w1', 'Home'), priv('p1', 'Diary'), priv('p2', 'Vault'))
    todoRows.w1 = [todo('a', 'w1', 'plain')]; todoRows.p1 = [todo('s', 'p1', 'secret diary entry')]
    useVault.setState({ keys: { p1: {} as CryptoKey } })
    wrap()
    const box = screen.getByLabelText(/Include private workspaces/) as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(screen.getByText(/readable, unencrypted text/)).toBeTruthy()
    expect(screen.getByText(/Locked, so they can’t be included: Vault/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(await (download.mock.calls[0][0] as Blob).text()).not.toContain('secret diary entry')
    expect((await screen.findByText(/Not included: Diary, Vault/)).textContent).toBeTruthy()

    download.mockReset()
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const text = await (download.mock.calls[0][0] as Blob).text()
    expect(text).toContain('secret diary entry')
    expect(JSON.parse(text).meta.includesPrivate).toBe(true)
  })

  it('cannot include private workspaces when none are unlocked', () => {
    workspaces.push(mk('w1', 'Home'), priv('p1', 'Diary'))
    wrap()
    expect((screen.getByLabelText(/Include private workspaces/) as HTMLInputElement).disabled).toBe(true)
  })
})

describe('Import', () => {
  const backup = (todos: ExportTodo[]) => JSON.stringify({ format: FORMAT, version: 1, workspaces: [{ id: 'old', name: 'Old Home', color: '#ff0000' }], todos: todos.map((t) => ({ ...t, workspace_id: 'old' })), notes: [] })
  const choose = async (f: File) => { fireEvent.change(document.querySelector('input[type=file][accept*=json]')!, { target: { files: [f] } }); await screen.findByLabelText('Import preview').catch(() => undefined) }

  it('previews a backup, lets the user pick where it goes, and imports it', async () => {
    workspaces.push(mk('w1', 'Home'))
    wrap()
    await choose(file('backup.json', backup([todo('a', 'old', 'Buy milk'), todo('b', 'old', 'Call mom')])))
    const preview = await screen.findByLabelText('Import preview')
    expect(preview.textContent).toMatch(/2 todos in 1 group/)
    expect(preview.textContent).toMatch(/Imported todos don’t earn XP/)

    const select = within(preview).getByLabelText('Where to put Old Home') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['New workspace “Old Home”', 'Home'])
    fireEvent.change(select, { target: { value: 'w1' } })
    fireEvent.click(within(preview).getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(screen.getByText(/Done\. Added 2 todos/)).toBeTruthy())
    expect(sinkCalls.todos).toEqual(['w1:Buy milk', 'w1:Call mom'])
    expect(sinkCalls.workspaces).toEqual([])
  })

  it('creates a new workspace by default', async () => {
    wrap()
    await choose(file('backup.json', backup([todo('a', 'old', 'Task')])))
    fireEvent.click(within(await screen.findByLabelText('Import preview')).getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(screen.getByText(/creating 1 workspace/)).toBeTruthy())
    expect(sinkCalls.workspaces).toEqual(['Old Home'])
  })

  it('imports a spreadsheet and lists anything it had to guess', async () => {
    wrap()
    await choose(file('my tasks.csv', 'Task,Due\nPay rent,2026-10-31\nCall,next week'))
    const preview = await screen.findByLabelText('Import preview')
    expect(preview.textContent).toMatch(/2 todos/)
    expect(preview.textContent).toMatch(/New workspace “my tasks”/)
    expect(preview.textContent).toMatch(/1 thing to know about/)
  })

  it('explains files it cannot use, and never offers an import for them', async () => {
    wrap()
    fireEvent.change(document.querySelector('input[type=file][accept*=json]')!, { target: { files: [file('x.csv', 'foo,bar\n1,2')] } })
    expect((await screen.findByRole('alert')).textContent).toMatch(/No title column/)
    expect(screen.queryByLabelText('Import preview')).toBeNull()
    fireEvent.change(document.querySelector('input[type=file][accept*=json]')!, { target: { files: [file('x.json', '{"hello":1}')] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/exported from this app/))
  })

  it('rejects oversized files before reading them', async () => {
    wrap()
    const big = file('big.json', '{}')
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })
    fireEvent.change(document.querySelector('input[type=file][accept*=json]')!, { target: { files: [big] } })
    expect((await screen.findByRole('alert')).textContent).toMatch(/too large/)
  })

  it('on failure, says how much already went in', async () => {
    sinkCalls.failOn = 1
    wrap()
    const many = Array.from({ length: 450 }, (_, i) => todo(`t${i}`, 'old', `T${i}`))
    await choose(file('backup.json', backup(many)))
    fireEvent.click(within(await screen.findByLabelText('Import preview')).getByRole('button', { name: 'Import' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/database unavailable/)
    expect(screen.getByText(/Stopped part-way\. Added 200 todos/)).toBeTruthy()
  })

  it('does not offer locked private workspaces as a destination', async () => {
    workspaces.push(mk('w1', 'Home'), priv('p1', 'Vault'), priv('p2', 'Diary'))
    useVault.setState({ keys: { p2: {} as CryptoKey } })
    wrap()
    await choose(file('backup.json', backup([todo('a', 'old', 'x')])))
    const select = (await screen.findByLabelText('Where to put Old Home')) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['New workspace “Old Home”', 'Home', 'Diary (private)'])
  })
})

describe('Delete account', () => {
  const open = () => { fireEvent.click(screen.getByRole('button', { name: /Delete my account/ })); return screen.getByLabelText(/Type DELETE/) as HTMLInputElement }

  it('needs the exact word before the button works', () => {
    wrap()
    const input = open()
    const go = screen.getByRole('button', { name: 'Delete everything' }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'delete' } })
    expect(go.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'DELETE' } })
    expect(go.disabled).toBe(false)
  })

  it('deletes through the server, then clears this device and signs out', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted: true }) })
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('ai-config', '{"apiKey":"secret"}'); localStorage.setItem('unrelated', 'keep')
    useVault.setState({ keys: { w1: {} as CryptoKey } })
    wrap()
    fireEvent.change(open(), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }))
    await waitFor(() => expect(signOut).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/functions\/v1\/delete-account$/)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirm: 'DELETE' })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
    expect(useVault.getState().keys).toEqual({})
    expect(localStorage.getItem('ai-config')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
  })

  it('shows the problem and stays signed in when deletion fails', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Could not delete the account. Nothing was changed; please try again.' }) }))
    wrap()
    fireEvent.change(open(), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Nothing was changed/)
    expect(signOut).not.toHaveBeenCalled()
  })
})
