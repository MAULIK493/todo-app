import type { ToolDef } from './schemas.ts'
import type { ToolOutcome } from './tools.ts'
import type { Action, ConfirmRequest, ServerEvent } from './types.ts'

// ---- the slice of the Anthropic API the loop depends on (the real adapter lives in the Edge Function) ----

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: string; [key: string]: unknown }

export type AMessage = {
  content: ContentBlock[]
  stop_reason: string | null
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }
}

export type MsgParam = { role: 'user' | 'assistant'; content: string | unknown[] }

export type LLMRequest = { system: string; tools: ToolDef[]; messages: MsgParam[] }

export interface LLMStream {
  /** Called with each piece of visible text as it is generated. */
  onText(cb: (delta: string) => void): void
  final(): Promise<AMessage>
}
export interface LLM {
  stream(req: LLMRequest): LLMStream
}

/** The model's tool input could not be parsed (can happen with streamed tool inputs); the turn can be re-issued. */
export class RetryableLLMError extends Error {}

/** The model or request could not be completed; the message is safe to show the user. */
export class AgentError extends Error {}

export type AgentOptions = {
  llm: LLM
  system: string
  tools: ToolDef[]
  history: MsgParam[]
  /** The user's message with per-request context already prepended. */
  userTurn: string
  executeTool: (name: string, input: unknown) => Promise<ToolOutcome>
  emit: (e: ServerEvent) => void
  maxTurns?: number
}

export type AgentResult = {
  text: string
  actions: Action[]
  confirms: ConfirmRequest[]
  usage: { input: number; output: number }
  turns: number
  stopReason: string
}

const MAX_TOOL_RESULT_CHARS = 20_000
const MAX_RETRIES = 2

export async function runAgent(o: AgentOptions): Promise<AgentResult> {
  const maxTurns = o.maxTurns ?? 8
  const messages: MsgParam[] = [...o.history, { role: 'user', content: o.userTurn }]
  const actions: Action[] = []
  const confirms: ConfirmRequest[] = []
  const usage = { input: 0, output: 0 }
  let visible = ''
  let stopReason = 'end_turn'
  let turns = 0

  for (; turns < maxTurns; ) {
    turns++
    const turnStart = visible.length
    let retries = 0
    let message: AMessage

    // Re-issue the turn if a streamed tool input could not be parsed at all.
    for (;;) {
      const stream = o.llm.stream({ system: o.system, tools: o.tools, messages })
      let first = true
      stream.onText((delta) => {
        // Separate the text of consecutive turns (e.g. "Let me check." ... "You have 3 todos.").
        const prefix = first && turnStart > 0 && visible.length === turnStart ? '\n\n' : ''
        first = false
        visible += prefix + delta
        o.emit({ type: 'text', delta: prefix + delta })
      })
      try {
        message = await stream.final()
        break
      } catch (e) {
        if (!(e instanceof RetryableLLMError) || retries++ >= MAX_RETRIES) throw e
        visible = visible.slice(0, turnStart)
        o.emit({ type: 'turn_reset', keep: turnStart })
      }
    }

    const u = message.usage
    usage.input += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    usage.output += u.output_tokens
    stopReason = message.stop_reason ?? 'end_turn'

    const toolUses = message.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')

    if (stopReason === 'refusal') {
      // A refusal can cut a tool call off mid-input: never run its tools.
      if (visible.length === turnStart) {
        const text = "I can't help with that request."
        visible += text
        o.emit({ type: 'text', delta: text })
      }
      break
    }
    if (stopReason === 'max_tokens' && toolUses.length > 0) {
      // A truncated tool input can still look valid; refuse to act on it.
      throw new AgentError('That response got too long to finish. Try asking for a smaller piece.')
    }
    if (stopReason !== 'tool_use' || toolUses.length === 0) break

    // Echo the assistant turn back unchanged (thinking blocks included), then answer every tool call in ONE user message.
    messages.push({ role: 'assistant', content: message.content })
    const results: unknown[] = []
    for (const use of toolUses) {
      o.emit({ type: 'tool', name: use.name, status: 'running' })
      const outcome = await o.executeTool(use.name, use.input)
      o.emit({ type: 'tool', name: use.name, status: outcome.isError ? 'error' : 'done' })
      for (const action of outcome.actions ?? []) {
        actions.push(action)
        o.emit({ type: 'action', action })
      }
      if (outcome.confirm) {
        confirms.push(outcome.confirm)
        o.emit({ type: 'confirm', confirm: outcome.confirm })
      }
      const content = outcome.content.length > MAX_TOOL_RESULT_CHARS ? `${outcome.content.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)` : outcome.content
      results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(outcome.isError ? { is_error: true } : {}) })
    }
    messages.push({ role: 'user', content: results })

    if (turns >= maxTurns) {
      const text = "\n\nI've made a lot of changes in one go, so I'm pausing here. Tell me if you want me to keep going."
      visible += text
      o.emit({ type: 'text', delta: text })
      stopReason = 'max_turns'
    }
  }

  return { text: visible, actions, confirms, usage, turns, stopReason }
}
