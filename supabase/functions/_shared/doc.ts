// Turns plain text from the assistant into a TipTap/ProseMirror document, the format notes are stored in.

type Node = { type: string; content?: Node[]; text?: string; attrs?: Record<string, unknown> }

const text = (t: string): Node[] => (t ? [{ type: 'text', text: t }] : [])

/**
 * Blank lines separate blocks. "# " / "## " / "### " make headings, consecutive "- " or "* " lines make a bullet
 * list, consecutive "1. " lines a numbered list, and anything else is a paragraph (single line breaks kept).
 */
export function textToDoc(body: string): { type: 'doc'; content: Node[] } {
  const blocks: Node[] = []
  for (const chunk of body.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
    if (lines.length === 0) continue

    const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0])
    if (heading && lines.length === 1) {
      blocks.push({ type: 'heading', attrs: { level: heading[1].length }, content: text(heading[2]) })
    } else if (lines.every((l) => /^[-*]\s+/.test(l))) {
      blocks.push({ type: 'bulletList', content: lines.map((l) => item(l.replace(/^[-*]\s+/, ''))) })
    } else if (lines.every((l) => /^\d+[.)]\s+/.test(l))) {
      blocks.push({ type: 'orderedList', content: lines.map((l) => item(l.replace(/^\d+[.)]\s+/, ''))) })
    } else {
      const content: Node[] = []
      lines.forEach((l, i) => {
        if (i > 0) content.push({ type: 'hardBreak' })
        content.push(...text(l))
      })
      blocks.push({ type: 'paragraph', content })
    }
  }
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
}

const item = (t: string): Node => ({ type: 'listItem', content: [{ type: 'paragraph', content: text(t) }] })
