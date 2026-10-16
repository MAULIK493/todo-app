/** A tiny, safe renderer for the assistant's replies: paragraphs, bullet/numbered lists, **bold**, *italic* and `code`. */

export type Inline = { kind: 'text' | 'bold' | 'italic' | 'code'; text: string }
export type Block =
  | { kind: 'p'; inline: Inline[] }
  | { kind: 'ul' | 'ol'; items: Inline[][] }

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  const re = /(\*\*([^*]+)\*\*)|(\*([^*\s][^*]*)\*)|(`([^`]+)`)/g
  let last = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) })
    if (m[2] !== undefined) out.push({ kind: 'bold', text: m[2] })
    else if (m[4] !== undefined) out.push({ kind: 'italic', text: m[4] })
    else out.push({ kind: 'code', text: m[6] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  return out.length ? out : [{ kind: 'text', text: '' }]
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', inline: parseInline(para.join(' ')) })
    para = []
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flush()
      const kind = bullet ? 'ul' : 'ol'
      const last = blocks[blocks.length - 1]
      const item = parseInline((bullet ?? numbered)![1])
      if (last && last.kind === kind) last.items.push(item)
      else blocks.push({ kind, items: [item] })
    } else if (line.trim() === '') flush()
    else para.push(line.trim())
  }
  flush()
  return blocks
}
