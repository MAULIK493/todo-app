#!/usr/bin/env node
// Fails the build when the app gets heavier than the agreed budget (scripts/budget.json).
// Usage: node scripts/check-budget.mjs [distDir]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const kb = (bytes) => bytes / 1024
const gz = (file) => gzipSync(readFileSync(file)).length

/** Files the browser must fetch before the page can start: module scripts, preloaded modules and stylesheets. */
export function initialAssets(html) {
  const found = new Set()
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const tag = m[0]
    const isScript = /^<script\b/.test(tag) && /type="module"/.test(tag)
    const isPreload = /rel="modulepreload"/.test(tag)
    const isStyle = /rel="stylesheet"/.test(tag)
    if (!isScript && !isPreload && !isStyle) continue
    const ref = /(?:src|href)="([^"]+)"/.exec(tag)?.[1]
    if (ref && ref.startsWith('/assets/')) found.add(ref.slice(1))
  }
  return [...found]
}

export function measure(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const initial = initialAssets(html)
  const sizes = Object.fromEntries(initial.map((f) => [f, gz(join(dist, f))]))
  const initialJs = Object.entries(sizes).filter(([f]) => f.endsWith('.js')).reduce((s, [, n]) => s + n, 0)
  const initialCss = Object.entries(sizes).filter(([f]) => f.endsWith('.css')).reduce((s, [, n]) => s + n, 0)

  const lazy = readdirSync(join(dist, 'assets'))
    .filter((f) => f.endsWith('.js') && !initial.includes(`assets/${f}`))
    .map((f) => ({ file: f, kb: kb(gz(join(dist, 'assets', f))) }))
    .sort((a, b) => b.kb - a.kb)

  return { initialJsKb: kb(initialJs), initialCssKb: kb(initialCss), initialFiles: initial.length, lazy }
}

export function check(result, budget) {
  const problems = []
  if (result.initialJsKb > budget.initialJs) problems.push(`Initial JavaScript is ${result.initialJsKb.toFixed(1)} KB (budget ${budget.initialJs} KB).`)
  if (result.initialCssKb > budget.initialCss) problems.push(`Initial CSS is ${result.initialCssKb.toFixed(1)} KB (budget ${budget.initialCss} KB).`)
  const big = result.lazy[0]
  if (big && big.kb > budget.largestLazyChunk) problems.push(`Lazy chunk ${big.file} is ${big.kb.toFixed(1)} KB (budget ${budget.largestLazyChunk} KB).`)
  return problems
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = process.argv[2] ?? 'dist'
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`No build found in ${dist}/. Run "npm run build" first.`)
    process.exit(2)
  }
  const budget = JSON.parse(readFileSync(new URL('./budget.json', import.meta.url), 'utf8'))
  const r = measure(dist)
  console.log(`Initial JS  ${r.initialJsKb.toFixed(1)} KB / ${budget.initialJs} KB   (${r.initialFiles} files)`)
  console.log(`Initial CSS ${r.initialCssKb.toFixed(1)} KB / ${budget.initialCss} KB`)
  console.log('Largest lazy chunks:')
  for (const c of r.lazy.slice(0, 4)) console.log(`  ${c.kb.toFixed(1).padStart(6)} KB  ${basename(c.file)}`)
  const problems = check(r, budget)
  if (problems.length) {
    console.error(`\nOver budget:\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
  console.log('\nWithin budget.')
}
