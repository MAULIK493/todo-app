import { useEffect, useSyncExternalStore } from 'react'
import { detectEnv } from './effects'
import { useAppearance } from './store'

type Battery = EventTarget & { level: number; charging: boolean }

/** Keeps the store's picture of the device (reduced motion, battery, data saver) current. */
export function useEnvWatcher() {
  useEffect(() => {
    let battery: Battery | undefined
    const update = () =>
      useAppearance.getState().setEnv(detectEnv(window as unknown as Parameters<typeof detectEnv>[0], battery && { level: battery.level, charging: battery.charging }))

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    mq.addEventListener('change', update)
    const nav = navigator as Navigator & { getBattery?: () => Promise<Battery> }
    void nav.getBattery?.().then((b) => {
      battery = b
      b.addEventListener('levelchange', update)
      b.addEventListener('chargingchange', update)
      update()
    }).catch(() => undefined)
    update()

    return () => {
      mq.removeEventListener('change', update)
      battery?.removeEventListener('levelchange', update)
      battery?.removeEventListener('chargingchange', update)
    }
  }, [])
}

/** True while the tab is visible. Animations pause when it isn't. */
export function usePageVisible() {
  return useSyncExternalStore(
    (cb) => { document.addEventListener('visibilitychange', cb); return () => document.removeEventListener('visibilitychange', cb) },
    () => document.visibilityState === 'visible',
    () => true,
  )
}
