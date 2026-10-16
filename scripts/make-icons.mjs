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
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d4aff"/><stop offset="1" stop-color="#19c3ff"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><g transform="translate(9.6 9.6) scale(0.7)"><path d="M18 33.5l9.5 9.5L46 22" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`,
)
await sharp(bleed, { density: 384 }).resize(512, 512).png().toFile(out('maskable-512.png'))
console.log('Icons written to public/icons/')
