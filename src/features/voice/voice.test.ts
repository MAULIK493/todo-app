// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { pickMimeType, rms, SilenceDetector } from './recorder'
import { DEFAULT_VOICE_SETTINGS, effectiveLang, sanitizeVoiceSettings, useVoiceSettings } from './settings'
import { pickVoice, shouldSpeak, splitForSpeech, toSpeechText } from './speech'

describe('toSpeechText', () => {
  it('drops markdown marks and reads lists as sentences', () => {
    const text = toSpeechText('You have **two** things:\n\n- Call mom\n- File taxes (see https://example.com/x)\n\nGood luck')
    expect(text).toBe('You have two things: Call mom. File taxes (see a link). Good luck.')
    expect(text).not.toMatch(/[*`]|https?:/)
  })

  it('keeps the punctuation around a link', () => {
    expect(toSpeechText('Open https://example.com/a. Then (https://b.org/c), done')).toBe('Open a link. Then (a link), done.')
  })

  it('numbers ordered lists and handles empty input', () => {
    expect(toSpeechText('1. one\n2. two')).toBe('1. one. 2. two.')
    expect(toSpeechText('')).toBe('')
  })
})

describe('splitForSpeech', () => {
  it('keeps short text whole and splits at sentence ends under the limit', () => {
    expect(splitForSpeech('Hello there.')).toEqual(['Hello there.'])
    const chunks = splitForSpeech('One sentence here. Another one follows. And a third.', 30)
    expect(chunks.every((c) => c.length <= 30)).toBe(true)
    expect(chunks.join(' ')).toBe('One sentence here. Another one follows. And a third.')
  })

  it('breaks a sentence with no punctuation at spaces, never mid-word', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const chunks = splitForSpeech(long, 60)
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every((c) => c.length <= 60)).toBe(true)
    expect(chunks.join(' ')).toBe(long)
  })
})

describe('shouldSpeak', () => {
  const base = { mode: 'always' as const, viaVoice: false, usedPrivate: false, hasText: true }
  it('follows the setting', () => {
    expect(shouldSpeak({ ...base, mode: 'off' })).toBe(false)
    expect(shouldSpeak({ ...base, mode: 'voice' })).toBe(false)
    expect(shouldSpeak({ ...base, mode: 'voice', viaVoice: true })).toBe(true)
    expect(shouldSpeak(base)).toBe(true)
  })
  it('never speaks replies that used private content, or empty ones', () => {
    for (const mode of ['voice', 'always'] as const) expect(shouldSpeak({ ...base, mode, viaVoice: true, usedPrivate: true })).toBe(false)
    expect(shouldSpeak({ ...base, hasText: false })).toBe(false)
  })
})

describe('pickVoice', () => {
  const voices = [
    { lang: 'en_US', name: 'a', localService: false }, { lang: 'en-GB', name: 'b', localService: true },
    { lang: 'hi-IN', name: 'c', localService: false }, { lang: 'en-GB', name: 'd', localService: false },
  ]
  it('prefers an exact on-device match, then any exact match, then the same language', () => {
    expect(pickVoice(voices, 'en-GB')?.name).toBe('b')
    expect(pickVoice(voices, 'hi-IN')?.name).toBe('c')
    expect(pickVoice(voices, 'en-AU')?.name).toBe('a')
    expect(pickVoice(voices, 'fr-FR')).toBeUndefined()
  })
})

describe('SilenceDetector', () => {
  it('stops after a pause that follows speech', () => {
    const d = new SilenceDetector({ silenceMs: 1000, minSpeechMs: 200 })
    let t = 0
    const decisions: string[] = []
    for (; t <= 600; t += 50) decisions.push(d.feed(0.1, t)) // 600 ms of talking
    expect(decisions.every((x) => x === 'continue')).toBe(true)
    for (; t <= 1500; t += 50) expect(d.feed(0.001, t)).toBe('continue') // short pause
    expect(d.feed(0.001, 1700)).toBe('stop-after-speech')
  })

  it('gives up when nothing is said', () => {
    const d = new SilenceDetector({ noSpeechMs: 3000 })
    expect(d.feed(0, 0)).toBe('continue')
    expect(d.feed(0.005, 2900)).toBe('continue')
    expect(d.feed(0.005, 3000)).toBe('stop-no-speech')
  })

  it('ignores a click or cough shorter than the minimum, and enforces the maximum length', () => {
    const d = new SilenceDetector({ minSpeechMs: 300, noSpeechMs: 2000 })
    d.feed(0, 0)
    d.feed(0.5, 50) // 50 ms blip
    expect(d.feed(0, 2000)).toBe('stop-no-speech')
    const long = new SilenceDetector({ maxMs: 1000 })
    long.feed(0.5, 0)
    expect(long.feed(0.5, 1000)).toBe('stop-max')
  })

  it('measures loudness and picks a recording format', () => {
    expect(rms([])).toBe(0)
    expect(rms([0, 0, 0])).toBe(0)
    expect(rms([1, -1, 1, -1])).toBe(1)
    expect(pickMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4')
    expect(pickMimeType(() => false)).toBeUndefined()
  })
})

describe('voice settings', () => {
  beforeEach(() => { localStorage.clear(); useVoiceSettings.setState({ ...DEFAULT_VOICE_SETTINGS }) })

  it('rejects unknown values and keeps good ones', () => {
    expect(sanitizeVoiceSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS)
    expect(sanitizeVoiceSettings({ lang: 'xx-XX', autoSend: 'yes', speak: 'loud' })).toEqual(DEFAULT_VOICE_SETTINGS)
    expect(sanitizeVoiceSettings({ lang: 'hi-IN', autoSend: false, speak: 'voice' })).toEqual({ lang: 'hi-IN', autoSend: false, speak: 'voice' })
  })

  it('saves changes and falls back to the browser language', () => {
    useVoiceSettings.getState().update({ lang: 'hi-IN', speak: 'always' })
    expect(JSON.parse(localStorage.getItem('voice-settings')!)).toEqual({ lang: 'hi-IN', autoSend: true, speak: 'always' })
    expect(effectiveLang({ lang: 'hi-IN' })).toBe('hi-IN')
    expect(effectiveLang({ lang: '' })).toBe(navigator.language)
    useVoiceSettings.getState().update({ lang: 'bogus' })
    expect(useVoiceSettings.getState().lang).toBe('')
  })
})
