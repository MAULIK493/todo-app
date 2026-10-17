import { runAgent } from '@shared/agent.ts'
import { isValidTimeZone } from '@shared/dates.ts'
import { createDb, createStore } from '@shared/db.ts'
import { parseChatBody, trimHistory } from '@shared/http.ts'
import { buildContext, SYSTEM_PROMPT, withContext } from '@shared/prompt.ts'
import { TOOLS } from '@shared/schemas.ts'
import { allowedWorkspaces, createToolExecutor } from '@shared/tools.ts'
import type { ServerEvent } from '@shared/types.ts'
import { supabase } from '@/lib/supabase'
import { AssistantError } from './errors'
import { isAiConfigured, useAiConfig } from './llm/config'
import { ProviderError } from './llm/errors'
import { createLLM as makeModel } from './llm'
import { providerById } from './llm/providers'

const HISTORY_MESSAGES = 30
const HISTORY_CHARS = 40_000

export const NOT_SET_UP = 'Add your own AI key in Assistant settings to start using the assistant.'

/**
 * One assistant turn, run in the browser with the person's own AI key. What it can read and change is limited by
 * the same row-level security as the rest of the app, because it uses the person's own signed-in database session.
 * Events are the same ones the old server sent, so the chat screen did not need to change.
 */
export async function runChat(o: {
  message: string
  conversationId: string | null
  privateContext: string | null
  signal: AbortSignal
  onEvent: (e: ServerEvent) => void
}) {
  const config = useAiConfig.getState()
  if (!isAiConfigured(config)) throw new AssistantError('not_configured', NOT_SET_UP)

  const parsed = parseChatBody({ message: o.message, conversationId: o.conversationId, privateContext: o.privateContext })
  if (!parsed.ok) throw new AssistantError('bad_request', parsed.error)
  const body = parsed.value

  const db = createDb(supabase)
  const store = createStore(supabase)
  const [all, access, profile] = await Promise.all([db.workspaces(), db.workspaceAccess(), db.profile()])
  const tz = isValidTimeZone(profile.timezone) ? profile.timezone : 'UTC'
  const visible = allowedWorkspaces(all, access)
  const now = new Date()

  let history: { role: 'user' | 'assistant'; content: string }[] = []
  if (body.conversationId) {
    const stored = await store.history(body.conversationId, HISTORY_MESSAGES)
    if (!stored) throw new AssistantError('bad_request', 'That conversation was not found.')
    history = trimHistory(stored, HISTORY_CHARS)
  }

  const sharedPrivate = body.privateContext && body.privateContext.trim() ? body.privateContext : null
  const context = buildContext({
    now, tz, tone: profile.tone, workspaceNames: visible.map((w) => w.name), hiddenWorkspaces: all.length - visible.length, privateContext: sharedPrivate,
  })

  const llm = makeModel(config, { maxTokens: config.mode === 'own' && providerById(config.provider).api === 'anthropic' ? 8192 : 4096, signal: o.signal })
  const execute = createToolExecutor({ db, now, tz, workspaces: visible, newId: () => crypto.randomUUID() })

  try {
    const result = await runAgent({
      llm, system: SYSTEM_PROMPT, tools: TOOLS, history, userTurn: withContext(context, body.message), executeTool: execute, emit: o.onEvent,
    })

    // A turn that used shared private content is never saved: that text must not land in the database.
    let conversationId = body.conversationId ?? ''
    let persisted = false
    if (!sharedPrivate) {
      try {
        conversationId ||= await store.createConversation(body.message.replace(/\s+/g, ' ').slice(0, 60))
        await store.saveTurn(conversationId, body.message, result.text || '(no reply)', result.actions)
        persisted = true
      } catch (e) {
        console.error('could not save the conversation', e)
      }
    }
    // Bookkeeping only: the person should not wait for it.
    void store.recordUsage(result.usage.input, result.usage.output).catch((e) => console.error('could not record usage', e))
    o.onEvent({ type: 'done', conversationId, persisted, usage: result.usage })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    // Problems with the key or the account are shown above the composer, with a way to fix them.
    if (e instanceof ProviderError && (e.kind === 'auth' || e.kind === 'unavailable')) throw new AssistantError('not_configured', e.message)
    if (e instanceof ProviderError && e.kind === 'session') throw new AssistantError('unauthorized', e.message)
    if (e instanceof ProviderError && (e.kind === 'quota' || e.kind === 'rate')) throw new AssistantError('rate_limited', e.message)
    console.error('assistant request failed', e)
    o.onEvent({ type: 'error', message: e instanceof Error && (e instanceof ProviderError || e.constructor.name === 'AgentError') ? e.message : 'Something went wrong while talking to the assistant. Please try again.', code: 'server' })
  }
}
