import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToRgb } from '@/features/appearance/color'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const block = (selector: string) => css.match(new RegExp(`${selector.replace(/[[\]"]/g, '\\$&')}\\s*\\{([^}]*)\\}`))![1]
const tokens = (b: string) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))

const dark = tokens(block(':root'))

describe('text contrast (WCAG AA, 4.5:1)', () => {
  for (const bg of ['bg', 'surface-solid']) {
    for (const fg of ['text', 'muted', 'accent']) {
      it(`${fg} on ${bg}`, () => {
        expect(contrastRatio(hexToRgb(dark[fg]), hexToRgb(dark[bg]))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
