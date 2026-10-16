import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  // Stamped into error reports so a problem can be matched to the release that caused it.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Todo App',
        short_name: 'Todo',
        description: 'Todos, notes, rewards and an AI assistant',
        theme_color: '#0b0b14',
        background_color: '#0b0b14',
        display: 'standalone',
        id: '/',
        start_url: '/',
        scope: '/',
        categories: ['productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely, the app changes often: keeping them in their own files lets browsers reuse the cached
        // copies after a deploy. (Heavy, rarely-used code like the note editor is split by lazy imports instead.)
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'vendor-react'
          if (id.includes('node_modules/@supabase/')) return 'vendor-supabase'
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion') || id.includes('node_modules/motion-')) return 'vendor-motion'
          if (id.includes('node_modules/@tanstack/')) return 'vendor-query'
          if (id.includes('node_modules/@dnd-kit/')) return 'vendor-dnd'
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'supabase/functions/_shared'),
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
})
