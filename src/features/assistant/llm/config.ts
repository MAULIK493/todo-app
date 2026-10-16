import { create } from 'zustand'
import { isProviderId, providerById, type ProviderId } from './providers'

// The person's own AI key lives only in this browser. With "keep on this device" it is saved in local storage;
// without it, in session storage, which disappears when the tab is closed. It is never saved to the account, and
// it is removed on sign out.

const CONFIG_KEY = 'ai-config'
const SESSION_KEY = 'ai-session-key'

/** `free` uses the app's own free assistant (no setup, daily allowance); `own` uses the person's own key. */
export type AiMode = 'free' | 'own'
export type AiConfig = { mode: AiMode; provider: ProviderId; model: string; apiKey: string; remember: boolean }

const DEFAULT: AiConfig = { mode: 'free', provider: 'gemini', model: providerById('gemini').defaultModel, apiKey: '', remember: true }

const get = (s: Storage | undefined, k: string) => { try { return s?.getItem(k) ?? null } catch { return null } }
const put = (s: Storage | undefined, k: string, v: string) => { try { s?.setItem(k, v) } catch { /* storage unavailable */ } }
const del = (s: Storage | undefined, k: string) => { try { s?.removeItem(k) } catch { /* storage unavailable */ } }
const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage)
const session = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)

export function readConfig(): AiConfig {
  try {
    const raw = JSON.parse(get(local(), CONFIG_KEY) ?? 'null') as Partial<AiConfig> | null
    const provider = isProviderId(raw?.provider) ? raw.provider : DEFAULT.provider
    const remember = raw?.remember !== false
    const key = remember ? (typeof raw?.apiKey === 'string' ? raw.apiKey : '') : (get(session(), SESSION_KEY) ?? '')
    return {
      mode: raw?.mode === 'own' ? 'own' : 'free', provider, remember, apiKey: key,
      model: typeof raw?.model === 'string' && raw.model.trim() ? raw.model.trim().slice(0, 100) : providerById(provider).defaultModel,
    }
  } catch {
    return DEFAULT
  }
}

function save(c: AiConfig) {
  put(local(), CONFIG_KEY, JSON.stringify({ mode: c.mode, provider: c.provider, model: c.model, remember: c.remember, ...(c.remember ? { apiKey: c.apiKey } : {}) }))
  if (c.remember) del(session(), SESSION_KEY)
  else if (c.apiKey) put(session(), SESSION_KEY, c.apiKey)
  else del(session(), SESSION_KEY)
}

type State = AiConfig & {
  setMode: (m: AiMode) => void
  /** Switching provider starts that provider's own default model and an empty key: keys are not interchangeable. */
  setProvider: (p: ProviderId) => void
  setModel: (m: string) => void
  setKey: (k: string) => void
  setRemember: (r: boolean) => void
  /** Forget the key (sign out, or the person asks). The provider and model choice stay. */
  clearKey: () => void
}

export const useAiConfig = create<State>((set, getState) => {
  const update = (patch: Partial<AiConfig>) => { set(patch); save({ ...getState(), ...patch }) }
  return {
    ...readConfig(),
    setMode: (mode) => update({ mode }),
    setProvider: (provider) => update({ provider, model: providerById(provider).defaultModel, apiKey: '' }),
    setModel: (model) => update({ model }),
    setKey: (apiKey) => update({ apiKey: apiKey.trim() }),
    setRemember: (remember) => update({ remember }),
    clearKey: () => update({ apiKey: '' }),
  }
})

export const hasAiKey = () => useAiConfig.getState().apiKey.length > 0

/** Whether a request could be made right now: the free assistant needs nothing; your own key needs a key. */
export const isAiConfigured = (c: Pick<AiConfig, 'mode' | 'apiKey'>) => c.mode === 'free' || c.apiKey.length > 0
export const clearAiKey = () => useAiConfig.getState().clearKey()
