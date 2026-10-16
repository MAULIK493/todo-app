import { describe, expect, it } from 'vitest'
import { parseChatBody, sseEncode, sseResponse, trimHistory } from './http.ts'

const ID = '11111111-1111-1111-1111-111111111111'

describe('parseChatBody', () => {
  it('accepts a normal request and trims the message', () => {
    expect(parseChatBody({ message: '  hi  ' })).toEqual({ ok: true, value: { message: 'hi', conversationId: null, privateContext: null } })
    expect(parseChatBody({ message: 'x', conversationId: ID, privateContext: 'ctx' })).toMatchObject({ ok: true, value: { conversationId: ID, privateContext: 'ctx' } })
  })
  it('rejects bad input with a friendly message', () => {
    for (const body of [null, 'hi', {}, { message: '   ' }, { message: 5 }, { message: 'x'.repeat(4001) }, { message: 'x', conversationId: 'abc' }, { message: 'x', privateContext: 'y'.repeat(20_001) }, { message: 'x', privateContext: 3 }]) {
      expect(parseChatBody(body).ok).toBe(false)
    }
  })
})

describe('trimHistory', () => {
  const m = (role: 'user' | 'assistant', n: number) => ({ role, content: 'x'.repeat(n) })
  it('keeps everything that fits', () => {
    const h = [m('user', 10), m('assistant', 10)]
    expect(trimHistory(h, 100)).toEqual(h)
  })
  it('drops the oldest first and never starts on an assistant turn', () => {
    const h = [m('user', 50), m('assistant', 50), m('user', 50), m('assistant', 50)]
    const kept = trimHistory(h, 110)
    expect(kept).toEqual([h[2], h[3]])
    expect(trimHistory([m('assistant', 5), m('user', 5)], 100)).toEqual([m('user', 5)])
  })
  it('always keeps the latest message even if it alone is over budget', () => {
    expect(trimHistory([m('user', 500)], 10)).toHaveLength(1)
  })
})

describe('server-sent events', () => {
  it('encodes events as data frames', () => {
    expect(sseEncode({ type: 'text', delta: 'a\nb' })).toBe('data: {"type":"text","delta":"a\\nb"}\n\n')
  })

  it('streams events in order and closes even when the producer throws', async () => {
    const res = sseResponse(async (send) => {
      send({ type: 'text', delta: 'one' })
      send({ type: 'text', delta: 'two' })
      throw new Error('boom')
    })
    expect(res.headers.get('Content-Type')).toMatch(/text\/event-stream/)
    const text = await res.text()
    expect(text).toBe('data: {"type":"text","delta":"one"}\n\ndata: {"type":"text","delta":"two"}\n\n')
  })
})
