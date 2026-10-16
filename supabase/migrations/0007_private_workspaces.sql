-- Phase 6: private (locked) workspaces.
--
-- The server never sees a workspace's code or key. The browser encrypts todo/note content with a random
-- workspace key; that key is stored only in wrapped form (see src/features/security/crypto.ts). What the
-- database enforces here:
--   * once a workspace is 'locked', plaintext titles/content are REJECTED (so a buggy or malicious client,
--     or a future feature such as an import, cannot leak plaintext into it)
--   * lock columns can only change through the functions below, never by a direct UPDATE
--   * converting a workspace is a resumable, verified process (encrypting -> locked, decrypting -> none)
--
-- What stays visible to the server by design: the workspace name, counts, statuses, priorities, due dates
-- and timestamps. Tags and note folders are not available in private workspaces (their names would be visible).

-- 1. Lock columns ------------------------------------------------------------------------------
alter table public.workspaces
  add column lock_state text not null default 'none' check (lock_state in ('none', 'encrypting', 'locked', 'decrypting')),
  add column lock_type text check (lock_type in ('pin', 'pattern', 'password')),
  add column lock_salt text check (char_length(lock_salt) <= 100),
  add column lock_iterations int check (lock_iterations between 100000 and 5000000),
  add column wrapped_key text check (char_length(wrapped_key) <= 400),
  add column recovery_salt text check (char_length(recovery_salt) <= 100),
  add column recovery_wrapped_key text check (char_length(recovery_wrapped_key) <= 400),
  add constraint workspaces_lock_consistent check (
    (lock_state = 'none' and lock_type is null and lock_salt is null and lock_iterations is null
       and wrapped_key is null and recovery_salt is null and recovery_wrapped_key is null)
    or
    (lock_state <> 'none' and lock_type is not null and lock_salt is not null and lock_iterations is not null
       and wrapped_key is not null and ((recovery_salt is null) = (recovery_wrapped_key is null)))
  );

-- Clients may edit appearance/ordering, never the lock columns.
revoke insert, update on public.workspaces from authenticated;
grant insert (id, name, color, icon, position, background) on public.workspaces to authenticated;
grant update (name, color, icon, position, background) on public.workspaces to authenticated;

-- 2. Ciphertext is longer than plaintext; clients still enforce the real limits (500 / 300 / 20,000 chars).
alter table public.todos drop constraint todos_title_check;
alter table public.todos drop constraint todos_description_check;
alter table public.todos add constraint todos_title_check check (char_length(btrim(title)) between 1 and 2000);
alter table public.todos add constraint todos_description_check check (char_length(description) <= 30000);
alter table public.notes drop constraint notes_title_check;
alter table public.notes add constraint notes_title_check check (char_length(title) <= 2000);

-- 3. Reject plaintext in locked workspaces -----------------------------------------------------
create function public.enforce_encrypted_todo() returns trigger language plpgsql as $$
begin
  if (select lock_state from public.workspaces where id = new.workspace_id) = 'locked' then
    if new.title not like 'enc:v1:%' or (new.description <> '' and new.description not like 'enc:v1:%') then
      raise exception 'private workspaces only accept encrypted content';
    end if;
  end if;
  return new;
end $$;
create trigger todos_enforce_encrypted before insert or update of title, description, workspace_id on public.todos
for each row execute function public.enforce_encrypted_todo();

create function public.enforce_encrypted_note() returns trigger language plpgsql as $$
begin
  if (select lock_state from public.workspaces where id = new.workspace_id) = 'locked' then
    if new.title not like 'enc:v1:%' or (new.content ->> 'enc') is distinct from 'v1' or new.content_text <> '' then
      raise exception 'private workspaces only accept encrypted content';
    end if;
  end if;
  return new;
end $$;
create trigger notes_enforce_encrypted before insert or update of title, content, content_text, workspace_id on public.notes
for each row execute function public.enforce_encrypted_note();

create function public.block_names_in_private() returns trigger language plpgsql as $$
begin
  if (select lock_state from public.workspaces where id = new.workspace_id) = 'locked' then
    raise exception 'tags and folders are not available in private workspaces';
  end if;
  return new;
end $$;
create trigger tags_block_private before insert on public.tags for each row execute function public.block_names_in_private();
create trigger folders_block_private before insert on public.note_folders for each row execute function public.block_names_in_private();

-- Conversion rewrites every note; keep their order by not bumping updated_at for those writes only.
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.preserve_updated_at', true), '') = 'on' then
    new.updated_at := old.updated_at;
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;

-- 4. Lock lifecycle (SECURITY DEFINER because clients cannot write the lock columns) ----------
create function public.start_workspace_lock(
  p_ws uuid, p_type text, p_salt text, p_iter int, p_wrapped text, p_rec_salt text default null, p_rec_wrapped text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.workspaces where id = p_ws and owner_id = auth.uid() and lock_state = 'none') then
    raise exception 'workspace not found or already private';
  end if;
  update public.workspaces
  set lock_state = 'encrypting', lock_type = p_type, lock_salt = p_salt, lock_iterations = p_iter, wrapped_key = p_wrapped,
      recovery_salt = p_rec_salt, recovery_wrapped_key = p_rec_wrapped
  where id = p_ws;
end $$;

-- Replace the code and/or recovery key (the client re-wraps the same workspace key).
create function public.rewrap_workspace_key(
  p_ws uuid, p_type text, p_salt text, p_iter int, p_wrapped text, p_rec_salt text default null, p_rec_wrapped text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.workspaces where id = p_ws and owner_id = auth.uid() and lock_state in ('encrypting', 'locked')) then
    raise exception 'workspace not found or not private';
  end if;
  update public.workspaces
  set lock_type = p_type, lock_salt = p_salt, lock_iterations = p_iter, wrapped_key = p_wrapped,
      recovery_salt = p_rec_salt, recovery_wrapped_key = p_rec_wrapped
  where id = p_ws;
end $$;

-- Rows still needing work, as small JSON batches (invoker: RLS limits this to the caller's rows).
create function public.pending_counts(p_ws uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'plain_todos', (select count(*) from public.todos where workspace_id = p_ws
                    and (title not like 'enc:v1:%' or (description <> '' and description not like 'enc:v1:%'))),
    'plain_notes', (select count(*) from public.notes where workspace_id = p_ws
                    and (title not like 'enc:v1:%' or (content ->> 'enc') is distinct from 'v1' or content_text <> '')),
    'enc_todos',   (select count(*) from public.todos where workspace_id = p_ws
                    and (title like 'enc:v1:%' or description like 'enc:v1:%')),
    'enc_notes',   (select count(*) from public.notes where workspace_id = p_ws
                    and (title like 'enc:v1:%' or (content ->> 'enc') = 'v1')))
$$;

create function public.pending_encryption(p_ws uuid, p_limit int default 100) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'todos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'description', description))
                       from (select id, title, description from public.todos where workspace_id = p_ws
                             and (title not like 'enc:v1:%' or (description <> '' and description not like 'enc:v1:%'))
                             order by id limit least(p_limit, 500)) t), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'content', content))
                       from (select id, title, content from public.notes where workspace_id = p_ws
                             and (title not like 'enc:v1:%' or (content ->> 'enc') is distinct from 'v1' or content_text <> '')
                             order by id limit least(p_limit, 20)) n), '[]'::jsonb))
$$;

create function public.pending_decryption(p_ws uuid, p_limit int default 100) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'todos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'description', description))
                       from (select id, title, description from public.todos where workspace_id = p_ws
                             and (title like 'enc:v1:%' or description like 'enc:v1:%')
                             order by id limit least(p_limit, 500)) t), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'content', content))
                       from (select id, title, content from public.notes where workspace_id = p_ws
                             and (title like 'enc:v1:%' or (content ->> 'enc') = 'v1')
                             order by id limit least(p_limit, 20)) n), '[]'::jsonb))
$$;

-- Writes one converted batch. Only valid while a conversion is in progress; when encrypting, every value
-- must actually be ciphertext. Notes keep their updated_at so the list order survives conversion.
create function public.apply_batch(p_ws uuid, p_todos jsonb default '[]', p_notes jsonb default '[]') returns jsonb
language plpgsql as $$
declare
  st text;
  nt int;
  nn int;
begin
  select lock_state into st from public.workspaces where id = p_ws and owner_id = auth.uid();
  if st is null then raise exception 'workspace not found'; end if;
  if st not in ('encrypting', 'decrypting') then raise exception 'workspace is not being converted'; end if;

  if st = 'encrypting' then
    if exists (select 1 from jsonb_to_recordset(p_todos) as x(id uuid, title text, description text)
               where x.title not like 'enc:v1:%' or (x.description <> '' and x.description not like 'enc:v1:%'))
       or exists (select 1 from jsonb_to_recordset(p_notes) as x(id uuid, title text, content jsonb, content_text text)
               where x.title not like 'enc:v1:%' or (x.content ->> 'enc') is distinct from 'v1' or coalesce(x.content_text, '') <> '') then
      raise exception 'expected encrypted values';
    end if;
  end if;

  perform set_config('app.preserve_updated_at', 'on', true);
  update public.todos t set title = x.title, description = coalesce(x.description, '')
  from jsonb_to_recordset(p_todos) as x(id uuid, title text, description text)
  where t.id = x.id and t.workspace_id = p_ws;
  get diagnostics nt = row_count;

  update public.notes n set title = x.title, content = x.content, content_text = coalesce(x.content_text, '')
  from jsonb_to_recordset(p_notes) as x(id uuid, title text, content jsonb, content_text text)
  where n.id = x.id and n.workspace_id = p_ws;
  get diagnostics nn = row_count;
  perform set_config('app.preserve_updated_at', 'off', true);

  return jsonb_build_object('todos', nt, 'notes', nn);
end $$;

-- encrypting -> locked, but only once nothing in the workspace is still plaintext.
create function public.finish_workspace_lock(p_ws uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select lock_state into st from public.workspaces where id = p_ws and owner_id = auth.uid() for update;
  if st is distinct from 'encrypting' then raise exception 'workspace is not being encrypted'; end if;

  if exists (select 1 from public.todos where workspace_id = p_ws
             and (title not like 'enc:v1:%' or (description <> '' and description not like 'enc:v1:%')))
     or exists (select 1 from public.notes where workspace_id = p_ws
             and (title not like 'enc:v1:%' or (content ->> 'enc') is distinct from 'v1' or content_text <> '')) then
    raise exception 'plaintext content remains';
  end if;

  -- Tag and folder names would be visible, so they do not exist in private workspaces.
  delete from public.tags where workspace_id = p_ws;
  delete from public.note_folders where workspace_id = p_ws;
  -- Reward history written before the workspace was private may contain plaintext titles.
  update public.rewards_ledger set meta = jsonb_set(meta, '{title}', '"Private todo"')
  where user_id = auth.uid() and meta ? 'title' and todo_id in (select id from public.todos where workspace_id = p_ws);

  update public.workspaces set lock_state = 'locked' where id = p_ws;
end $$;

-- Begin removing the lock. Allowed from any converting/locked state so an interrupted conversion can be abandoned.
create function public.start_workspace_unlock(p_ws uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.workspaces where id = p_ws and owner_id = auth.uid() and lock_state in ('encrypting', 'locked', 'decrypting')) then
    raise exception 'workspace not found or not private';
  end if;
  update public.workspaces set lock_state = 'decrypting' where id = p_ws;
end $$;

-- decrypting -> none, only once nothing is still encrypted. Clears all key material.
create function public.finish_workspace_unlock(p_ws uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select lock_state into st from public.workspaces where id = p_ws and owner_id = auth.uid() for update;
  if st is distinct from 'decrypting' then raise exception 'workspace is not being decrypted'; end if;
  if exists (select 1 from public.todos where workspace_id = p_ws and (title like 'enc:v1:%' or description like 'enc:v1:%'))
     or exists (select 1 from public.notes where workspace_id = p_ws and (title like 'enc:v1:%' or (content ->> 'enc') = 'v1')) then
    raise exception 'encrypted content remains';
  end if;
  update public.workspaces
  set lock_state = 'none', lock_type = null, lock_salt = null, lock_iterations = null, wrapped_key = null,
      recovery_salt = null, recovery_wrapped_key = null
  where id = p_ws;
end $$;

-- 5. Rewards: never record a private todo's title -----------------------------------------------
create or replace function public.award_for_completion(p_todo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.todos;
  p public.profiles;
  today date;
  week_start date;
  v_kind text;
  v_xp int;
  v_pre int;
  v_coins int;
  v_on_time boolean := false;
  v_fast boolean := false;
  v_sub int := 0;
  v_today_xp int;
  v_streak int;
  v_freezes int;
  v_day_count int;
  v_week_count int;
  v_cap constant int := 500;
  v_private boolean;
begin
  if uid is null then return; end if;
  select * into t from public.todos where id = p_todo and owner_id = uid and status = 'done';
  if not found then return; end if;

  -- Row lock serialises concurrent completions for this user.
  select * into p from public.profiles where id = uid for update;
  if not found then return; end if;

  if exists (select 1 from public.rewards_ledger where user_id = uid and todo_id = p_todo and kind in ('complete', 'subtask')) then
    return;
  end if;

  -- Never copy a (possibly encrypted) title into the ledger for a private workspace.
  select lock_state <> 'none' into v_private from public.workspaces where id = t.workspace_id;
  v_private := coalesce(v_private, false);

  today := (now() at time zone p.timezone)::date;
  week_start := date_trunc('week', today::timestamp)::date;   -- weeks start on Monday

  if t.parent_id is null then
    v_kind := 'complete';
    v_on_time := t.due_at is not null and now() <= t.due_at;
    select count(*) into v_sub from public.todos where parent_id = t.id and status = 'done';
    v_xp := 10
      + case t.priority when 1 then 2 when 2 then 5 when 3 then 10 else 0 end
      + case when v_on_time then 5 else 0 end
      + least(v_sub * 3, 15);
  else
    v_kind := 'subtask';
    v_xp := 2;
  end if;

  -- Todos finished within seconds of being created earn almost nothing.
  if now() - t.created_at < interval '20 seconds' then
    v_fast := true;
    v_xp := least(v_xp, 1);
  end if;
  v_pre := v_xp;

  select coalesce(sum(xp), 0) into v_today_xp from public.rewards_ledger
  where user_id = uid and day = today and kind in ('complete', 'subtask');
  v_xp := least(v_xp, greatest(0, v_cap - v_today_xp));
  v_coins := case when v_xp = 0 then 0 else greatest(1, v_xp / 5) end;

  perform public.grant_reward(uid, v_kind, v_xp, v_coins, today, p_todo, null,
    jsonb_build_object('title', case when v_private then 'Private todo' else left(t.title, 100) end, 'priority', t.priority, 'on_time', v_on_time,
                       'fast', v_fast, 'capped', v_xp < v_pre, 'subtasks', v_sub));

  -- Streak: any day with an award counts. One missed day can be covered by a streak freeze.
  if v_xp > 0 then
    select * into p from public.profiles where id = uid;
    v_freezes := p.streak_freezes;
    if p.last_active_date = today then
      v_streak := greatest(p.current_streak, 1);
    elsif p.last_active_date = today - 1 then
      v_streak := p.current_streak + 1;
    elsif p.last_active_date = today - 2 and v_freezes > 0 then
      v_streak := p.current_streak + 1;
      v_freezes := v_freezes - 1;
      perform public.grant_reward(uid, 'freeze_used', 0, 0, today);
    else
      v_streak := 1;
    end if;
    if v_streak > p.current_streak and v_streak % 7 = 0 and v_freezes < 2 then
      v_freezes := v_freezes + 1;
      perform public.grant_reward(uid, 'freeze_earned', 0, 0, today);
    end if;
    update public.profiles
    set current_streak = v_streak, longest_streak = greatest(longest_streak, v_streak),
        last_active_date = today, streak_freezes = v_freezes
    where id = uid;
  end if;

  -- Goals (only meaningful completions count, so instant junk todos can't hit a goal).
  if v_kind = 'complete' and v_xp >= 5 then
    select * into p from public.profiles where id = uid;
    select count(*) filter (where day = today), count(*) into v_day_count, v_week_count
    from public.rewards_ledger
    where user_id = uid and kind = 'complete' and xp >= 5 and day >= week_start;
    if v_day_count >= p.daily_goal then
      perform public.grant_reward(uid, 'daily_goal', 0, 20, today, null, today::text);
    end if;
    if v_week_count >= p.weekly_goal then
      perform public.grant_reward(uid, 'weekly_goal', 0, 100, today, null, week_start::text);
    end if;
  end if;

  perform public.evaluate_achievements(uid, today);
end $$;

revoke execute on function
  public.enforce_encrypted_todo(), public.enforce_encrypted_note(), public.block_names_in_private(),
  public.start_workspace_lock(uuid, text, text, int, text, text, text), public.rewrap_workspace_key(uuid, text, text, int, text, text, text),
  public.pending_counts(uuid), public.pending_encryption(uuid, int), public.pending_decryption(uuid, int),
  public.apply_batch(uuid, jsonb, jsonb), public.finish_workspace_lock(uuid), public.start_workspace_unlock(uuid),
  public.finish_workspace_unlock(uuid), public.award_for_completion(uuid)
from public, anon;
grant execute on function
  public.start_workspace_lock(uuid, text, text, int, text, text, text), public.rewrap_workspace_key(uuid, text, text, int, text, text, text),
  public.pending_counts(uuid), public.pending_encryption(uuid, int), public.pending_decryption(uuid, int),
  public.apply_batch(uuid, jsonb, jsonb), public.finish_workspace_lock(uuid), public.start_workspace_unlock(uuid),
  public.finish_workspace_unlock(uuid), public.award_for_completion(uuid)
to authenticated;
