#!/usr/bin/env bash
# One-time setup of the free assistant on your Supabase project.
#   bash scripts/setup-free-assistant.sh
# It logs you in, links the project, stores your FREE-TIER AI key as a server secret (typed hidden, never printed,
# never sent to the browser), and deploys the two server functions. Run it in your own terminal.
set -euo pipefail
cd "$(dirname "$0")/.."

SB="npx --yes supabase@latest"

# The project reference is the first part of your project URL in .env.
ref="${SUPABASE_PROJECT_REF:-}"
if [ -z "$ref" ] && [ -f .env ]; then
  ref="$(sed -n 's#^VITE_SUPABASE_URL=https\?://\([a-z0-9]*\)\.supabase\.co.*#\1#p' .env | head -1)"
fi
[ -n "$ref" ] || { echo "Could not find your project reference. Run: SUPABASE_PROJECT_REF=<ref> bash $0"; exit 1; }
echo "Project: $ref"

echo; echo "1/4  Logging in to Supabase (a browser window may open)…"
$SB projects list >/dev/null 2>&1 || $SB login

echo; echo "2/4  Linking the project…"
[ -f supabase/config.toml ] || printf 'n\nn\n' | $SB init >/dev/null
$SB link --project-ref "$ref"

echo; echo "3/4  Your free AI key"
echo "     Create a FREE key (no card): Groq https://console.groq.com/keys  or  Gemini https://aistudio.google.com/apikey"
echo "     Do not attach billing, so it can never cost you anything."
read -r -p "     Which one did you use? (groq/gemini) [groq]: " provider
provider="${provider:-groq}"
case "$provider" in groq|gemini|openrouter) ;; *) echo "Use groq, gemini or openrouter."; exit 1 ;; esac
read -r -s -p "     Paste the key (nothing will show): " key; echo
[ -n "$key" ] || { echo "No key entered."; exit 1; }

# Passed through a private temporary file, not on the command line, so it never shows up in process lists or history.
envfile="$(mktemp)"; chmod 600 "$envfile"
trap 'rm -f "$envfile"' EXIT
printf 'FREE_LLM_PROVIDER=%s\nFREE_LLM_API_KEY=%s\n' "$provider" "$key" > "$envfile"
unset key
$SB secrets set --env-file "$envfile" --project-ref "$ref"
rm -f "$envfile"

echo; echo "4/4  Deploying the server functions…"
$SB functions deploy llm-proxy --project-ref "$ref" --use-api
$SB functions deploy delete-account --project-ref "$ref" --use-api

echo; echo "Checking…"
url="https://$ref.supabase.co/functions/v1/llm-proxy"
code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
if [ "$code" = "404" ]; then echo "The function still shows as missing (404). Wait a minute and try again."; else echo "llm-proxy is deployed (answered $code, which is expected without signing in)."; fi
echo; echo "Done. Open the app, open the assistant, and ask \"what's pending?\"."
