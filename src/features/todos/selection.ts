import type { Todo } from './types'

/** Multi-select state shared by the list and board. Keeps whole todos so bulk delete can be undone. */
export type Selection = {
  mode: boolean
  selected: Map<string, Todo>
  toggle: (t: Todo) => void
  setMany: (todos: Todo[], on: boolean) => void
}
