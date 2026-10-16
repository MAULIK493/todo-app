import { useEditorState, type Editor } from '@tiptap/react'
import {
  Bold, Code, Code2, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Minus, Quote,
  Redo2, Strikethrough, Undo2,
} from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { cn } from '@/lib/cn'

type Btn = { label: string; icon: ComponentType<{ size?: number }>; run: () => void; active?: boolean; disabled?: boolean }

export function Toolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false)
  const [url, setUrl] = useState('')

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'),
      quote: e.isActive('blockquote'), codeBlock: e.isActive('codeBlock'), link: e.isActive('link'),
      canUndo: e.can().undo(), canRedo: e.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()

  const groups: Btn[][] = [
    [
      { label: 'Bold', icon: Bold, run: () => chain().toggleBold().run(), active: s.bold },
      { label: 'Italic', icon: Italic, run: () => chain().toggleItalic().run(), active: s.italic },
      { label: 'Strikethrough', icon: Strikethrough, run: () => chain().toggleStrike().run(), active: s.strike },
      { label: 'Inline code', icon: Code, run: () => chain().toggleCode().run(), active: s.code },
    ],
    [
      { label: 'Heading 1', icon: Heading1, run: () => chain().toggleHeading({ level: 1 }).run(), active: s.h1 },
      { label: 'Heading 2', icon: Heading2, run: () => chain().toggleHeading({ level: 2 }).run(), active: s.h2 },
      { label: 'Heading 3', icon: Heading3, run: () => chain().toggleHeading({ level: 3 }).run(), active: s.h3 },
    ],
    [
      { label: 'Bullet list', icon: List, run: () => chain().toggleBulletList().run(), active: s.bullet },
      { label: 'Numbered list', icon: ListOrdered, run: () => chain().toggleOrderedList().run(), active: s.ordered },
      { label: 'Checklist', icon: ListChecks, run: () => chain().toggleTaskList().run(), active: s.task },
      { label: 'Quote', icon: Quote, run: () => chain().toggleBlockquote().run(), active: s.quote },
      { label: 'Code block', icon: Code2, run: () => chain().toggleCodeBlock().run(), active: s.codeBlock },
      { label: 'Divider', icon: Minus, run: () => chain().setHorizontalRule().run() },
    ],
    [
      { label: 'Undo', icon: Undo2, run: () => chain().undo().run(), disabled: !s.canUndo },
      { label: 'Redo', icon: Redo2, run: () => chain().redo().run(), disabled: !s.canRedo },
    ],
  ]

  const applyLink = () => {
    const href = url.trim()
    if (!href) chain().unsetLink().run()
    // Only http(s)/mailto links: javascript: URLs must never be stored in a note.
    else if (/^(https?:\/\/|mailto:)/i.test(href)) chain().setLink({ href }).run()
    else chain().setLink({ href: `https://${href}` }).run()
    setLinking(false)
    setUrl('')
  }

  return (
    <div role="toolbar" aria-label="Formatting" className="glass flex flex-wrap items-center gap-1 rounded-xl p-1">
      {groups.map((g, i) => (
        <div key={i} className="flex items-center gap-0.5 border-r border-border pr-1 last:border-0">
          {g.map(({ label, icon: Icon, run, active, disabled }) => (
            <button
              key={label} type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled}
              onMouseDown={(e) => e.preventDefault()} onClick={run}
              className={cn('rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-30', active && 'bg-accent text-white hover:bg-accent')}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      ))}
      {linking ? (
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); applyLink() }}>
          <input
            autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Link URL"
            onKeyDown={(e) => e.key === 'Escape' && setLinking(false)}
            className="glass w-44 rounded-lg px-2 py-1 text-sm outline-none"
          />
          <button className="rounded-lg bg-accent px-2 py-1 text-sm text-white">Set</button>
        </form>
      ) : (
        <button
          type="button" title="Link" aria-label="Link" aria-pressed={s.link} onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setUrl(editor.getAttributes('link').href ?? ''); setLinking(true) }}
          className={cn('rounded-lg p-1.5 hover:bg-white/10', s.link && 'bg-accent text-white')}
        >
          <Link2 size={16} />
        </button>
      )}
    </div>
  )
}
