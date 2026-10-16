import { describe, expect, it } from 'vitest'
import { buildTranscriptionForm, checkAudio, extensionFor, MAX_AUDIO_BYTES, parseTranscript, readSttConfig, toIso639 } from './stt.ts'

describe('checkAudio', () => {
  it('accepts short audio clips in the formats browsers record', () => {
    for (const t of ['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg; codecs=opus', 'audio/mp4', 'audio/wav']) expect(checkAudio(t, 5000), t).toBeNull()
  })
  it('rejects other types, empty and oversized uploads', () => {
    expect(checkAudio('text/html', 100)).toMatch(/audio/)
    expect(checkAudio('video/webm', 100)).toMatch(/audio/)
    expect(checkAudio(null, 100)).toMatch(/audio/)
    expect(checkAudio('audio/webm', 0)).toMatch(/empty/)
    expect(checkAudio('audio/webm', MAX_AUDIO_BYTES + 1)).toMatch(/too long/)
    expect(checkAudio('audio/webm', MAX_AUDIO_BYTES)).toBeNull()
  })
})

describe('toIso639', () => {
  it('reduces locales to a language code and refuses junk', () => {
    expect([toIso639('hi-IN'), toIso639('en_GB'), toIso639('FR'), toIso639('zh-Hant-TW')]).toEqual(['hi', 'en', 'fr', 'zh'])
    for (const bad of ['', null, undefined, 'english', '12', 'en;drop table']) expect(toIso639(bad)).toBeNull()
  })
})

describe('config', () => {
  const env = (m: Record<string, string>) => (k: string) => m[k]
  it('needs both a URL and a key, and only accepts https', () => {
    expect(readSttConfig(env({}))).toBeNull()
    expect(readSttConfig(env({ STT_API_URL: 'https://api.example.com/v1/audio/transcriptions' }))).toBeNull()
    expect(readSttConfig(env({ STT_API_KEY: 'k' }))).toBeNull()
    expect(readSttConfig(env({ STT_API_URL: 'http://api.example.com/x', STT_API_KEY: 'k' }))).toBeNull()
    expect(readSttConfig(env({ STT_API_URL: 'not a url', STT_API_KEY: 'k' }))).toBeNull()
    expect(readSttConfig(env({ STT_API_URL: 'https://api.example.com/x', STT_API_KEY: 'k' }))).toEqual({ url: 'https://api.example.com/x', key: 'k', model: 'whisper-1' })
    expect(readSttConfig(env({ STT_API_URL: 'https://a.io/x', STT_API_KEY: 'k', STT_MODEL: 'big' }))?.model).toBe('big')
  })
})

describe('request building and replies', () => {
  it('builds the multipart form with a file name that matches the format', async () => {
    const form = buildTranscriptionForm(new Uint8Array([1, 2, 3]).buffer, 'audio/webm;codecs=opus', { url: 'u', key: 'k', model: 'm' }, 'hi')
    const file = form.get('file') as File
    expect(file.name).toBe('speech.webm')
    expect(file.size).toBe(3)
    expect(form.get('model')).toBe('m')
    expect(form.get('language')).toBe('hi')
    expect(buildTranscriptionForm(new ArrayBuffer(1), 'audio/mp4', { url: 'u', key: 'k', model: 'm' }, null).has('language')).toBe(false)
    expect(['audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'].map(extensionFor)).toEqual(['ogg', 'm4a', 'wav', 'mp3'])
  })

  it('reads the transcript defensively', () => {
    expect(parseTranscript({ text: '  add   call mom \n tomorrow ' })).toBe('add call mom tomorrow')
    expect(parseTranscript({ text: 'x'.repeat(9000) })?.length).toBe(4000)
    for (const bad of [null, {}, { text: 5 }, { text: '   ' }, 'text', []]) expect(parseTranscript(bad)).toBeNull()
  })
})
