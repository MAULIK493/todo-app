import { ExternalLink, Eye, EyeOff } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/cn'
import { testConnection } from './llm'
import { useFreeStatus } from './llm/free'
import { useAiConfig } from './llm/config'
import { PROVIDERS, providerById } from './llm/providers'

type Status = { state: 'idle' } | { state: 'testing' } | { state: 'ok' } | { state: 'error'; message: string }

/** Where the person chooses which AI service answers, and pastes their own key for it. */
export function ProviderSettings() {
  const cfg = useAiConfig()
  const provider = providerById(cfg.provider)
  const [show, setShow] = useState(false)
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const keyId = useId()
  const modelId = useId()
  const listId = useId()

  const reset = () => setStatus({ state: 'idle' })
  const test = async () => {
    setStatus({ state: 'testing' })
    const r = await testConnection(useAiConfig.getState())
    setStatus(r.ok ? { state: 'ok' } : { state: 'error', message: r.message })
  }

  return (
    <section aria-label="AI provider" className="space-y-3">
      <div>
        <h3 className="font-medium">Which AI should answer?</h3>
        <p className="mt-0.5 text-xs text-muted">The free assistant works straight away. If you use it a lot, or want a particular model, you can switch to your own key.</p>
      </div>

      <div role="radiogroup" aria-label="Assistant mode" className="grid grid-cols-2 gap-2">
        {([['free', 'Free assistant', 'No setup'], ['own', 'My own key', 'No daily limit']] as const).map(([id, label, hint]) => (
          <label key={id} className={cn('glass cursor-pointer rounded-xl p-2.5 text-center', cfg.mode === id && 'ring-2 ring-accent')}>
            <input type="radio" name="mode" className="sr-only" checked={cfg.mode === id} onChange={() => { cfg.setMode(id); reset() }} />
            <span className="block font-medium">{label}</span>
            <span className="block text-xs text-muted">{hint}</span>
          </label>
        ))}
      </div>

      {cfg.mode === 'free' ? <FreeInfo /> : (<>

      <div role="radiogroup" aria-label="AI service" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PROVIDERS.map((p) => (
          <label key={p.id} className={cn('glass cursor-pointer rounded-xl p-2.5', cfg.provider === p.id && 'ring-2 ring-accent')}>
            <input type="radio" name="provider" className="sr-only" checked={cfg.provider === p.id} onChange={() => { cfg.setProvider(p.id); reset() }} />
            <span className="flex items-center justify-between gap-2 font-medium">
              {p.name}
              {p.free && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-normal text-emerald-300">{p.free}</span>}
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted">{provider.note}</p>

      <div className="space-y-1">
        <label htmlFor={keyId} className="flex items-center justify-between gap-2 text-xs text-muted">
          <span>{provider.name} API key</span>
          <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Get a key <ExternalLink size={11} aria-hidden /></a>
        </label>
        <div className="glass flex items-center gap-1 rounded-lg pr-1">
          <input
            id={keyId} type={show ? 'text' : 'password'} value={cfg.apiKey} autoComplete="off" spellCheck={false} placeholder="Paste your key here"
            onChange={(e) => { cfg.setKey(e.target.value); reset() }} className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none"
          />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide key' : 'Show key'} className="rounded p-1.5 text-muted hover:text-text">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={modelId} className="text-xs text-muted">Model</label>
        <input
          id={modelId} list={listId} value={cfg.model} spellCheck={false} onChange={(e) => { cfg.setModel(e.target.value); reset() }}
          className="glass w-full rounded-lg px-3 py-2 outline-none"
        />
        <datalist id={listId}>{provider.models.map((m) => <option key={m} value={m} />)}</datalist>
      </div>

      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={cfg.remember} onChange={(e) => cfg.setRemember(e.target.checked)} />
        <span>Keep my key on this device. Otherwise it is forgotten when you close the tab. It is never saved to your account, and it is removed when you sign out.</span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void test()} disabled={!cfg.apiKey || status.state === 'testing'} className="rounded-lg bg-accent px-3 py-1.5 text-white disabled:opacity-50">
          {status.state === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        {cfg.apiKey && <button type="button" onClick={() => { cfg.clearKey(); reset() }} className="glass rounded-lg px-3 py-1.5">Remove key</button>}
        <span role="status" aria-live="polite" className="text-xs">
          {status.state === 'ok' && <span className="text-emerald-300">Works. You are ready to chat.</span>}
          {status.state === 'error' && <span className="text-red-300">{status.message}</span>}
        </span>
      </div>

      <p className="text-xs text-muted">
        Your key is sent only to {provider.name}, straight from this browser. The messages you send, and the todos and notes the assistant looks up to answer them, go to {provider.name} too, under its own terms.
      </p>
      </>)}
    </section>
  )
}

function FreeInfo() {
  const { data, isLoading } = useFreeStatus(true)
  const left = data && data.available ? Math.max(0, data.dailyRequests - data.used) : null
  return (
    <div className="space-y-2 text-xs">
      {isLoading && <p className="text-muted">Checking…</p>}
      {data && !data.available && (
        <p role="status" className="rounded-lg bg-amber-500/15 p-2.5 text-amber-300">The free assistant is not available right now. Switch to “My own key” to keep using the assistant.</p>
      )}
      {data?.available && (
        <p role="status" className="text-muted">
          Free to use, with a daily allowance{left !== null ? <>: <span className="text-text">{left} of {data.dailyRequests}</span> left today</> : null}. It resets every day. Each reply uses one or two.
        </p>
      )}
      <p className="text-muted">
        Free mode sends your messages, and the todos and notes the assistant looks up to answer them, through our server to {data?.provider ?? 'a free AI service'}. We do not store or read them. Free models can make more mistakes than paid ones.
      </p>
    </div>
  )
}
