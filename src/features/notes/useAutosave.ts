import { useCallback, useEffect, useRef, useState } from 'react'
import { ConflictError, type NotePatch } from './api'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'
export type Pending = NotePatch & { tags?: string[] }

type SaveFn = (v: { expectedUpdatedAt: string; patch: NotePatch; tags?: string[] }) => Promise<string>

/**
 * Debounced autosave for one note. Edits merge into a single pending patch; saves run one at a time so
 * each uses the `updated_at` returned by the previous one (the server rejects stale writes).
 */
export function useAutosave(initialUpdatedAt: string, save: SaveFn, delayMs = 800) {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const pending = useRef<Pending | null>(null)
  const updatedAt = useRef(initialUpdatedAt)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const stopped = useRef(false) // set after a conflict: further writes would clobber the other version
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current)
    chain.current = chain.current.then(async () => {
      const batch = pending.current
      if (!batch || stopped.current) return
      pending.current = null
      setStatus('saving')
      const { tags, ...patch } = batch
      try {
        updatedAt.current = await saveRef.current({ expectedUpdatedAt: updatedAt.current, patch, tags })
        setStatus(pending.current ? 'dirty' : 'saved')
      } catch (e) {
        // Put the edits back so a retry (or the next keystroke) includes them.
        const newer = pending.current as Pending | null // edits made while this save was in flight
        pending.current = { ...batch, ...newer }
        if (e instanceof ConflictError) {
          stopped.current = true
          setStatus('conflict')
        } else {
          setStatus('error')
          timer.current = setTimeout(() => void flush(), 3000)
        }
      }
    })
    return chain.current
  }, [])

  const queue = useCallback((patch: Pending, immediate = false) => {
    if (stopped.current) return
    pending.current = { ...pending.current, ...patch }
    setStatus('dirty')
    clearTimeout(timer.current)
    if (immediate) void flush()
    else timer.current = setTimeout(() => void flush(), delayMs)
  }, [flush, delayMs])

  // Flush on unmount (switching notes) and when the tab is closed or hidden.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide as never)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide as never)
      void flush()
    }
  }, [flush])

  return { status, queue, flush }
}
