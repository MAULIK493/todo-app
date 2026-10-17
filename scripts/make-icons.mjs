#!/usr/bin/env node
// Renders the app icons (PNG) from public/favicon.svg. Run once after changing the logo: npm run icons
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const svg = readFileSync(fileURLToPath(new URL('../public/favicon.svg', import.meta.url)))
mkdirSync(fileURLToPath(new URL('../public/icons/', import.meta.url)), { recursive: true })
const out = (name) => fileURLToPath(new URL(`../public/icons/${name}`, import.meta.url))

// Regular icons: the artwork as drawn.
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out(name))
}

// Maskable icon: phones crop it to a circle or squircle, so the logo sits inside the central safe zone on a full-bleed
// gradient (no rounded corners of its own).
const bleed = Buffer.from(
  svg
    .toString()
    .replace(/ rx="16"/g, '')
    .replace(/<path d="M14 36[\s\S]*<\/svg>/, (art) => `<g transform="translate(9.6 9.6) scale(0.7)">${art.replace('</svg>', '')}</g></svg>`),
)
await sharp(bleed, { density: 384 }).resize(512, 512).png().toFile(out('maskable-512.png'))
console.log('Icons written to public/icons/')
