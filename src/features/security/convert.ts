import { docToText } from '@/features/notes/docText'
import { applyBatch, finishLock, finishUnlock, pendingBatch, pendingCounts } from './api'
import { decryptJson, decryptText, encryptJson, encryptText, isEncrypted, isEncryptedJson } from './crypto'

/**
 * Converts a workspace's existing content between plaintext and ciphertext in small batches.
 * Every step is idempotent and the server tracks what is left, so an interrupted run can simply be started again.
 */
export type ConvertDeps = Pick<typeof import('./api'), 'pendingCounts' | 'pendingBatch' | 'applyBatch'>
export type Progress = (done: number, total: number) => void

const defaultDeps: ConvertDeps = { pendingCounts, pendingBatch, applyBatch }

// Server-side limit for a stored note is 1,000,000 bytes; base64 + envelope adds ~35%.
export const MAX_PRIVATE_NOTE_CHARS = 700_000

export class ConversionError extends Error {}

const BATCH = 100

export async function encryptWorkspaceContent(
  ws: string, key: CryptoKey, onProgress: Progress = () => {}, deps: ConvertDeps = defaultDeps,
) {
  const counts = await deps.pendingCounts(ws)
  const total = counts.plain_todos + counts.plain_notes
  let done = 0
  onProgress(0, total)

  for (;;) {
    const batch = await deps.pendingBatch('encryption', ws, BATCH)
    if (batch.todos.length === 0 && batch.notes.length === 0) break

    const todos = await Promise.all(batch.todos.map(async (t) => ({
      id: t.id,
      title: isEncrypted(t.title) ? t.title : await encryptText(key, ws, 'title', t.title),
      description: !t.description || isEncrypted(t.description) ? t.description : await encryptText(key, ws, 'description', t.description),
    })))

    const notes = []
    for (const n of batch.notes) {
      if (!isEncryptedJson(n.content) && JSON.stringify(n.content).length > MAX_PRIVATE_NOTE_CHARS) {
        throw new ConversionError('A note is too large to encrypt (over about 700 KB). Shorten or split it, then try again.')
      }
      notes.push({
        id: n.id,
        title: isEncrypted(n.title) ? n.title : await encryptText(key, ws, 'title', n.title),
        content: isEncryptedJson(n.content) ? n.content : await encryptJson(key, ws, 'content', n.content),
        content_text: '', // search text would reveal the content
      })
    }

    const applied = await deps.applyBatch(ws, todos, notes)
    if (applied.todos + applied.notes === 0) throw new ConversionError('Encryption made no progress; please try again.')
    done += todos.length + notes.length
    onProgress(Math.min(done, total), total)
  }
  await finishLock(ws)
}

export async function decryptWorkspaceContent(
  ws: string, key: CryptoKey, onProgress: Progress = () => {}, deps: ConvertDeps = defaultDeps,
) {
  const counts = await deps.pendingCounts(ws)
  const total = counts.enc_todos + counts.enc_notes
  let done = 0
  onProgress(0, total)

  for (;;) {
    const batch = await deps.pendingBatch('decryption', ws, BATCH)
    if (batch.todos.length === 0 && batch.notes.length === 0) break

    try {
      const todos = await Promise.all(batch.todos.map(async (t) => ({
        id: t.id,
        title: isEncrypted(t.title) ? await decryptText(key, ws, 'title', t.title) : t.title,
        description: isEncrypted(t.description) ? await decryptText(key, ws, 'description', t.description) : t.description,
      })))
      const notes = await Promise.all(batch.notes.map(async (n) => {
        const content = isEncryptedJson(n.content) ? await decryptJson<unknown>(key, ws, 'content', n.content) : n.content
        return {
          id: n.id,
          title: isEncrypted(n.title) ? await decryptText(key, ws, 'title', n.title) : n.title,
          content,
          content_text: docToText(content),
        }
      }))
      const applied = await deps.applyBatch(ws, todos, notes)
      if (applied.todos + applied.notes === 0) throw new ConversionError('Decryption made no progress; please try again.')
      done += todos.length + notes.length
    } catch (e) {
      if (e instanceof ConversionError) throw e
      // A value that fails authentication was corrupted or encrypted with another key. Finishing would lose it.
      throw new ConversionError('Some content could not be decrypted, so the lock was left in place. Your data is unchanged.')
    }
    onProgress(Math.min(done, total), total)
  }
  await finishUnlock(ws)
}
