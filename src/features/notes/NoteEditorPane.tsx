import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useNote } from './api'
import { NoteEditor } from './NoteEditor'

export function EmptyNotePane() {
  return <div className="glass hidden flex-1 place-items-center rounded-xl p-8 text-muted md:grid">Select a note or create a new one.</div>
}

export function NoteEditorPane() {
  const { noteId, workspaceId } = useParams()
  const qc = useQueryClient()
  const { data: note, isLoading, error } = useNote(noteId)
  const [version, setVersion] = useState(0)

  if (isLoading) return <div className="glass h-full shimmer rounded-xl" aria-busy />
  if (error) return <p className="text-red-400" role="alert">Could not load note: {error.message}</p>
  if (!note || note.workspace_id !== workspaceId) return <Navigate to={`/w/${workspaceId}/notes`} replace />

  // The key remounts the editor (fresh content and save state) when switching notes or reloading after a conflict.
  return (
    <NoteEditor
      key={`${note.id}:${version}`} note={note}
      onReload={() => { qc.removeQueries({ queryKey: ['note', note.id] }); setVersion((v) => v + 1) }}
    />
  )
}
