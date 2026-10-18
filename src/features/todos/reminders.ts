import { useEffect } from 'react'
import { cipherFor } from '@/features/security/vault'
import { supabase } from '@/lib/supabase'
import { useToasts } from '@/stores/toasts'

const POLL_MS = 20_000
/** Reminders older than this are not announced (e.g. the app was closed all day). */
const MAX_AGE_MS = 24 * 3_600_000
const FIRED_KEY = 'reminders-fired'

const readFired = (): string[] => {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[] } catch { return [] }
}
const writeFired = (keys: string[]) => {
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(keys.slice(-200))) } catch { /* ignore */ }
}

export const notificationsSupported = () => typeof Notification !== 'undefined'

/** Must be called from a click/tap: browsers only show the permission prompt after a user gesture. */
export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try { return await Notification.requestPermission() } catch { return Notification.permission }
}

let ctx: AudioContext | null = null
const audio = () => (ctx ??= new AudioContext())

// Browsers only let a page make sound after the person has interacted with it once.
export function unlockAudio() {
  try { void audio().resume() } catch { /* no audio */ }
}

/** A short, clearly audible three-note alert. Always plays: a reminder you cannot hear is no reminder. */
export function playReminderSound() {
  try {
    const c = audio()
    void c.resume()
    ;[784, 988, 1175, 784, 988, 1175].forEach((freq, i) => {
      const osc = c.createOscillator()
      const gain = c.createGain()
      const t = c.currentTime + i * 0.22
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
      osc.connect(gain).connect(c.destination)
      osc.start(t)
      osc.stop(t + 0.22)
    })
  } catch { /* audio unavailable */ }
}

async function showSystemNotification(title: string, body: string, tag: string) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false
  const options: NotificationOptions & { vibrate?: number[] } = {
    body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', vibrate: [200, 100, 200, 100, 200],
  }
  try {
    // Phones (Android Chrome) only allow notifications through the service worker.
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg?.active) { await reg.showNotification(title, options); return true }
  } catch { /* fall back to the page API */ }
  try { new Notification(title, options); return true } catch { return false }
}

/** Asks permission (from a click), then plays the sound and shows a sample notification. Returns a message for the person. */
export async function testNotification(): Promise<string> {
  unlockAudio()
  playReminderSound()
  const perm = await ensureNotificationPermission()
  if (perm === 'unsupported') return 'This browser does not support notifications.'
  if (perm === 'denied') return 'Notifications are blocked. Allow them in the site settings (lock icon in the address bar), then try again.'
  if (perm !== 'granted') return 'Permission was not granted.'
  const ok = await showSystemNotification('Reminder', 'Notifications are working.', 'test')
  return ok ? 'Sent. If nothing appeared, check your system Focus / Do Not Disturb and browser notification settings.' : 'Could not show the notification.'
}

type Row = { id: string; workspace_id: string; title: string; reminder_at: string }

async function checkDue() {
  const now = Date.now()
  const { data, error } = await supabase
    .from('todos')
    .select('id, workspace_id, title, reminder_at')
    .not('reminder_at', 'is', null)
    .neq('status', 'done')
    .lte('reminder_at', new Date(now).toISOString())
    .gte('reminder_at', new Date(now - MAX_AGE_MS).toISOString())
  if (error || !data) return
  const fired = readFired()
  const fresh = (data as Row[]).filter((r) => !fired.includes(`${r.id}@${r.reminder_at}`))
  if (!fresh.length) return
  writeFired([...fired, ...fresh.map((r) => `${r.id}@${r.reminder_at}`)])
  playReminderSound()
  for (const r of fresh) {
    const c = cipherFor(r.workspace_id)
    const title = c ? await c.readText('title', r.title).catch(() => 'Private todo') : r.title
    useToasts.getState().push(`⏰ Reminder: ${title}`)
    void showSystemNotification('Reminder', title, `${r.id}@${r.reminder_at}`)
  }
}

/** While the app is open, announces reminders as they come due: system notification, sound and an in-app toast. */
export function useReminders() {
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    const run = () => { void checkDue().catch(() => undefined) }
    run()
    const id = setInterval(run, POLL_MS)
    document.addEventListener('visibilitychange', run)
    window.addEventListener('online', run)
    return () => {
      clearInterval(id)
      window.removeEventListener('pointerdown', unlock)
      document.removeEventListener('visibilitychange', run)
      window.removeEventListener('online', run)
    }
  }, [])
}
