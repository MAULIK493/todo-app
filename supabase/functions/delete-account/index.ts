import { createClient } from '@supabase/supabase-js'
import { ownFilePaths, parseDeleteRequest } from '../_shared/account.ts'
import { CORS_HEADERS, jsonResponse } from '../_shared/http.ts'

// POST /functions/v1/delete-account  { confirm: "DELETE" }
//
// Permanently deletes the signed-in user's account. Their uploaded backgrounds are removed first; deleting the auth
// user then removes everything else, because every table references it with ON DELETE CASCADE (error reports keep
// only an anonymous row). This is the one function that uses the service role, and it only ever acts on the
// caller's own id, taken from their verified token, never from the request body.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = req.headers.get('Authorization')
  if (!url || !anon || !service) return jsonResponse({ code: 'not_configured', error: 'Account deletion is not set up.' }, 503)
  if (!authorization) return jsonResponse({ code: 'unauthorized', error: 'Please sign in.' }, 401)

  const asUser = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data } = await asUser.auth.getUser()
  const user = data.user
  if (!user) return jsonResponse({ code: 'unauthorized', error: 'Please sign in again.' }, 401)

  let body: unknown
  try { body = await req.json() } catch { body = null }
  const parsed = parseDeleteRequest(body)
  if (!parsed.ok) return jsonResponse({ code: 'bad_request', error: parsed.error }, 400)

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const { data: files } = await admin.storage.from('backgrounds').list(user.id, { limit: 1000 })
    const paths = ownFilePaths(user.id, files ?? [])
    if (paths.length) await admin.storage.from('backgrounds').remove(paths)

    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw error
    return jsonResponse({ deleted: true })
  } catch (e) {
    console.error('account deletion failed', e instanceof Error ? e.name : 'error')
    return jsonResponse({ code: 'server', error: 'Could not delete the account. Nothing was changed; please try again.' }, 500)
  }
})
