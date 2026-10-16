# Todo App

Todos, notes, rewards and an AI assistant in one installable web app. Workspaces keep personal and professional work
apart, and a private workspace is encrypted in the browser with a PIN, pattern or security code.

- **Todos**: subtasks, priorities, due dates, recurrence, tags, drag-and-drop, Kanban board, bulk actions, search, huge lists (virtualised, paged).
- **Notes**: rich text, checklists, pinning, folders, links to todos.
- **Rewards**: XP, levels, coins, streaks, achievements and a shop of your own real-life rewards (validated on the server).
- **Private workspaces**: end-to-end encrypted, auto-lock, recovery key.
- **Assistant**: chat and voice. Free for everyone by default (a free-tier model with a daily allowance, no key needed); people who want more can use their own key (Gemini, Groq, OpenRouter, OpenAI or Claude), which stays in their browser.
- **Look**: one dark theme over a drifting starfield, with lots of motion that automatically calms down on reduced-motion, low-battery or low-end devices.
- **Offline**: the last view stays available; adding and completing todos queue up and sync later.
- **Your data**: export (JSON/CSV), import, delete account.

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

Deployment: see [DEPLOY.md](DEPLOY.md). The original plan is in `plan.txt`.
