import { describe, expect, it } from 'vitest'
import { CONFIRM_WORD, ownFilePaths, parseDeleteRequest } from './account.ts'

describe('parseDeleteRequest', () => {
  it('requires the exact confirmation word', () => {
    expect(parseDeleteRequest({ confirm: CONFIRM_WORD })).toEqual({ ok: true })
    for (const bad of [null, undefined, {}, { confirm: 'delete' }, { confirm: ' DELETE' }, { confirm: true }, { confirm: 'DELETE ' }, 'DELETE', []]) {
      expect(parseDeleteRequest(bad).ok, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('ownFilePaths', () => {
  it('turns a folder listing into full paths inside the user\'s folder only', () => {
    expect(ownFilePaths('u1', [{ name: 'a.webp' }, { name: 'b.mp4' }, { name: '.emptyFolderPlaceholder' }, { name: '' }, { name: '../other/x.png' }])).toEqual(['u1/a.webp', 'u1/b.mp4'])
  })
})
