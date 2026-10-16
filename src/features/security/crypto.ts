/**
 * Client-side encryption for private workspaces. Nothing here ever leaves the browser unencrypted.
 *
 * Key hierarchy:
 *   secret (PIN / pattern / password) --PBKDF2-SHA256--> KEK  --AES-GCM--> wrapped workspace key (stored on the server)
 *   recovery key (random, 160-bit)    --HKDF-SHA256----> RKEK --AES-GCM--> a second wrapped copy of the same key
 *   workspace key (random, 256-bit, AES-GCM) encrypts every todo/note field of that workspace.
 *
 * The server stores only salts, parameters and wrapped keys. A wrong code simply fails AES-GCM authentication,
 * so no separate verifier is stored.
 */

export type LockType = 'pin' | 'pattern' | 'password'

/** Server-stored lock material (all base64 / plain, none of it secret on its own). */
export type LockParams = {
  lock_type: LockType
  lock_salt: string
  lock_iterations: number
  wrapped_key: string
  recovery_salt: string | null
  recovery_wrapped_key: string | null
}

export const PBKDF2_ITERATIONS = 600_000
export const ENC_PREFIX = 'enc:v1:'

export class WrongCodeError extends Error {
  constructor() {
    super('Incorrect code')
  }
}

export class DecryptError extends Error {
  constructor() {
    super('Could not decrypt: the data is corrupted or was encrypted with a different key')
  }
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const subtle = () => globalThis.crypto.subtle

// ---- encoding helpers ----

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

export function toB64(bytes: Uint8Array): string {
  let s = ''
  // Chunked so large notes don't overflow the argument limit of fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---- key derivation ----

/** Domain-separates the three code types and normalises unicode so the same code always derives the same key. */
export const secretFor = (type: LockType, secret: string) => `${type}:${secret.normalize('NFKC')}`

export async function deriveKek(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

async function deriveRecoveryKek(recovery: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  // The recovery key is already high-entropy random, so a fast KDF (HKDF) is appropriate.
  const base = await subtle().importKey('raw', recovery, 'HKDF', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('workspace-recovery-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

// ---- wrapping the workspace key ----

async function wrapRaw(raw: Uint8Array<ArrayBuffer>, kek: CryptoKey): Promise<string> {
  const iv = randomBytes(12)
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, kek, raw))
  return `v1.${toB64(iv)}.${toB64(ct)}`
}

async function unwrapRaw(wrapped: string, kek: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const [v, iv, ct] = wrapped.split('.')
  if (v !== 'v1' || !iv || !ct) throw new WrongCodeError()
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, kek, fromB64(ct)))
  } catch {
    throw new WrongCodeError() // GCM tag mismatch: wrong code (or tampered key)
  }
}

/** The in-memory working key: non-extractable, so scripts can use it but not read it out. */
const importWorkspaceKey = (raw: Uint8Array<ArrayBuffer>) =>
  subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

// ---- recovery key (Crockford base32, 32 chars = 160 bits) ----

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateRecoveryKey(): string {
  const bytes = randomBytes(20)
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out.match(/.{4}/g)!.join('-')
}

/** Accepts the key as typed: any case, with or without dashes/spaces, and tolerates the easily-confused O/I/L. */
export function parseRecoveryKey(input: string): Uint8Array<ArrayBuffer> | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (clean.length !== 32) return null
  const out = new Uint8Array(20)
  let bits = 0
  let value = 0
  let i = 0
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) return null
    value = ((value << 5) | idx) & 0xffff
    bits += 5
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 255
      bits -= 8
    }
  }
  return out
}

// ---- creating / opening / changing a lock ----

export type NewLock = { type: LockType; secret: string; withRecovery: boolean; iterations?: number }

async function buildParams(raw: Uint8Array<ArrayBuffer>, next: NewLock): Promise<{ params: LockParams; recoveryKey: string | null }> {
  const iterations = next.iterations ?? PBKDF2_ITERATIONS
  const salt = randomBytes(16)
  const kek = await deriveKek(secretFor(next.type, next.secret), salt, iterations)
  let recovery: Pick<LockParams, 'recovery_salt' | 'recovery_wrapped_key'> = { recovery_salt: null, recovery_wrapped_key: null }
  let recoveryKey: string | null = null
  if (next.withRecovery) {
    recoveryKey = generateRecoveryKey()
    const rsalt = randomBytes(16)
    const rkek = await deriveRecoveryKek(parseRecoveryKey(recoveryKey)!, rsalt)
    recovery = { recovery_salt: toB64(rsalt), recovery_wrapped_key: await wrapRaw(raw, rkek) }
  }
  return {
    params: { lock_type: next.type, lock_salt: toB64(salt), lock_iterations: iterations, wrapped_key: await wrapRaw(raw, kek), ...recovery },
    recoveryKey,
  }
}

/** New random workspace key, wrapped under the user's code (and optionally a recovery key). */
export async function createWorkspaceLock(next: NewLock) {
  const raw = randomBytes(32)
  const { params, recoveryKey } = await buildParams(raw, next)
  const key = await importWorkspaceKey(raw)
  raw.fill(0)
  return { params, recoveryKey, key }
}

export async function unlockWithSecret(params: LockParams, secret: string): Promise<CryptoKey> {
  const kek = await deriveKek(secretFor(params.lock_type, secret), fromB64(params.lock_salt), params.lock_iterations)
  const raw = await unwrapRaw(params.wrapped_key, kek)
  const key = await importWorkspaceKey(raw)
  raw.fill(0)
  return key
}

export async function unlockWithRecoveryKey(params: LockParams, recoveryKey: string): Promise<CryptoKey> {
  const raw = await unwrapWithRecovery(params, recoveryKey)
  const key = await importWorkspaceKey(raw)
  raw.fill(0)
  return key
}

async function unwrapWithRecovery(params: LockParams, recoveryKey: string) {
  const bytes = parseRecoveryKey(recoveryKey)
  if (!bytes || !params.recovery_salt || !params.recovery_wrapped_key) throw new WrongCodeError()
  const rkek = await deriveRecoveryKek(bytes, fromB64(params.recovery_salt))
  return unwrapRaw(params.recovery_wrapped_key, rkek)
}

/**
 * Change the code (or issue a fresh recovery key). The current code, or the recovery key, is needed
 * because the working key held in memory is deliberately non-extractable.
 */
export async function rewrapLock(
  params: LockParams,
  current: { secret: string } | { recoveryKey: string },
  next: NewLock,
) {
  const raw = 'secret' in current
    ? await unwrapRaw(params.wrapped_key, await deriveKek(secretFor(params.lock_type, current.secret), fromB64(params.lock_salt), params.lock_iterations))
    : await unwrapWithRecovery(params, current.recoveryKey)
  const result = await buildParams(raw, next)
  raw.fill(0)
  return result
}

/** Raw check used before destructive actions: does this code open the lock? */
export async function verifySecret(params: LockParams, secret: string): Promise<boolean> {
  try {
    await unlockWithSecret(params, secret)
    return true
  } catch {
    return false
  }
}

// ---- encrypting content ----

export const isEncrypted = (s: string) => s.startsWith(ENC_PREFIX)

/** AAD ties a ciphertext to its workspace and field, so values can't be swapped between workspaces or columns. */
const aad = (workspaceId: string, field: string) => enc.encode(`${workspaceId}:${field}`)

async function seal(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>, workspaceId: string, field: string) {
  const iv = randomBytes(12)
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(workspaceId, field) }, key, bytes))
  return { iv: toB64(iv), ct: toB64(ct) }
}

async function open(key: CryptoKey, iv: string, ct: string, workspaceId: string, field: string) {
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: aad(workspaceId, field) }, key, fromB64(ct)))
  } catch {
    throw new DecryptError()
  }
}

export async function encryptText(key: CryptoKey, workspaceId: string, field: string, plaintext: string): Promise<string> {
  const { iv, ct } = await seal(key, enc.encode(plaintext), workspaceId, field)
  return `${ENC_PREFIX}${iv}:${ct}`
}

export async function decryptText(key: CryptoKey, workspaceId: string, field: string, stored: string): Promise<string> {
  if (!isEncrypted(stored)) throw new DecryptError()
  const [iv, ct] = stored.slice(ENC_PREFIX.length).split(':')
  if (!iv || !ct) throw new DecryptError()
  return dec.decode(await open(key, iv, ct, workspaceId, field))
}

/** jsonb-friendly envelope, used for note content. */
export type EncryptedJson = { enc: 'v1'; iv: string; ct: string }

export const isEncryptedJson = (v: unknown): v is EncryptedJson =>
  typeof v === 'object' && v !== null && (v as EncryptedJson).enc === 'v1' && typeof (v as EncryptedJson).iv === 'string'

export async function encryptJson(key: CryptoKey, workspaceId: string, field: string, value: unknown): Promise<EncryptedJson> {
  const { iv, ct } = await seal(key, enc.encode(JSON.stringify(value)), workspaceId, field)
  return { enc: 'v1', iv, ct }
}

export async function decryptJson<T>(key: CryptoKey, workspaceId: string, field: string, stored: EncryptedJson): Promise<T> {
  return JSON.parse(dec.decode(await open(key, stored.iv, stored.ct, workspaceId, field))) as T
}
