# Edge Functions

| Function | Purpose |
| --- | --- |
| `llm-proxy` | The free assistant: forwards the app's AI calls to a free-tier model on a key kept as a secret, with a daily allowance per person. |
| `stt` | Optional speech-to-text fallback for browsers without built-in speech recognition. |
| `delete-account` | Deletes the signed-in person's account and everything they own. |

The assistant's logic (agent loop, tools, prompts) runs in the browser (`src/features/assistant/`), using `_shared/`,
which has no Deno- or network-specific code except `db.ts`, so it is unit-tested with `npm test`. `llm-proxy` only
forwards the model calls, so the free key never reaches the browser.

## Deploy

```bash
supabase secrets set FREE_LLM_PROVIDER=groq FREE_LLM_API_KEY=...   # a free-tier key, never Claude
supabase functions deploy llm-proxy
supabase functions deploy delete-account
supabase functions deploy stt            # optional, see below
```

Optional limits, used by `llm-proxy` and `stt` (all have defaults):

| Secret | Default | Meaning |
| --- | --- | --- |
| `AI_DAILY_REQUEST_LIMIT` | 200 | Requests per person per UTC day (each chat reply uses one to three) |
| `AI_DAILY_TOKEN_LIMIT` | 600000 | Tokens per person per UTC day |
| `AI_MONTHLY_TOKEN_LIMIT` | 4000000 | Tokens per person per calendar month |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided automatically.

## Voice input

Voice works out of the box in browsers that have speech recognition built in (Chrome, Edge, Safari): nothing to deploy.
For other browsers (Firefox), the app records a short clip and sends it to the `stt` function. Anthropic's API does not
take audio, so this needs a separate speech-to-text service of your choosing. Any service that offers the common
"audio transcriptions" HTTP shape (multipart `file` + `model`, JSON reply with `text`) works:

```bash
supabase secrets set STT_API_URL=https://<provider>/v1/audio/transcriptions
supabase secrets set STT_API_KEY=...
supabase secrets set STT_MODEL=...        # optional, default "whisper-1"
```

Without these, `stt` answers "not set up" and the app tells Firefox users that voice input isn't available. Audio is
forwarded to that provider for transcription and is not stored by this app; check the provider's own retention terms.
