// A tiny key-value store for offline data. Uses IndexedDB (survives reloads and handles large values); if the browser
// refuses it (some private-browsing modes), it quietly falls back to memory so the app still works for the session.

export interface KV {
  get<T>(store: string, key: string): Promise<T | undefined>
  set(store: string, key: string, value: unknown): Promise<void>
  delete(store: string, key: string): Promise<void>
  /** Every entry in a store, ordered by key. */
  entries<T>(store: string): Promise<[string, T][]>
  clear(store: string): Promise<void>
}

export class MemoryKV implements KV {
  private data = new Map<string, Map<string, unknown>>()
  private table(store: string) {
    let t = this.data.get(store)
    if (!t) this.data.set(store, (t = new Map()))
    return t
  }
  async get<T>(store: string, key: string) { return this.table(store).get(key) as T | undefined }
  async set(store: string, key: string, value: unknown) { this.table(store).set(key, structuredClone(value)) }
  async delete(store: string, key: string) { this.table(store).delete(key) }
  async entries<T>(store: string) { return [...this.table(store)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) as [string, T][] }
  async clear(store: string) { this.table(store).clear() }
}

const DB_NAME = 'todo-app-offline'
const STORES = ['outbox', 'cache'] as const

const request = <T,>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })

export class IndexedDbKV implements KV {
  private db: Promise<IDBDatabase>
  constructor(factory: IDBFactory = indexedDB) {
    this.db = new Promise((resolve, reject) => {
      const open = factory.open(DB_NAME, 1)
      open.onupgradeneeded = () => { for (const s of STORES) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s) }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
      open.onblocked = () => reject(new Error('IndexedDB is blocked'))
    })
  }
  private async store(name: string, mode: IDBTransactionMode) { return (await this.db).transaction(name, mode).objectStore(name) }
  async get<T>(store: string, key: string) { return request<T | undefined>((await this.store(store, 'readonly')).get(key)) }
  async set(store: string, key: string, value: unknown) { await request((await this.store(store, 'readwrite')).put(value, key)) }
  async delete(store: string, key: string) { await request((await this.store(store, 'readwrite')).delete(key)) }
  async clear(store: string) { await request((await this.store(store, 'readwrite')).clear()) }
  async entries<T>(store: string) {
    const s = await this.store(store, 'readonly')
    const [keys, values] = await Promise.all([request(s.getAllKeys()), request(s.getAll())])
    return keys.map((k, i) => [String(k), values[i] as T] as [string, T]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  }
}

/** IndexedDB if it works here, otherwise memory. */
export function createKV(): KV {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryKV()
    const kv = new IndexedDbKV()
    // If opening fails later (blocked, quota), every call falls back to a memory store.
    const fallback = new MemoryKV()
    let broken = false
    const guard = <T,>(fn: (k: KV) => Promise<T>) => (broken ? fn(fallback) : fn(kv).catch(() => { broken = true; return fn(fallback) }))
    return {
      get: (s, k) => guard((x) => x.get(s, k)), set: (s, k, v) => guard((x) => x.set(s, k, v)), delete: (s, k) => guard((x) => x.delete(s, k)),
      entries: (s) => guard((x) => x.entries(s)), clear: (s) => guard((x) => x.clear(s)),
    } as KV
  } catch {
    return new MemoryKV()
  }
}
