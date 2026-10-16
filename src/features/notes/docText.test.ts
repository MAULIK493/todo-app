import { describe, expect, it } from 'vitest'
import { docToText } from './docText'

describe('docToText', () => {
  it('flattens blocks onto separate lines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
      ],
    }
    expect(docToText(doc)).toBe('Title\nHello world\none')
  })
  it('handles empty and invalid input', () => {
    expect(docToText({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('')
    expect(docToText(null)).toBe('')
    expect(docToText('nope')).toBe('')
  })
})
