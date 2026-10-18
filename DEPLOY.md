# Deploying

Two pieces: a **Supabase project** (database, login, file storage, assistant functions) and a **static host** (Vercel) for the web app.

## 1. Supabase

1. Create a project at supabase.com. Note the project URL and the `anon` key (Project settings > API).
2. Install the CLI, then `supabase login` and `supabase link --project-ref <ref>`.
3. Apply the database, in order: `supabase db push` (runs `supabase/migrations/0001` to `0010`).
   Or paste each file into the SQL editor in that order.
4. Auth > Providers: enable Email, and Google if you want it. Auth > URL configuration: set **Site URL** to your
   deployed address and add it (and `http://localhost:5173`) to **Redirect URLs**.
5. Storage: migration 0009 creates a private `backgrounds` bucket. The app no longer uses it (there is one fixed look), so it stays empty; you can ignore it.
6. Edge Functions:

   ```bash
   supabase functions deploy llm-proxy                      # the free assistant
   supabase functions deploy delete-account                 # powers "Delete my account"
   supabase functions deploy stt                            # optional: voice for Firefox
   # only for stt:
   supabase secrets set STT_API_URL=... STT_API_KEY=... STT_MODEL=...
   ```

   Easiest: run `bash scripts/setup-free-assistant.sh`. It logs you in, links the project, asks for the free key (typed
   hidden, never printed or sent to the browser), stores it as a secret and deploys the functions.

   **The free assistant** (on by default for everyone, no setup for users) forwards to a free-tier model using a key
   you keep as a secret. It never uses Claude. Create a free key (no card needed) and set it once:

   ```bash
   # Groq: console.groq.com/keys   (fast; free daily limits)
   supabase secrets set FREE_LLM_PROVIDER=groq FREE_LLM_API_KEY=gsk_...
   # or Google Gemini: aistudio.google.com/apikey
   supabase secrets set FREE_LLM_PROVIDER=gemini FREE_LLM_API_KEY=...
   # optional: pick another model. Do this if a service retires its model (the assistant then says it is unavailable);
   # no redeploy is needed, it takes effect on the next message
   supabase secrets set FREE_LLM_MODEL=...
   ```

   Each person gets a daily allowance (default 200 model requests, roughly 50 to 100 chat messages;
   change it with `AI_DAILY_REQUEST_LIMIT`). All users share the free key's own limits, so if the app grows, people who
   want more can switch to their own key in Assistant settings (Gemini, Groq, OpenRouter, OpenAI or Claude), which is
   kept only in their browser. Until `FREE_LLM_API_KEY` is set, the assistant tells people to use their own key.
7. Old error reports: schedule `select public.purge_client_errors();` (Database > Cron, or pg_cron) daily.
8. Turn on daily backups (Project settings > Database > Backups; paid plans) if the data matters to you.

## 2. The web app

Environment variables on the host (build time): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

- **Vercel**: import the repo; `vercel.json` sets the build, single-page routing, security headers and caching.

The build runs `npm run check:budget`, which fails if the downloaded size grows past `scripts/budget.json`.

The content security policy in `vercel.json` only allows connections to `*.supabase.co` and to the five AI services the
assistant can use (Anthropic, OpenAI, Groq, OpenRouter, Google). If you use a custom Supabase domain, add it to
`connect-src`.

## 3. After deploying

- Open the site, sign up, add a todo, install it (browser menu > Install).
- Create a private workspace, **save the recovery key**, lock it, reload, unlock it.
- Settings > Your data: export a backup.
- Open the assistant and ask "what's pending?" (it should answer without asking for a key)

## Continuous integration

`.github/workflows/ci.yml` runs type-check, lint, unit tests, the database tests, the build, the size budget, and a scan
that no server secret reached the browser bundle.
