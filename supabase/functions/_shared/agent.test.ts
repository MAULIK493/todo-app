import { describe, expect, it } from 'vitest'
import { AgentError, RetryableLLMError, runAgent, type AMessage, type LLM, type LLMRequest, type MsgParam } from './agent.ts'
import { TOOLS } from './schemas.ts'
import type { ToolOutcome } from './tools.ts'
import type { ServerEvent } from './types.ts'

type Step = { deltas?: string[]; message?: AMessage; throws?: Error }

const usage = { input_tokens: 100, output_tokens: 20 }
const text = (t: string): AMessage => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage })
const toolTurn = (uses: { id: string; name: string; input?: unknown }[], preface = ''): AMessage => ({
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    ...(preface ? [{ type: 'text', text: preface }] : []),
    ...uses.map((u) => ({ type: 'tool_use', id: u.id, name: u.name, input: u.input ?? {} })),
  ],
  stop_reason: 'tool_use',
  usage,
})

/** A scripted stand-in for Claude. Records every request it receives. */
function fakeLLM(steps: Step[]) {
  const requests: LLMRequest[] = []
  const llm: LLM = {
    stream(req) {
      // Snapshot: the loop keeps appending to the same messages array.
      requests.push({ ...req, messages: structuredClone(req.messages) })
      const step = steps[requests.length - 1] ?? { message: text('(script ended)') }
      let cb: (d: string) => void = () => {}
      return {
        onText: (c) => { cb = c },
        async final() {
          for (const d of step.deltas ?? []) cb(d)
          if (step.throws) throw step.throws
          return step.message!
        },
      }
    },
  }
  return { llm, requests }
}

const ok = (content: unknown = {}): ToolOutcome => ({ content: JSON.stringify(content) })

function run(steps: Step[], executeTool: (n: string, i: unknown) => Promise<ToolOutcome> = async () => ok(), extra: { history?: MsgParam[]; maxTurns?: number } = {}) {
  const { llm, requests } = fakeLLM(steps)
  const events: ServerEvent[] = []
  const result = runAgent({ llm, system: 'SYS', tools: TOOLS, history: extra.history ?? [], userTurn: 'CTX\n\nhello', executeTool, emit: (e) => events.push(e), maxTurns: extra.maxTurns })
  return { result, requests, events }
}

describe('runAgent', () => {
  it('streams a plain answer and reports usage', async () => {
    const { result, events, requests } = run([{ deltas: ['Hel', 'lo!'], message: text('Hello!') }])
    const r = await result
    expect(r.text).toBe('Hello!')
    expect(events).toEqual([{ type: 'text', delta: 'Hel' }, { type: 'text', delta: 'lo!' }])
    expect(r.usage).toEqual({ input: 100, output: 20 })
    expect(requests).toHaveLength(1)
    expect(requests[0].messages).toEqual([{ role: 'user', content: 'CTX\n\nhello' }])
  })

  it('sends earlier turns as plain history ahead of the new message', async () => {
    const history: MsgParam[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }]
    const { result, requests } = run([{ message: text('ok') }], undefined, { history })
    await result
    expect(requests[0].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(requests[0].messages.at(-1)!.content).toBe('CTX\n\nhello')
  })

  it('runs tools, feeds results back, and echoes the assistant turn unchanged', async () => {
    const calls: [string, unknown][] = []
    const turn1 = toolTurn([{ id: 'tu1', name: 'list_todos', input: { view: 'today' } }], 'Let me check.')
    const { result, requests, events } = run(
      [{ deltas: ['Let me check.'], message: turn1 }, { deltas: ['You have 2.'], message: text('You have 2.') }],
      async (n, i) => { calls.push([n, i]); return ok({ count: 2 }) },
    )
    const r = await result
    expect(calls).toEqual([['list_todos', { view: 'today' }]])
    expect(r.turns).toBe(2)
    expect(r.text).toBe('Let me check.\n\nYou have 2.')
    // second request: [user, assistant(turn1 content incl. thinking block), user(tool_result)]
    const second = requests[1].messages
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(second[1].content).toEqual(turn1.content)
    expect(second[2].content).toEqual([{ type: 'tool_result', tool_use_id: 'tu1', content: '{"count":2}' }])
    expect(events.map((e) => e.type)).toEqual(['text', 'tool', 'tool', 'text'])
    // the paragraph break between turns travels with the next text
    expect(events.at(-1)).toEqual({ type: 'text', delta: '\n\nYou have 2.' })
    expect(events.filter((e) => e.type === 'tool')).toEqual([{ type: 'tool', name: 'list_todos', status: 'running' }, { type: 'tool', name: 'list_todos', status: 'done' }])
  })

  it('answers several parallel tool calls in a single user message', async () => {
    const { result, requests } = run([
      { message: toolTurn([{ id: 'a', name: 'list_todos' }, { id: 'b', name: 'get_stats' }]) },
      { message: text('done') },
    ])
    await result
    const results = requests[1].messages.at(-1)!.content as { tool_use_id: string }[]
    expect(requests[1].messages.at(-1)!.role).toBe('user')
    expect(results.map((r) => r.tool_use_id)).toEqual(['a', 'b'])
  })

  it('marks failed tool calls as errors so the model can recover', async () => {
    const { result, requests, events } = run(
      [{ message: toolTurn([{ id: 'x', name: 'create_todo' }]) }, { message: text('Sorry') }],
      async () => ({ content: '{"error":"Which workspace?"}', isError: true }),
    )
    await result
    expect((requests[1].messages.at(-1)!.content as { is_error?: boolean }[])[0].is_error).toBe(true)
    expect(events).toContainEqual({ type: 'tool', name: 'create_todo', status: 'error' })
  })

  it('forwards action cards and confirmation requests, and returns them for saving', async () => {
    const action = { kind: 'todo_created' as const, id: 'i', title: 'T', workspace: 'W' }
    const confirm = { id: 'c1', kind: 'delete_todos' as const, summary: 'Delete 1 todo', items: [{ id: 'i', title: 'T' }] }
    const { result, events } = run(
      [{ message: toolTurn([{ id: '1', name: 'create_todo' }, { id: '2', name: 'propose_delete_todos' }]) }, { message: text('ok') }],
      async (n) => (n === 'create_todo' ? { ...ok(), actions: [action] } : { ...ok(), confirm }),
    )
    const r = await result
    expect(r.actions).toEqual([action])
    expect(r.confirms).toEqual([confirm])
    expect(events).toContainEqual({ type: 'action', action })
    expect(events).toContainEqual({ type: 'confirm', confirm })
  })

  it('truncates enormous tool results', async () => {
    const { result, requests } = run([{ message: toolTurn([{ id: '1', name: 'list_todos' }]) }, { message: text('ok') }], async () => ({ content: 'x'.repeat(50_000) }))
    await result
    const content = (requests[1].messages.at(-1)!.content as { content: string }[])[0].content
    expect(content.length).toBeLessThan(21_000)
    expect(content.endsWith('(truncated)')).toBe(true)
  })

  it('re-issues a turn whose tool input could not be parsed, discarding its partial text', async () => {
    const { result, events, requests } = run([
      { deltas: ['Let me check. '], message: toolTurn([{ id: '1', name: 'list_todos' }], 'Let me check. ') },
      { deltas: ['Partial'], throws: new RetryableLLMError('bad json') },
      { deltas: ['Fixed.'], message: text('Fixed.') },
    ])
    const r = await result
    expect(events).toContainEqual({ type: 'turn_reset', keep: 'Let me check. '.length })
    expect(r.text).toBe('Let me check. \n\nFixed.')
    expect(requests).toHaveLength(3)
  })

  it('gives up after repeated unparseable turns, and never retries real errors', async () => {
    const bad = { throws: new RetryableLLMError('bad json') }
    await expect(run([bad, bad, bad, bad]).result).rejects.toBeInstanceOf(RetryableLLMError)
    const boom = { throws: new Error('rate limited') }
    const { result, requests } = run([boom, { message: text('never') }])
    await expect(result).rejects.toThrow('rate limited')
    expect(requests).toHaveLength(1)
  })

  it('handles a refusal without running tools', async () => {
    const refused: AMessage = { content: [{ type: 'tool_use', id: '1', name: 'delete', input: {} }], stop_reason: 'refusal', usage }
    let ran = false
    const { result } = run([{ message: refused }], async () => { ran = true; return ok() })
    const r = await result
    expect(ran).toBe(false)
    expect(r.text).toBe("I can't help with that request.")
    expect(r.stopReason).toBe('refusal')
  })

  it('refuses to act on a tool call cut off by max_tokens', async () => {
    const cut: AMessage = { ...toolTurn([{ id: '1', name: 'create_todo' }]), stop_reason: 'max_tokens' }
    let ran = false
    const { result } = run([{ message: cut }], async () => { ran = true; return ok() })
    await expect(result).rejects.toBeInstanceOf(AgentError)
    expect(ran).toBe(false)
  })

  it('keeps truncated plain text rather than failing', async () => {
    const { result } = run([{ deltas: ['A long ans'], message: { ...text('A long ans'), stop_reason: 'max_tokens' } }])
    expect((await result).text).toBe('A long ans')
  })

  it('stops a runaway loop and says so', async () => {
    const looping = Array.from({ length: 10 }, (_, i) => ({ message: toolTurn([{ id: `t${i}`, name: 'list_todos' }]) }))
    const { result, requests } = run(looping, undefined, { maxTurns: 3 })
    const r = await result
    expect(requests).toHaveLength(3)
    expect(r.stopReason).toBe('max_turns')
    expect(r.text).toMatch(/pausing here/)
  })

  it('counts cached input tokens in usage', async () => {
    const { result } = run([{ message: { ...text('x'), usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 } } }])
    expect((await result).usage).toEqual({ input: 510, output: 5 })
  })
})
