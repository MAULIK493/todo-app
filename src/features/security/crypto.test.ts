import { describe, expect, it } from 'vitest'
import {
  createWorkspaceLock, decryptJson, decryptText, DecryptError, encryptJson, encryptText, fromB64, generateRecoveryKey,
  isEncrypted, parseRecoveryKey, rewrapLock, toB64, unlockWithRecoveryKey, unlockWithSecret, verifySecret, WrongCodeError,
} from './crypto'

// Few iterations keep the suite fast; the production default (600k) is covered by the constant, not exercised here.
const FAST = { iterations: 1000 }
const WS = '11111111-1111-1111-1111-111111111111'

describe('base64', () => {
  it('round-trips, including large buffers', () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 256)
    expect(fromB64(toB64(big))).toEqual(big)
  })
})

describe('workspace lock', () => {
  it('unlocks with the right code and rejects a wrong one', async () => {
    const { params } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    await expect(unlockWithSecret(params, '482915')).resolves.toBeDefined()
    await expect(unlockWithSecret(params, '482916')).rejects.toBeInstanceOf(WrongCodeError)
    expect(await verifySecret(params, '482915')).toBe(true)
    expect(await verifySecret(params, 'nope')).toBe(false)
  })

  it('never stores the code or key in the server-visible params', async () => {
    const { params } = await createWorkspaceLock({ type: 'password', secret: 'correct horse battery', withRecovery: true, ...FAST })
    const blob = JSON.stringify(params)
    expect(blob).not.toContain('correct horse')
    expect(params.lock_iterations).toBe(1000)
  })

  it('uses a fresh salt and key every time', async () => {
    const a = await createWorkspaceLock({ type: 'pin', secret: '111222', withRecovery: false, ...FAST })
    const b = await createWorkspaceLock({ type: 'pin', secret: '111222', withRecovery: false, ...FAST })
    expect(a.params.lock_salt).not.toBe(b.params.lock_salt)
    expect(a.params.wrapped_key).not.toBe(b.params.wrapped_key)
  })

  it('keeps code types apart: the same characters as a different type do not unlock', async () => {
    const { params } = await createWorkspaceLock({ type: 'pin', secret: '123456', withRecovery: false, ...FAST })
    await expect(unlockWithSecret({ ...params, lock_type: 'password' }, '123456')).rejects.toBeInstanceOf(WrongCodeError)
  })

  it('treats equivalent unicode as the same password', async () => {
    const { params } = await createWorkspaceLock({ type: 'password', secret: 'café-secret', withRecovery: false, ...FAST })
    await expect(unlockWithSecret(params, 'café-secret')).resolves.toBeDefined()
  })

  it('rejects tampered wrapped keys', async () => {
    const { params } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    const [v, iv, ct] = params.wrapped_key.split('.')
    const bad = fromB64(ct)
    bad[0] ^= 1
    await expect(unlockWithSecret({ ...params, wrapped_key: `${v}.${iv}.${toB64(bad)}` }, '482915')).rejects.toBeInstanceOf(WrongCodeError)
  })
})

describe('recovery key', () => {
  it('has the expected shape and parses back, tolerating typing mistakes', () => {
    const k = generateRecoveryKey()
    expect(k).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    const bytes = parseRecoveryKey(k)!
    expect(bytes).toHaveLength(20)
    expect(parseRecoveryKey(k.toLowerCase().replaceAll('-', ' '))).toEqual(bytes)
    expect(parseRecoveryKey('too short')).toBeNull()
    expect(parseRecoveryKey(k.slice(0, -1) + 'U')).toBeNull() // U is not in the alphabet
  })

  it('generates distinct keys', () => {
    expect(generateRecoveryKey()).not.toBe(generateRecoveryKey())
  })

  it('opens the same workspace key as the code does', async () => {
    const { params, recoveryKey, key } = await createWorkspaceLock({ type: 'pattern', secret: '0-1-2-5-8-7', withRecovery: true, ...FAST })
    const viaRecovery = await unlockWithRecoveryKey(params, recoveryKey!)
    const sealed = await encryptText(key, WS, 'title', 'hello')
    expect(await decryptText(viaRecovery, WS, 'title', sealed)).toBe('hello')
    await expect(unlockWithRecoveryKey(params, generateRecoveryKey())).rejects.toBeInstanceOf(WrongCodeError)
  })

  it('is unavailable when it was not created', async () => {
    const { params } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    await expect(unlockWithRecoveryKey(params, generateRecoveryKey())).rejects.toBeInstanceOf(WrongCodeError)
  })
})

describe('changing the code', () => {
  it('keeps existing data readable and invalidates the old code', async () => {
    const { params, key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: true, ...FAST })
    const sealed = await encryptText(key, WS, 'title', 'secret todo')

    const next = await rewrapLock(params, { secret: '482915' }, { type: 'password', secret: 'a brand new passphrase', withRecovery: true, ...FAST })
    expect(next.recoveryKey).not.toBeNull()
    const reopened = await unlockWithSecret(next.params, 'a brand new passphrase')
    expect(await decryptText(reopened, WS, 'title', sealed)).toBe('secret todo')
    await expect(unlockWithSecret(next.params, '482915')).rejects.toBeInstanceOf(WrongCodeError)
  })

  it('works from the recovery key when the code is forgotten', async () => {
    const { params, recoveryKey, key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: true, ...FAST })
    const sealed = await encryptText(key, WS, 'title', 'still here')
    const next = await rewrapLock(params, { recoveryKey: recoveryKey! }, { type: 'pin', secret: '908172', withRecovery: false, ...FAST })
    expect(next.params.recovery_wrapped_key).toBeNull()
    const reopened = await unlockWithSecret(next.params, '908172')
    expect(await decryptText(reopened, WS, 'title', sealed)).toBe('still here')
  })

  it('refuses to rewrap with the wrong current code', async () => {
    const { params } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    await expect(rewrapLock(params, { secret: '000000' }, { type: 'pin', secret: '908172', withRecovery: false, ...FAST })).rejects.toBeInstanceOf(WrongCodeError)
  })
})

describe('content encryption', () => {
  it('round-trips text, including unicode and empty strings', async () => {
    const { key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    for (const text of ['', 'plain', 'नमस्ते 🌍 — “quotes”', 'x'.repeat(50_000)]) {
      const sealed = await encryptText(key, WS, 'title', text)
      expect(isEncrypted(sealed)).toBe(true)
      expect(sealed).not.toContain(text || '\u0000')
      expect(await decryptText(key, WS, 'title', sealed)).toBe(text)
    }
  })

  it('never produces the same ciphertext twice', async () => {
    const { key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    expect(await encryptText(key, WS, 'title', 'same')).not.toBe(await encryptText(key, WS, 'title', 'same'))
  })

  it('binds ciphertext to its workspace and field', async () => {
    const { key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    const sealed = await encryptText(key, WS, 'title', 'bound')
    await expect(decryptText(key, '22222222-2222-2222-2222-222222222222', 'title', sealed)).rejects.toBeInstanceOf(DecryptError)
    await expect(decryptText(key, WS, 'description', sealed)).rejects.toBeInstanceOf(DecryptError)
  })

  it('detects tampering and wrong keys', async () => {
    const a = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    const b = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    const sealed = await encryptText(a.key, WS, 'title', 'hello')
    await expect(decryptText(b.key, WS, 'title', sealed)).rejects.toBeInstanceOf(DecryptError)
    const flipped = sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    await expect(decryptText(a.key, WS, 'title', flipped)).rejects.toBeInstanceOf(DecryptError)
    await expect(decryptText(a.key, WS, 'title', 'not encrypted')).rejects.toBeInstanceOf(DecryptError)
  })

  it('round-trips JSON (note content)', async () => {
    const { key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, ...FAST })
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'private note' }] }] }
    const sealed = await encryptJson(key, WS, 'content', doc)
    expect(JSON.stringify(sealed)).not.toContain('private note')
    expect(await decryptJson(key, WS, 'content', sealed)).toEqual(doc)
  })
})
