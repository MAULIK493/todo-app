import { create } from 'zustand'

export type Toast = { id: number; message: string; action?: { label: string; onClick: () => void } }

type ToastState = {
  toasts: Toast[]
  push: (message: string, action?: Toast['action']) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, action) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, action }] }))
    setTimeout(() => get().dismiss(id), 6000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
