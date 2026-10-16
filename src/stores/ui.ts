import { create } from 'zustand'

const KEY = 'sidebar-collapsed'
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

/** Small layout preferences for this device. */
export const useUi = create<{ sidebarCollapsed: boolean; toggleSidebar: () => void }>((set, get) => ({
  sidebarCollapsed: read(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* storage unavailable */ }
    set({ sidebarCollapsed: next })
  },
}))
