import { create } from 'zustand'
import { queryClient } from '@/lib/queryClient'
import { decryptWorkspaceContent, encryptWorkspaceContent } from './convert'
import { dropDecryptedData } from './vault'

export type ConversionStatus = { running: boolean; done: number; total: number; error: string | null }

/** Progress of in-flight conversions, shared by whichever screen is showing them. */
export const useConversion = create<Record<string, ConversionStatus>>(() => ({}))

const set = (ws: string, status: ConversionStatus | null) =>
  useConversion.setState((s) => {
    const { [ws]: _old, ...rest } = s
    return status ? { ...rest, [ws]: status } : rest
  })

/** Starts (or resumes) a conversion. Safe to call repeatedly: a second call while one is running does nothing. */
export async function runConversion(ws: string, key: CryptoKey, direction: 'encrypt' | 'decrypt') {
  if (useConversion.getState()[ws]?.running) return
  set(ws, { running: true, done: 0, total: 0, error: null })
  try {
    const engine = direction === 'encrypt' ? encryptWorkspaceContent : decryptWorkspaceContent
    await engine(ws, key, (done, total) => set(ws, { running: true, done, total, error: null }))
    // Cached rows are in the old form (plaintext or ciphertext); make every list reload.
    dropDecryptedData()
    await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    set(ws, null)
  } catch (e) {
    set(ws, { running: false, done: 0, total: 0, error: e instanceof Error ? e.message : 'Something went wrong' })
  }
}
