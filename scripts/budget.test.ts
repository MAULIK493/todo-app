// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript module
import { check, initialAssets, measure } from './check-budget.mjs'

const html = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-a.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-b.js">
<link rel="stylesheet" crossorigin href="/assets/index-c.css">
<link rel="icon" href="/favicon.svg"><script src="/registerSW.js"></script>
</head><body></body></html>`

function fixture(sizes: Record<string, number>) {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), html)
  // Random bytes don't compress, so the gzip size is close to the byte count.
  for (const [name, bytes] of Object.entries(sizes)) writeFileSync(join(dist, 'assets', name), randomBytes(bytes))
  return dist
}

describe('initialAssets', () => {
  it('lists what the first load needs and nothing else', () => {
    expect(initialAssets(html)).toEqual(['assets/index-a.js', 'assets/vendor-b.js', 'assets/index-c.css'])
  })
})

describe('budget check', () => {
  const budget = { initialJs: 100, initialCss: 20, largestLazyChunk: 50 }

  it('separates initial files from lazy chunks and measures both', () => {
    const r = measure(fixture({ 'index-a.js': 30_000, 'vendor-b.js': 20_000, 'index-c.css': 5_000, 'Notes-lazy.js': 40_000 }))
    expect(r.initialFiles).toBe(3)
    expect(r.initialJsKb).toBeGreaterThan(45)
    expect(r.initialJsKb).toBeLessThan(55)
    expect(r.initialCssKb).toBeGreaterThan(3)
    expect(r.lazy.map((c: { file: string }) => c.file)).toEqual(['Notes-lazy.js'])
    expect(check(r, budget)).toEqual([])
  })

  it('names every limit that is exceeded', () => {
    const r = measure(fixture({ 'index-a.js': 90_000, 'vendor-b.js': 60_000, 'index-c.css': 30_000, 'Big-lazy.js': 80_000 }))
    const problems = check(r, budget) as string[]
    expect(problems).toHaveLength(3)
    expect(problems.join(' ')).toMatch(/Initial JavaScript.*budget 100/)
    expect(problems.join(' ')).toMatch(/Initial CSS/)
    expect(problems.join(' ')).toMatch(/Big-lazy\.js/)
  })
})
