type Node = { type?: string; text?: string; content?: Node[] }

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule'])

/** Plain text of a TipTap document (same idea as editor.getText()), used to rebuild search text when a lock is removed. */
export function docToText(doc: unknown): string {
  const parts: string[] = []
  const walk = (node: Node) => {
    if (typeof node.text === 'string') parts.push(node.text)
    node.content?.forEach(walk)
    if (node.type && BLOCKS.has(node.type)) parts.push('\n')
  }
  if (doc && typeof doc === 'object') walk(doc as Node)
  return parts.join('').replace(/\n{2,}/g, '\n').trim()
}
