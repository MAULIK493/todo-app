import type { JSONContent } from '@tiptap/react'

export type NoteSummary = {
  id: string
  workspace_id: string
  folder_id: string | null
  title: string
  preview: string
  pinned: boolean
  updated_at: string
  tags: string[]
}

export type Note = NoteSummary & {
  content: JSONContent
  content_text: string
  created_at: string
}

export type NoteFolder = { id: string; name: string; position: number }

/** What the list shows: every note, only unfiled ones, or one folder. */
export type FolderFilter = 'all' | 'none' | string

export type LinkedTodo = { id: string; title: string; status: 'open' | 'in_progress' | 'done' }
