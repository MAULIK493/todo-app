import { describe, expect, it } from 'vitest'
import { textToDoc } from './doc.ts'

describe('textToDoc', () => {
  it('makes paragraphs from blank-line separated blocks and keeps single line breaks', () => {
    const doc = textToDoc('First line\nsecond line\n\nNext paragraph')
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph', 'paragraph'])
    expect(doc.content[0].content!.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text'])
  })

  it('recognises headings and lists', () => {
    const doc = textToDoc('## Plan\n\n- one\n- two\n\n1. first\n2. second')
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'bulletList', 'orderedList'])
    expect(doc.content[0].attrs).toEqual({ level: 2 })
    expect(doc.content[1].content).toHaveLength(2)
  })

  it('never produces an empty document', () => {
    expect(textToDoc('   \n\n ').content).toEqual([{ type: 'paragraph' }])
    expect(textToDoc('').content).toEqual([{ type: 'paragraph' }])
  })

  it('does not treat a heading marker inside a longer block as a heading', () => {
    expect(textToDoc('# title\nmore text').content[0].type).toBe('paragraph')
  })
})
