import { Fragment } from 'react'
import { parseBlocks, type Inline } from './richText'

const inline = (parts: Inline[]) =>
  parts.map((p, i) =>
    p.kind === 'bold' ? <strong key={i}>{p.text}</strong>
    : p.kind === 'italic' ? <em key={i}>{p.text}</em>
    : p.kind === 'code' ? <code key={i} className="rounded bg-white/10 px-1 text-[0.9em]">{p.text}</code>
    : <Fragment key={i}>{p.text}</Fragment>)

/** Renders the assistant's reply. Everything goes through React elements, never HTML strings. */
export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {parseBlocks(text).map((b, i) =>
        b.kind === 'p' ? <p key={i}>{inline(b.inline)}</p>
        : b.kind === 'ul' ? <ul key={i} className="list-disc space-y-0.5 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
        : <ol key={i} className="list-decimal space-y-0.5 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>)}
    </div>
  )
}
