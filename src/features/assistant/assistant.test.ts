import { describe, expect, it } from 'vitest'
import { applyServerEvent, newMessage } from './messages'
import { formatPrivateContext, selectShareable } from './privateContext'
import { parseBlocks, parseInline } from './richText'
import type { ServerEvent } from '@shared/types.ts'

describe('applyServerEvent', () => {
  const fold = (events: ServerEvent[]) => events.reduce(applyServerEvent, newMessage('a', 'assistant'))

  it('builds up text, tool activity, action cards and confirmations', () => {
    const m = fold([
      { type: 'text', delta: 'Let me ' }, { type: 'text', delta: 'check.' },
      { type: 'tool', name: 'list_todos', status: 'running' },
    ])
    expect(m.text).toBe('Let me check.')
    expect(m.activity).toBe('Looking at your todos…')
    const done = fold([
      { type: 'action', action: { kind: 'todo_created', id: '1', title: 'T', workspace: 'W' } },
      { type: 'confirm', confirm: { id: 'c', kind: 'delete_todos', summary: 's', items: [] } },
      { type: 'done', conversationId: 'x', persisted: true, usage: { input: 1, output: 1 } },
    ])
    expect(done.actions).toHaveLength(1)
    expect(done.confirms[0].state).toBe('pending')
    expect(done.status).toBe('done')
  })

  it('clears the activity line as soon as text arrives or the tool finishes', () => {
    expect(fold([{ type: 'tool', name: 'create_todo', status: 'running' }, { type: 'text', delta: 'x' }]).activity).toBeNull()
    expect(fold([{ type: 'tool', name: 'create_todo', status: 'running' }, { type: 'tool', name: 'create_todo', status: 'done' }]).activity).toBeNull()
  })

  it('drops a failed turn\'s partial text on reset', () => {
    expect(fold([{ type: 'text', delta: 'Hello. ' }, { type: 'text', delta: 'Partia' }, { type: 'turn_reset', keep: 7 }]).text).toBe('Hello. ')
  })

  it('records errors', () => {
    const m = fold([{ type: 'text', delta: 'half' }, { type: 'error', message: 'Busy' }])
    expect(m).toMatchObject({ status: 'error', error: 'Busy', text: 'half' })
  })
})

describe('private content sharing', () => {
  const ws = [
    { id: 'a', name: 'Plain', lock_state: 'none' },
    { id: 'b', name: 'Diary', lock_state: 'locked' },
    { id: 'c', name: 'Vault', lock_state: 'locked' },
    { id: 'd', name: 'Mid', lock_state: 'encrypting' },
  ]

  it('shares only private workspaces that are unlocked now AND opted in', () => {
    const unlocked = new Set(['b', 'c', 'd'])
    expect(selectShareable(ws, { b: true, c: false, d: true }, unlocked).map((w) => w.id)).toEqual(['b'])
    expect(selectShareable(ws, { b: true }, new Set()).map((w) => w.id)).toEqual([]) // locked again: nothing leaves
    expect(selectShareable(ws, {}, unlocked)).toEqual([]) // no opt-in
    expect(selectShareable(ws, { a: true }, new Set(['a']))).toEqual([]) // normal workspaces go through the server
  })

  it('formats a compact read-only snapshot and caps its size', () => {
    const text = formatPrivateContext([{ name: 'Diary', todos: [{ title: 'Call doctor', status: 'open', priority: 3, due: 'Fri 17 Oct' }], noteTitles: ['Therapy'] }])!
    expect(text).toContain('Private workspace "Diary" (read-only)')
    expect(text).toContain('- Call doctor (high priority, due Fri 17 Oct)')
    expect(text).toContain('Notes: "Therapy"')
    expect(formatPrivateContext([{ name: 'X', todos: [], noteTitles: [] }])).toBeNull()
    expect(formatPrivateContext([{ name: 'X', todos: Array.from({ length: 500 }, () => ({ title: 'x'.repeat(50), status: 'open', priority: 0, due: null })), noteTitles: [] }], 1000)!.length).toBe(1000)
  })
})

describe('rich text', () => {
  it('parses inline emphasis without touching other text', () => {
    expect(parseInline('Do **this** and *that* with `code`')).toEqual([
      { kind: 'text', text: 'Do ' }, { kind: 'bold', text: 'this' }, { kind: 'text', text: ' and ' }, { kind: 'italic', text: 'that' },
      { kind: 'text', text: ' with ' }, { kind: 'code', text: 'code' },
    ])
    expect(parseInline('2 * 3 * 4')).toEqual([{ kind: 'text', text: '2 * 3 * 4' }])
  })

  it('groups lines into paragraphs and lists', () => {
    const blocks = parseBlocks('Here is the plan:\n\n- first\n- **second**\n\n1. one\n2. two\nAfter')
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ul', 'ol', 'p'])
    expect((blocks[1] as { items: unknown[] }).items).toHaveLength(2)
  })

  it('keeps HTML as inert text (React escapes it)', () => {
    expect(parseBlocks('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'p', inline: [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }] }])
  })
})
