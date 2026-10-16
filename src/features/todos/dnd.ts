import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Todo } from './types'

export function useDndSensors() {
  return useSensors(
    // A small drag distance keeps plain clicks (open details) from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

/**
 * Which todo should sit directly above the dropped one? `list` is the target column/list as displayed,
 * `overId` the todo it was dropped on. Moving down lands after the target, moving up lands before it.
 */
export function anchorFor(list: Todo[], activeId: string, overId: string): string | null {
  const from = list.findIndex((t) => t.id === activeId)
  const over = list.findIndex((t) => t.id === overId)
  if (over < 0) return null
  if (from >= 0 && from < over) return list[over].id
  return over === 0 ? null : list[over - 1].id
}
