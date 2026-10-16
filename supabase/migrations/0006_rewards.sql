-- Phase 5: rewards. XP, levels, coins, streaks, goals, achievements and a reward shop.
--
-- Trust model: clients can READ their rewards but never write them. Every change goes through
-- SECURITY DEFINER functions below that validate against the database itself:
--   * one award per todo, ever (unique index) -> reopen/complete cannot be farmed
--   * a daily XP cap and a "completed within seconds of creation" penalty limit junk-todo farming
--   * time comes from now(), never from client-supplied timestamps
--   * the ledger is append-only; balances on `profiles` change only inside these functions.

-- 1. Profile columns ---------------------------------------------------------------------------
-- Profiles created before the trigger in 0001 existed.
insert into public.profiles (id) select id from auth.users on conflict do nothing;

alter table public.profiles
  add column last_active_date date,
  add column streak_freezes int not null default 0 check (streak_freezes between 0 and 2),
  add column daily_goal int not null default 3 check (daily_goal between 1 and 100),
  add column weekly_goal int not null default 15 check (weekly_goal between 1 and 700),
  add column timezone text not null default 'UTC',
  add constraint profiles_coins_nonneg check (coins >= 0);

-- Users may tune their goals; everything else on profiles stays server-controlled.
grant update (daily_goal, weekly_goal) on public.profiles to authenticated;

-- 2. Level curve: level L starts at 50*L*(L-1) XP (L2=100, L3=300, L4=600, L5=1000 ...) ---------
create function public.level_for_xp(p_xp bigint) returns int
language sql immutable as $$
  select greatest(1, floor((1 + sqrt(1 + p_xp::numeric / 12.5)) / 2))::int
$$;

-- 3. Ledger -------------------------------------------------------------------------------------
create table public.rewards_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in
    ('complete', 'subtask', 'daily_goal', 'weekly_goal', 'achievement', 'freeze_earned', 'freeze_used', 'redeem', 'purchase')),
  xp int not null default 0,
  coins int not null default 0,
  -- Deliberately no FK: the "already rewarded" record must survive deleting (and undo-restoring) the todo.
  todo_id uuid,
  ref text,
  day date not null,                -- the user's local date when it happened
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (kind in ('redeem', 'purchase') or (xp >= 0 and coins >= 0))
);
create unique index ledger_one_award_per_todo on public.rewards_ledger (user_id, todo_id)
  where kind in ('complete', 'subtask') and todo_id is not null;
create unique index ledger_one_per_ref on public.rewards_ledger (user_id, kind, ref)
  where kind in ('achievement', 'daily_goal', 'weekly_goal');
create index ledger_user_day_idx on public.rewards_ledger (user_id, day, kind);
create index ledger_user_recent_idx on public.rewards_ledger (user_id, id desc);

alter table public.rewards_ledger enable row level security;
create policy "own ledger select" on public.rewards_ledger for select using (user_id = auth.uid());
revoke insert, update, delete on public.rewards_ledger from authenticated, anon;

-- 4. Achievements -------------------------------------------------------------------------------
create table public.achievements (
  code text primary key,
  name text not null,
  description text not null,
  icon text not null,
  metric text not null check (metric in ('total_completed', 'high_priority', 'on_time', 'streak', 'level')),
  threshold int not null check (threshold > 0),
  xp_reward int not null default 0,
  coin_reward int not null default 0,
  sort int not null default 0
);
alter table public.achievements enable row level security;
create policy "achievements readable" on public.achievements for select to authenticated using (true);
revoke insert, update, delete on public.achievements from authenticated, anon;

create table public.user_achievements (
  user_id uuid not null references auth.users on delete cascade,
  code text not null references public.achievements on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);
alter table public.user_achievements enable row level security;
create policy "own achievements select" on public.user_achievements for select using (user_id = auth.uid());
revoke insert, update, delete on public.user_achievements from authenticated, anon;

insert into public.achievements (code, name, description, icon, metric, threshold, xp_reward, coin_reward, sort) values
  ('first_step',     'First Step',       'Complete your first todo',           'footprints', 'total_completed', 1,    10,  5,   10),
  ('getting_going',  'Getting Going',    'Complete 10 todos',                  'zap',        'total_completed', 10,   25,  10,  20),
  ('on_a_roll',      'On a Roll',        'Complete 50 todos',                  'flame',      'total_completed', 50,   50,  25,  30),
  ('centurion',      'Centurion',        'Complete 100 todos',                 'medal',      'total_completed', 100,  100, 50,  40),
  ('powerhouse',     'Powerhouse',       'Complete 500 todos',                 'rocket',     'total_completed', 500,  300, 150, 50),
  ('legend',         'Legend',           'Complete 1,000 todos',               'crown',      'total_completed', 1000, 600, 300, 60),
  ('streak_3',       'Warming Up',       'Reach a 3-day streak',               'flame',      'streak',          3,    15,  5,   70),
  ('streak_7',       'Week Warrior',     'Reach a 7-day streak',               'calendar-check', 'streak',      7,    40,  20,  80),
  ('streak_30',      'Habit Master',     'Reach a 30-day streak',              'mountain',   'streak',          30,   150, 75,  90),
  ('streak_100',     'Unstoppable',      'Reach a 100-day streak',             'trophy',     'streak',          100,  500, 250, 100),
  ('level_5',        'Rising Star',      'Reach level 5',                      'star',       'level',           5,    50,  25,  110),
  ('level_10',       'Veteran',          'Reach level 10',                     'shield',     'level',           10,   100, 50,  120),
  ('level_25',       'Elite',            'Reach level 25',                     'crown',      'level',           25,   300, 150, 130),
  ('priority_pro',   'Priority Pro',     'Complete 25 high-priority todos',    'target',     'high_priority',   25,   50,  25,  140),
  ('punctual',       'Always on Time',   'Finish 25 todos before their due time', 'clock',   'on_time',         25,   50,  25,  150);

-- 5. Reward shop (user-defined real-life rewards, bought with coins) ----------------------------
create table public.reward_shop_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  icon text not null default 'gift',
  cost_coins int not null check (cost_coins between 1 and 100000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index shop_items_owner_idx on public.reward_shop_items (owner_id, created_at);

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  item_id uuid references public.reward_shop_items on delete set null,
  item_name text not null,                       -- snapshot, survives item edits/deletes
  cost_coins int not null,
  created_at timestamptz not null default now()
);
create index redemptions_owner_idx on public.redemptions (owner_id, created_at desc);

alter table public.reward_shop_items enable row level security;
alter table public.redemptions enable row level security;
create policy "own items select" on public.reward_shop_items for select using (owner_id = auth.uid());
create policy "own items insert" on public.reward_shop_items for insert with check (owner_id = auth.uid());
create policy "own items update" on public.reward_shop_items for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own items delete" on public.reward_shop_items for delete using (owner_id = auth.uid());
create policy "own redemptions select" on public.redemptions for select using (owner_id = auth.uid());
revoke insert, update, delete on public.redemptions from authenticated, anon;

-- 6. Todos: creation time must be trustworthy (it feeds the anti-farming check) ----------------
create function public.force_created_at() returns trigger language plpgsql as $$
begin
  new.created_at := now();
  return new;
end $$;
create trigger todos_force_created_at before insert on public.todos
for each row execute function public.force_created_at();

-- 7. Internal helpers (not callable by clients) -------------------------------------------------
-- Appends one ledger row and applies it to the profile. Returns false if the unique indexes say it
-- was already granted.
create function public.grant_reward(
  p_user uuid, p_kind text, p_xp int, p_coins int, p_day date,
  p_todo uuid default null, p_ref text default null, p_meta jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.rewards_ledger (user_id, kind, xp, coins, todo_id, ref, day, meta)
  values (p_user, p_kind, p_xp, p_coins, p_todo, p_ref, p_day, p_meta)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;

  update public.profiles
  set xp = xp + p_xp, coins = coins + p_coins, level = public.level_for_xp(xp + p_xp)
  where id = p_user;
  return true;
end $$;

create function public.evaluate_achievements(p_user uuid, p_day date) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  a public.achievements;
  val bigint;
  unlocked int;
begin
  -- XP from an achievement can raise the level and unlock another, so allow a few passes.
  for pass in 1..3 loop
    unlocked := 0;
    select * into p from public.profiles where id = p_user;
    for a in
      select ac.* from public.achievements ac
      where not exists (select 1 from public.user_achievements ua where ua.user_id = p_user and ua.code = ac.code)
      order by ac.sort
    loop
      val := case a.metric
        when 'total_completed' then (select count(*) from public.rewards_ledger where user_id = p_user and kind = 'complete' and xp >= 5)
        when 'high_priority'   then (select count(*) from public.rewards_ledger where user_id = p_user and kind = 'complete' and xp >= 5 and (meta ->> 'priority') = '3')
        when 'on_time'         then (select count(*) from public.rewards_ledger where user_id = p_user and kind = 'complete' and xp >= 5 and (meta ->> 'on_time') = 'true')
        when 'streak'          then p.longest_streak
        when 'level'           then p.level
        else 0 end;
      if val >= a.threshold then
        insert into public.user_achievements (user_id, code) values (p_user, a.code) on conflict do nothing;
        perform public.grant_reward(p_user, 'achievement', a.xp_reward, a.coin_reward, p_day, null, a.code, jsonb_build_object('name', a.name));
        unlocked := unlocked + 1;
      end if;
    end loop;
    exit when unlocked = 0;
  end loop;
end $$;

-- 8. Awarding a completion ---------------------------------------------------------------------
-- Called by complete_todo(). Safe to call directly: it only ever acts on the caller's own done todo,
-- and only once per todo.
create function public.award_for_completion(p_todo uuid) returns void
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
    jsonb_build_object('title', left(t.title, 100), 'priority', t.priority, 'on_time', v_on_time,
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

-- Replaces the Phase 3b version: same behaviour plus the reward.
create or replace function public.complete_todo(p_id uuid) returns void
language plpgsql as $$
declare
  t public.todos;
  step interval;
  nxt timestamptz;
  new_id uuid;
begin
  update public.todos set status = 'done', completed_at = now()
  where id = p_id and status <> 'done' returning * into t;
  if not found then return; end if;

  if t.recurrence is not null and t.due_at is not null then
    step := case t.recurrence when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end;
    nxt := t.due_at + step;
    while nxt <= now() loop nxt := nxt + step; end loop;
    insert into public.todos (workspace_id, title, description, priority, due_at, reminder_at, recurrence, spawned_from)
    values (t.workspace_id, t.title, t.description, t.priority, nxt,
            case when t.reminder_at is null then null else t.reminder_at + (nxt - t.due_at) end,
            t.recurrence, t.id)
    returning id into new_id;
    insert into public.todo_tags (todo_id, tag_id) select new_id, tag_id from public.todo_tags where todo_id = t.id;
  end if;

  perform public.award_for_completion(p_id);
end $$;

-- 9. Spending -----------------------------------------------------------------------------------
create function public.redeem_reward(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  it public.reward_shop_items;
  p public.profiles;
  today date;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into it from public.reward_shop_items where id = p_item and owner_id = uid and active;
  if not found then raise exception 'reward not found'; end if;
  select * into p from public.profiles where id = uid for update;
  if p.coins < it.cost_coins then raise exception 'not enough coins'; end if;

  today := (now() at time zone p.timezone)::date;
  perform public.grant_reward(uid, 'redeem', 0, -it.cost_coins, today, null, null, jsonb_build_object('item', it.name));
  insert into public.redemptions (owner_id, item_id, item_name, cost_coins) values (uid, it.id, it.name, it.cost_coins);
end $$;

create function public.buy_streak_freeze() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p public.profiles;
  today date;
  v_cost constant int := 100;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into p from public.profiles where id = uid for update;
  if p.streak_freezes >= 2 then raise exception 'you already hold the maximum of 2 freezes'; end if;
  if p.coins < v_cost then raise exception 'not enough coins'; end if;

  today := (now() at time zone p.timezone)::date;
  perform public.grant_reward(uid, 'purchase', 0, -v_cost, today, null, null, jsonb_build_object('item', 'Streak freeze'));
  update public.profiles set streak_freezes = streak_freezes + 1 where id = uid;
end $$;

-- Days roll over in the user's own timezone. Validated here because a bad zone name would break awards.
create function public.set_timezone(p_tz text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then raise exception 'unknown timezone'; end if;
  update public.profiles set timezone = p_tz where id = auth.uid();
end $$;

-- 10. One call that powers the whole rewards UI -------------------------------------------------
create function public.reward_summary() returns jsonb
language plpgsql stable as $$
declare
  uid uuid := auth.uid();
  p public.profiles;
  today date;
  week_start date;
  eff int;
begin
  select * into p from public.profiles where id = uid;
  if not found then return null; end if;
  today := (now() at time zone p.timezone)::date;
  week_start := date_trunc('week', today::timestamp)::date;

  -- A streak that has lapsed (and can't be saved by a freeze) shows as 0 even before the next award resets it.
  eff := case
    when p.last_active_date is null then 0
    when p.last_active_date >= today - 1 then p.current_streak
    when p.last_active_date = today - 2 and p.streak_freezes > 0 then p.current_streak
    else 0 end;

  return jsonb_build_object(
    'xp', p.xp, 'level', p.level,
    'level_start_xp', 50 * p.level * (p.level - 1),
    'next_level_xp', 50 * (p.level + 1) * p.level,
    'coins', p.coins,
    'streak', eff, 'longest_streak', p.longest_streak, 'freezes', p.streak_freezes,
    'active_today', coalesce(p.last_active_date = today, false),
    'daily_goal', p.daily_goal, 'weekly_goal', p.weekly_goal,
    'today_done', (select count(*) from public.rewards_ledger where user_id = uid and kind = 'complete' and xp >= 5 and day = today),
    'week_done', (select count(*) from public.rewards_ledger where user_id = uid and kind = 'complete' and xp >= 5 and day >= week_start),
    'today_xp', (select coalesce(sum(xp), 0) from public.rewards_ledger where user_id = uid and kind in ('complete', 'subtask') and day = today),
    'daily_xp_cap', 500,
    'timezone', p.timezone,
    'metrics', jsonb_build_object(
      'total_completed', (select count(*) from public.rewards_ledger where user_id = uid and kind = 'complete' and xp >= 5),
      'high_priority', (select count(*) from public.rewards_ledger where user_id = uid and kind = 'complete' and xp >= 5 and (meta ->> 'priority') = '3'),
      'on_time', (select count(*) from public.rewards_ledger where user_id = uid and kind = 'complete' and xp >= 5 and (meta ->> 'on_time') = 'true'),
      'streak', p.longest_streak,
      'level', p.level),
    'achievements', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'unlocked_at', unlocked_at)), '[]'::jsonb)
                     from public.user_achievements where user_id = uid)
  );
end $$;

revoke execute on function
  public.level_for_xp(bigint), public.grant_reward(uuid, text, int, int, date, uuid, text, jsonb),
  public.evaluate_achievements(uuid, date), public.award_for_completion(uuid), public.complete_todo(uuid),
  public.redeem_reward(uuid), public.buy_streak_freeze(), public.set_timezone(text), public.reward_summary()
from public, anon;
-- grant_reward / evaluate_achievements are internal: only the definer functions above call them.
revoke execute on function public.grant_reward(uuid, text, int, int, date, uuid, text, jsonb), public.evaluate_achievements(uuid, date) from authenticated;
grant execute on function
  public.level_for_xp(bigint), public.award_for_completion(uuid), public.complete_todo(uuid),
  public.redeem_reward(uuid), public.buy_streak_freeze(), public.set_timezone(text), public.reward_summary()
to authenticated;
