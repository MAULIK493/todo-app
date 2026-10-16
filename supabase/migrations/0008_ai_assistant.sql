-- Phase 7: AI assistant (Claude). Chat history, usage limits, preferences, per-workspace access, briefings.
--
-- The assistant itself runs in Edge Functions (supabase/functions/ai-chat, ai-briefing) with the signed-in
-- user's own credentials, so every read and write it makes is already limited by the RLS policies on the
-- other tables. Nothing here gives the assistant any extra access.

-- 1. Conversations -------------------------------------------------------------------------------
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default 'New chat' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_recent_idx on public.ai_conversations (user_id, updated_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 20000),
  -- What the assistant did in this turn (created/completed todos...), shown as cards with Undo.
  actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at, id);

create function public.ai_touch_conversation() returns trigger language plpgsql as $$
begin
  update public.ai_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end $$;
create trigger ai_messages_touch after insert on public.ai_messages
for each row execute function public.ai_touch_conversation();

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy "own conversations select" on public.ai_conversations for select using (user_id = auth.uid());
create policy "own conversations insert" on public.ai_conversations for insert with check (user_id = auth.uid());
create policy "own conversations update" on public.ai_conversations for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own conversations delete" on public.ai_conversations for delete using (user_id = auth.uid());

create policy "own messages select" on public.ai_messages for select using (user_id = auth.uid());
-- A message can only be added to a conversation the caller owns.
create policy "own messages insert" on public.ai_messages for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())
);
create policy "own messages delete" on public.ai_messages for delete using (user_id = auth.uid());

-- 2. Usage limits --------------------------------------------------------------------------------
-- Token counts per UTC day. Clients can read their own usage but only the function below can add to it.
create table public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  requests int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy "own usage select" on public.ai_usage for select using (user_id = auth.uid());
revoke insert, update, delete on public.ai_usage from authenticated, anon;

create function public.ai_record_usage(p_input int, p_output int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_input < 0 or p_output < 0 or p_input > 5000000 or p_output > 5000000 then raise exception 'invalid usage'; end if;
  insert into public.ai_usage (user_id, day, requests, input_tokens, output_tokens)
  values (auth.uid(), (now() at time zone 'UTC')::date, 1, p_input, p_output)
  on conflict (user_id, day) do update
    set requests = public.ai_usage.requests + 1,
        input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
        output_tokens = public.ai_usage.output_tokens + excluded.output_tokens;
end $$;

create function public.ai_usage_summary() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'requests_today', coalesce((select sum(requests) from public.ai_usage where user_id = auth.uid() and day = (now() at time zone 'UTC')::date), 0),
    'tokens_today',   coalesce((select sum(input_tokens + output_tokens) from public.ai_usage where user_id = auth.uid() and day = (now() at time zone 'UTC')::date), 0),
    'tokens_month',   coalesce((select sum(input_tokens + output_tokens) from public.ai_usage where user_id = auth.uid() and day >= date_trunc('month', now() at time zone 'UTC')::date), 0))
$$;

-- 3. Preferences ---------------------------------------------------------------------------------
create table public.ai_preferences (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  tone text not null default 'friendly' check (tone in ('friendly', 'concise', 'coach')),
  briefing_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.ai_preferences enable row level security;
create policy "own prefs select" on public.ai_preferences for select using (user_id = auth.uid());
create policy "own prefs insert" on public.ai_preferences for insert with check (user_id = auth.uid());
create policy "own prefs update" on public.ai_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own prefs delete" on public.ai_preferences for delete using (user_id = auth.uid());

-- Which workspaces the assistant may see. No row means the default: allowed for normal workspaces,
-- never for private ones (they stay hidden unless the user opts in AND unlocks them in the browser).
create table public.ai_workspace_prefs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  allowed boolean not null,
  primary key (user_id, workspace_id)
);
alter table public.ai_workspace_prefs enable row level security;
create policy "own ws prefs select" on public.ai_workspace_prefs for select using (user_id = auth.uid());
create policy "own ws prefs insert" on public.ai_workspace_prefs for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);
create policy "own ws prefs update" on public.ai_workspace_prefs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own ws prefs delete" on public.ai_workspace_prefs for delete using (user_id = auth.uid());

-- 4. Briefings -----------------------------------------------------------------------------------
-- One morning and one evening summary per user per local day, generated the first time they are needed.
create table public.ai_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  kind text not null check (kind in ('morning', 'evening')),
  content text not null check (char_length(content) <= 5000),
  created_at timestamptz not null default now(),
  unique (user_id, day, kind)
);
alter table public.ai_briefings enable row level security;
create policy "own briefings select" on public.ai_briefings for select using (user_id = auth.uid());
create policy "own briefings insert" on public.ai_briefings for insert with check (user_id = auth.uid());
create policy "own briefings delete" on public.ai_briefings for delete using (user_id = auth.uid());

-- 5. Progress counts for the assistant's overview, in one query. Runs as the caller, so RLS applies.
create function public.ai_workspace_counts(p_workspaces uuid[], p_day_start timestamptz, p_day_end timestamptz, p_week_start timestamptz)
returns table (workspace_id uuid, open bigint, in_progress bigint, overdue bigint, due_today bigint, completed_this_week bigint)
language sql stable as $$
  select w.id,
         count(t.id) filter (where t.status = 'open'),
         count(t.id) filter (where t.status = 'in_progress'),
         count(t.id) filter (where t.status <> 'done' and t.due_at < now()),
         count(t.id) filter (where t.status <> 'done' and t.due_at >= p_day_start and t.due_at < p_day_end),
         count(t.id) filter (where t.status = 'done' and t.completed_at >= p_week_start)
  from unnest(p_workspaces) as w(id)
  left join public.todos t on t.workspace_id = w.id and t.parent_id is null
  group by w.id
$$;

revoke execute on function public.ai_record_usage(int, int), public.ai_usage_summary(), public.ai_touch_conversation(),
  public.ai_workspace_counts(uuid[], timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.ai_record_usage(int, int), public.ai_usage_summary(),
  public.ai_workspace_counts(uuid[], timestamptz, timestamptz, timestamptz) to authenticated;
