import { BRIEFING_SYSTEM, buildBriefingFacts, type BriefingKind } from '@shared/briefing.ts'
import { isValidTimeZone, localDate } from '@shared/dates.ts'
import { createDb, createStore } from '@shared/db.ts'
import { allowedWorkspaces } from '@shared/tools.ts'
import { supabase } from '@/lib/supabase'
import { createLLM } from './llm'
import { isAiConfigured, useAiConfig } from './llm/config'

/**
 * The morning or evening summary, written with the person's own AI key and saved for the rest of the day.
 * Returns null when it is switched off or when no key has been added yet.
 */
export async function loadBriefing(kind: BriefingKind): Promise<string | null> {
  const config = useAiConfig.getState()
  const db = createDb(supabase)
  const store = createStore(supabase)
  const profile = await db.profile()
  if (!profile.briefingEnabled) return null

  const tz = isValidTimeZone(profile.timezone) ? profile.timezone : 'UTC'
  const now = new Date()
  const day = localDate(tz, now)
  const existing = await store.briefing(day, kind)
  if (existing) return existing
  if (!isAiConfigured(config)) return null

  const [all, access] = await Promise.all([db.workspaces(), db.workspaceAccess()])
  const facts = await buildBriefingFacts(db, { kind, now, tz, tone: profile.tone, workspaces: allowedWorkspaces(all, access) })

  const stream = createLLM(config, { maxTokens: 1000, briefing: true }).stream({ system: BRIEFING_SYSTEM, tools: [], messages: [{ role: 'user', content: facts }] })
  let text = ''
  stream.onText((d) => { text += d })
  const message = await stream.final()
  if (message.stop_reason === 'refusal') throw new Error('No briefing could be written right now.')
  const content = text.trim()
  if (!content) throw new Error('No briefing could be written right now.')

  await store.saveBriefing(day, kind, content)
  await store.recordUsage(message.usage.input_tokens, message.usage.output_tokens).catch(() => undefined)
  return content
}
