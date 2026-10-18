# Todo App

**One calm place for everything you need to do, remember and finish, with an assistant that helps and a reason to come back tomorrow.**

Todos, notes, rewards and an AI assistant in one installable web app. Workspaces keep personal and professional life apart, and a private workspace is encrypted in your browser so that not even the server can read it.

## Why this exists

Most todo apps are either too simple (a flat list that falls apart at 500 items) or too heavy (a project-management tool you dread opening). Notes live somewhere else, motivation lives nowhere, and "private" usually just means a UI lock over plaintext data.

This project is an attempt at the opposite:

- **Fast at any size.** Lists are virtualised and paged, so 100k+ todos feel the same as 10.
- **Todos and notes together.** Both belong to a workspace, and a note can link to a todo.
- **Motivating, not nagging.** XP, levels, coins, streaks and a shop of *your own* real-life rewards (a coffee, a movie night) turn finishing things into something you look forward to.
- **Genuinely private.** A private workspace is encrypted client-side with AES-GCM, and the key is wrapped by your PIN, pattern or security code. The database only ever holds ciphertext.
- **An assistant that knows your work.** Ask what's pending, plan your day, break a big task into steps, by chat or voice. It is free by default, and bring-your-own-key if you want more.
- **Works where you are.** Installable PWA, usable offline, and calm on slow devices and reduced-motion settings.

## Vision

The goal is a daily-driver app you actually want to open: quick to capture, clear about what matters today, and quietly rewarding to use.

What we hold ourselves to:

1. **Your data is yours.** Private means encrypted for real. Export everything (JSON/CSV), import it back, delete your account whenever you like.
2. **Free to start, honest about cost.** The assistant works for everyone with a daily allowance and no key. Power users can plug in Gemini, Groq, OpenRouter, OpenAI or Claude, and that key stays in their browser.
3. **Delight with restraint.** Rich motion and a drifting starfield, but everything automatically calms down on reduced-motion, low-battery or low-end devices.
4. **Extensible by design.** Features are self-contained modules over a Postgres schema with row-level security, so new capabilities (reminders, integrations, sharing, biometric unlock) slot in without rewrites.
5. **Trustworthy rewards.** XP and coins are awarded by server-side functions through an append-only ledger, so toggling done/undone can't be farmed.

## Features

- **Todos**: subtasks, priorities, due dates, recurrence, tags, drag-and-drop, Kanban board, bulk actions, search, huge lists (virtualised, paged).
- **Notes**: rich text, checklists, pinning, folders, links to todos.
- **Workspaces**: named, coloured and reorderable, shared by todos and notes.
- **Rewards**: XP, levels, coins, streaks, achievements and a shop of your own real-life rewards (validated on the server).
- **Private workspaces**: end-to-end encrypted, auto-lock, recovery key. A forgotten code without the recovery key means the data cannot be recovered, by design.
- **Assistant**: chat and voice, free tier by default, optional bring-your-own-key.
- **Look**: one dark theme over a drifting starfield, adaptive motion.
- **Offline**: the last view stays available; adding and completing todos queue up and sync later.
- **Your data**: export (JSON/CSV), import, delete account. See the in-app privacy policy.

## Tech stack

| Area | Choice |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| State and data | TanStack Query (with offline persistence), Zustand, TanStack Virtual |
| Editor and interaction | TipTap, dnd-kit, Motion, canvas-confetti |
| Backend | Supabase: Postgres with row-level security, Auth, Edge Functions (Deno), Storage |
| Security | Web Crypto API (key derivation and AES-GCM) |
| PWA | vite-plugin-pwa |
| Quality | Vitest, Testing Library, oxlint, a bundle-size budget, database policy tests |

## Project layout

```
src/
  features/       todos, notes, workspaces, rewards, assistant, security,
                  offline, voice, appearance, auth, landing, data
  components/     app shell, sidebar, shared UI and motion effects
supabase/
  migrations/     schema, RLS policies and server-side functions
  functions/      edge functions: llm-proxy, stt, delete-account
  tests/          database policy tests
scripts/          bundle budget, icon generation, DB test runner
```

## Develop

```bash
cp .env.example .env     # add your Supabase URL and anon key
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm test` | unit and component tests |
| `npm run test:db` | database policy/function tests on a throwaway local Postgres 15+ |
| `npm run lint` | lint |
| `npm run build` | type-check and production build |
| `npm run check:budget` | fail if the bundle outgrows `scripts/budget.json` |
| `npm run icons` | regenerate the app icons from `public/favicon.svg` |

## Deploy

See [DEPLOY.md](DEPLOY.md). The original plan and roadmap are in [plan.txt](plan.txt).
