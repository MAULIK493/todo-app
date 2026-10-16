import { describe, expect, it } from 'vitest'
import { anchorFor } from './dnd'
import type { Todo } from './types'

const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }) as Todo)

describe('anchorFor', () => {
  it('moving down lands after the todo it was dropped on', () => {
    expect(anchorFor(list, 'a', 'c')).toBe('c')
  })
  it('moving up lands before the todo it was dropped on', () => {
    expect(anchorFor(list, 'd', 'b')).toBe('a')
  })
  it('dropping on the first item moves to the top', () => {
    expect(anchorFor(list, 'c', 'a')).toBeNull()
  })
  it('cross-list drops (active not in target) land before the hovered item', () => {
    expect(anchorFor(list, 'x', 'c')).toBe('b')
    expect(anchorFor(list, 'x', 'a')).toBeNull()
  })
  it('unknown drop target gives no anchor', () => {
    expect(anchorFor(list, 'a', 'nope')).toBeNull()
  })
})
