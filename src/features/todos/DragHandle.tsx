import { GripVertical } from 'lucide-react'
import type { HTMLAttributes } from 'react'

// touch-action: none lets a finger drag the handle without scrolling the list.
export function DragHandle(props: HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button" aria-label="Drag to reorder" onClick={(e) => e.stopPropagation()} {...props}
      // Reordering and swiping are different gestures: a press on the handle must not reach the swipe wrapper.
      onPointerDown={(e) => { props.onPointerDown?.(e); e.stopPropagation() }}
      className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted opacity-60 hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
    >
      <GripVertical size={16} />
    </button>
  )
}
