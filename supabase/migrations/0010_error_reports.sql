-- Phase 9: error monitoring. Crashes in the browser are reported here so they can be found and fixed.
--
-- Privacy: reports carry the message, a stack trace, the screen (ids removed), the app version and the browser name.
-- They never carry todo or note content. The browser scrubs emails, tokens and long secrets before sending, and this
-- function scrubs again, so a mistake on one side doesn't leak. Nobody can read the table through the API (there are
-- no policies); look at it in the Supabase dashboard or with the service role.

create table public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null,
  fingerprint text not null check (char_length(fingerprint) <= 64),
  message text not null check (char_length(message) <= 600),
  stack text check (char_length(stack) <= 4000),
  route text check (char_length(route) <= 200),
  release text check (char_length(release) <= 40),
  user_agent text check (char_length(user_agent) <= 300),
  context jsonb not null default '{}'::jsonb check (octet_length(context::text) <= 2000),
  created_at timestamptz not null default now()
);
create index client_errors_recent_idx on public.client_errors (created_at desc);
create index client_errors_fingerprint_idx on public.client_errors (fingerprint, created_at desc);

alter table public.client_errors enable row level security;
revoke all on public.client_errors from authenticated, anon;

-- Removes emails, login tokens and long opaque strings (keys, hashes) from a piece of text.
create function public.scrub_error_text(p_text text) returns text
language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p_text, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
             'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.?[A-Za-z0-9_-]*', '[token]', 'g'),
           '[A-Za-z0-9+/_=-]{40,}', '[redacted]', 'g')
$$;

create function public.report_client_error(
  p_fingerprint text, p_message text, p_stack text default null, p_route text default null,
  p_release text default null, p_user_agent text default null, p_context jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;  -- only signed-in users can report (keeps anonymous floods out)

  -- At most 30 reports per user per hour, and the same problem is recorded once per 10 minutes.
  if (select count(*) from public.client_errors where user_id = uid and created_at > now() - interval '1 hour') >= 30 then return; end if;
  if exists (select 1 from public.client_errors where user_id = uid and fingerprint = left(p_fingerprint, 64) and created_at > now() - interval '10 minutes') then return; end if;

  insert into public.client_errors (user_id, fingerprint, message, stack, route, release, user_agent, context)
  values (
    uid, left(coalesce(p_fingerprint, 'unknown'), 64),
    left(public.scrub_error_text(p_message), 600),
    nullif(left(public.scrub_error_text(p_stack), 4000), ''),
    left(public.scrub_error_text(p_route), 200),
    left(p_release, 40), left(p_user_agent, 300),
    case when jsonb_typeof(p_context) = 'object' and octet_length(p_context::text) <= 2000 then p_context else '{}'::jsonb end
  );
end $$;

-- Housekeeping: delete reports older than `p_days`. Run it on a schedule (see DEPLOY.md); not callable by app users.
create function public.purge_client_errors(p_days int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.client_errors where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.report_client_error(text, text, text, text, text, text, jsonb), public.scrub_error_text(text), public.purge_client_errors(int) from public, anon, authenticated;
grant execute on function public.report_client_error(text, text, text, text, text, text, jsonb) to authenticated;
