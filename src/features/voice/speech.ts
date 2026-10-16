import { parseBlocks, type Inline } from '@/features/assistant/richText'
import { effectiveLang, useVoiceSettings, type SpeakMode } from './settings'

// ---- turning a reply into something worth saying aloud ----

const plain = (parts: Inline[]) => parts.map((p) => p.text).join('')

/** Drops formatting marks and reads lists as sentences: "Here are three things. First, ... Second, ..." */
export function toSpeechText(reply: string): string {
  const out: string[] = []
  for (const block of parseBlocks(reply)) {
    if (block.kind === 'p') out.push(plain(block.inline))
    else block.items.forEach((item, i) => out.push(block.kind === 'ol' ? `${i + 1}. ${plain(item)}` : plain(item)))
  }
  return out
    // A link ends before any closing bracket or trailing punctuation, so "(see https://x.com/y)" keeps its bracket.
    .map((s) => s.replace(/https?:\/\/[^\s)\]]*[^\s).,;:!?\]]/g, 'a link').trim())
    .filter(Boolean)
    .map((s) => (/[.!?…:]$/.test(s) ? s : `${s}.`))
    .join(' ')
}

/** Speech engines cut off long utterances, so say it a sentence or two at a time. */
export function splitForSpeech(text: string, max = 180): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const raw of sentences) {
    const s = raw.trim()
    if (!s) continue
    if (current && current.length + s.length + 1 > max) { chunks.push(current); current = '' }
    if (s.length > max) {
      // A run-on sentence: break at spaces.
      for (const word of s.split(' ')) {
        if (current && current.length + word.length + 1 > max) { chunks.push(current); current = '' }
        current = current ? `${current} ${word}` : word
      }
    } else current = current ? `${current} ${s}` : s
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * Whether a finished reply should be read aloud. Replies that drew on shared private content are never spoken:
 * a speaker can be overheard in a way a screen usually cannot.
 */
export function shouldSpeak(o: { mode: SpeakMode; viaVoice: boolean; usedPrivate: boolean; hasText: boolean }): boolean {
  if (!o.hasText || o.usedPrivate || o.mode === 'off') return false
  return o.mode === 'always' || o.viaVoice
}

export function pickVoice<V extends { lang: string; localService?: boolean }>(voices: V[], lang: string): V | undefined {
  const norm = (l: string) => l.replace('_', '-').toLowerCase()
  const want = norm(lang)
  const base = want.split('-')[0]
  return (
    voices.find((v) => norm(v.lang) === want && v.localService) ??
    voices.find((v) => norm(v.lang) === want) ??
    voices.find((v) => norm(v.lang).split('-')[0] === base)
  )
}

// ---- browser speech synthesis ----

export const speechSynthesisSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

export function cancelSpeech() {
  if (speechSynthesisSupported()) window.speechSynthesis.cancel()
}

export function speak(text: string, lang: string) {
  if (!speechSynthesisSupported()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const voice = pickVoice(synth.getVoices(), lang)
  for (const chunk of splitForSpeech(text)) {
    const u = new SpeechSynthesisUtterance(chunk)
    u.lang = voice?.lang ?? lang
    if (voice) u.voice = voice
    synth.speak(u)
  }
}

/** Called when a reply is complete; reads it aloud if the user's settings and the privacy rules allow. */
export function maybeSpeak(reply: string, o: { viaVoice: boolean; usedPrivate: boolean }) {
  const s = useVoiceSettings.getState()
  const text = toSpeechText(reply)
  if (shouldSpeak({ mode: s.speak, viaVoice: o.viaVoice, usedPrivate: o.usedPrivate, hasText: text.length > 0 })) speak(text, effectiveLang(s))
}
