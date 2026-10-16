\set ON_ERROR_STOP on
\set u1 '''00000000-0000-0000-0000-0000000000a1'''
\set u2 '''00000000-0000-0000-0000-0000000000b2'''
\set u3 '''00000000-0000-0000-0000-0000000000c3'''
\set ws1 '''11111111-1111-1111-1111-111111111111'''
\set ws2 '''22222222-2222-2222-2222-222222222222'''
\set ws3 '''33333333-3333-3333-3333-333333333333'''
\set wsb '''44444444-4444-4444-4444-444444444444'''

create schema test;
grant usage on schema test to anon, authenticated;
create table test.ids (title text primary key, id uuid not null);
grant all on test.ids to authenticated;

create function test.eq(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL %: got %, expected %', label, actual, expected; end if;
  raise notice 'ok   %', label;
end $$;

create function test.throws(label text, q text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok   % [%]', label, sqlerrm; return; end;
  raise exception 'FAIL %: expected an error', label;
end $$;

-- fixture: insert a todo as the current user; aged = pretend it was created 5 minutes ago
create function test.mk(p_title text, p_ws uuid, p_priority int default 0, p_due timestamptz default null,
                        p_aged boolean default true, p_parent uuid default null) returns uuid
language plpgsql security definer as $$
declare v uuid;
begin
  insert into public.todos (owner_id, workspace_id, title, priority, due_at, parent_id)
  values (auth.uid(), p_ws, p_title, p_priority, p_due, p_parent) returning id into v;
  if p_aged then update public.todos set created_at = now() - interval '5 minutes' where id = v; end if;
  insert into test.ids values (p_title, v) on conflict (title) do update set id = excluded.id;
  return v;
end $$;
create function test.id(p_title text) returns uuid language sql as $$ select id from test.ids where title = p_title $$;
grant execute on all functions in schema test to authenticated, anon;

insert into auth.users (id) values (:u1), (:u2), (:u3);   -- trigger creates profiles
select test.eq('profiles created by trigger', (select count(*) from public.profiles), 3::bigint);

-- ===== user 1 =====
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
insert into public.workspaces (id, name) values (:ws1, 'W1');

select test.mk('a', :ws1);
select public.complete_todo(test.id('a'));
select test.eq('first completion: 10 xp + first_step 10', (select xp from public.profiles where id = auth.uid()), 20::bigint);
select test.eq('coins: 2 + 5', (select coins from public.profiles where id = auth.uid()), 7::bigint);
select test.eq('streak starts at 1', (select current_streak from public.profiles where id = auth.uid()), 1);
select test.eq('first_step unlocked', (select count(*) from public.user_achievements where code = 'first_step'), 1::bigint);

select public.reopen_todo(test.id('a'));
select public.complete_todo(test.id('a'));
select test.eq('reopen + recomplete earns nothing more', (select xp from public.profiles where id = auth.uid()), 20::bigint);

select test.mk('b', :ws1, 3, now() + interval '1 day');
select public.complete_todo(test.id('b'));
select test.eq('high priority + on time = 25 xp', (select xp from public.profiles where id = auth.uid()), 45::bigint);

select test.mk('c', :ws1, 0, null, false);
select public.complete_todo(test.id('c'));
select test.eq('instantly completed todo earns 1 xp', (select xp from public.profiles where id = auth.uid()), 46::bigint);

select test.mk('open one', :ws1);
select public.award_for_completion(test.id('open one'));
select test.eq('cannot award an open todo', (select xp from public.profiles where id = auth.uid()), 46::bigint);

select test.throws('cannot set own xp', 'update public.profiles set xp = 999999');
select test.throws('cannot set own coins', 'update public.profiles set coins = 999999');
select test.throws('cannot forge ledger rows', $$insert into public.rewards_ledger (user_id, kind, xp, coins, day) values (auth.uid(), 'complete', 500, 500, current_date)$$);
select test.throws('cannot forge achievements', $$insert into public.user_achievements (user_id, code) values (auth.uid(), 'legend')$$);
select test.throws('cannot call internal grant_reward', $$select public.grant_reward(auth.uid(), 'complete', 500, 500, current_date)$$);
select test.throws('cannot edit the ledger', 'update public.rewards_ledger set xp = 1000');
select test.throws('cannot delete the ledger', 'delete from public.rewards_ledger');
select test.throws('cannot edit achievement catalog', $$update public.achievements set xp_reward = 99999$$);
select test.throws('cannot create redemptions directly', $$insert into public.redemptions (owner_id, item_name, cost_coins) values (auth.uid(), 'x', 0)$$);

-- daily cap: 60 x 25xp todos can only ever yield 500 xp/day in total
do $$
declare i int; t uuid;
begin
  for i in 1..60 loop
    t := test.mk('cap' || i, '11111111-1111-1111-1111-111111111111', 3, now() + interval '1 day');
    perform public.complete_todo(t);
  end loop;
end $$;
select test.eq('daily xp capped at 500', (public.reward_summary() ->> 'today_xp')::int, 500);
select test.eq('over-cap completions recorded with 0 xp', (select count(*) > 0 from public.rewards_ledger where kind = 'complete' and xp = 0), true);
select test.eq('level consistent with xp', (select level from public.profiles where id = auth.uid()), public.level_for_xp((select xp from public.profiles where id = auth.uid())));
select test.eq('achievement: getting_going', (select count(*) from public.user_achievements where code = 'getting_going'), 1::bigint);
select test.eq('cap stops same-day farming of 25-todo achievements', (select count(*) from public.user_achievements where code in ('priority_pro', 'punctual', 'on_a_roll')), 0::bigint);
select test.eq('daily goal paid once', (select count(*) from public.rewards_ledger where kind = 'daily_goal'), 1::bigint);

-- subtasks and the parent bonus
select test.mk('parent', :ws1);
select test.mk('sub1', :ws1, 0, null, true, test.id('parent'));
select test.mk('sub2', :ws1, 0, null, true, test.id('parent'));
select public.complete_todo(test.id('sub1'));
select public.complete_todo(test.id('sub2'));
select public.complete_todo(test.id('parent'));
select test.eq('parent records subtask bonus', (select (meta ->> 'subtasks')::int from public.rewards_ledger where todo_id = test.id('parent')), 2);

-- recurrence keeps tags and advances the due date
select test.mk('rec', :ws1, 0, now() + interval '1 day');
update public.todos set recurrence = 'daily' where id = test.id('rec');
select public.set_todo_tags(test.id('rec'), array['Home', ' x ', 'home']);
select test.eq('tags normalised and deduped', (select count(*) from public.todo_tags where todo_id = test.id('rec')), 2::bigint);
select public.complete_todo(test.id('rec'));
select test.eq('next occurrence spawned', (select count(*) from public.todos where spawned_from = test.id('rec') and status = 'open' and due_at > now()), 1::bigint);
select test.eq('tags carried to next occurrence',
  (select count(*) from public.todo_tags tt join public.todos t on t.id = tt.todo_id where t.spawned_from = test.id('rec')), 2::bigint);
select public.reopen_todo(test.id('rec'));
select test.eq('undo removes the spawned occurrence', (select count(*) from public.todos where spawned_from = test.id('rec')), 0::bigint);

-- timezone
select public.set_timezone('Asia/Kolkata');
select test.eq('timezone saved', (select timezone from public.profiles where id = auth.uid()), 'Asia/Kolkata');
select test.throws('bad timezone rejected', $$select public.set_timezone('Not/AZone')$$);

select test.eq('level curve', array[public.level_for_xp(0), public.level_for_xp(99), public.level_for_xp(100), public.level_for_xp(300), public.level_for_xp(4500)], array[1, 1, 2, 3, 10]);

-- ===== ordering (move_todo) =====
insert into public.workspaces (id, name) values (:ws2, 'W2');
select test.mk('o1', :ws2); select test.mk('o2', :ws2); select test.mk('o3', :ws2);
reset role;
create function test.order_of(p_ws uuid) returns text language sql as
  $$ select string_agg(title, ',' order by position, id) from public.todos where workspace_id = p_ws and parent_id is null and status <> 'done' $$;
grant execute on function test.order_of(uuid) to authenticated;
set role authenticated;
select test.eq('newest first by default', test.order_of(:ws2), 'o3,o2,o1');
select public.move_todo(test.id('o1'), null);
select test.eq('move to top', test.order_of(:ws2), 'o1,o3,o2');
select public.move_todo(test.id('o1'), test.id('o2'));
select test.eq('move to bottom (after o2)', test.order_of(:ws2), 'o3,o2,o1');
select public.move_todo(test.id('o1'), test.id('o3'));
select test.eq('move into the middle', test.order_of(:ws2), 'o3,o1,o2');

-- repeatedly squeeze items between the same two neighbours: forces gap halving + rebalancing
do $$
declare i int; t uuid;
begin
  for i in 1..60 loop
    t := test.mk('sq' || i, '22222222-2222-2222-2222-222222222222');
    perform public.move_todo(t, test.id('o3'));
  end loop;
end $$;
select test.eq('squeeze keeps ends in place', (test.order_of(:ws2) like 'o3,sq60,sq59,%') and (test.order_of(:ws2) like '%,sq1,o1,o2'), true);
select test.eq('positions all distinct after rebalancing',
  (select count(distinct position) from public.todos where workspace_id = :ws2), (select count(*) from public.todos where workspace_id = :ws2));

-- kanban status move
select public.move_todo(test.id('o2'), null, 'in_progress');
select test.eq('moved to in_progress', (select status from public.todos where id = test.id('o2')), 'in_progress');
select public.complete_todo(test.id('o2'));
select public.move_todo(test.id('o2'), null, 'open');
select test.eq('dragging out of Done reopens', (select status from public.todos where id = test.id('o2')), 'open');
select test.throws('invalid kanban status rejected', format($f$select public.move_todo(%L, null, 'done')$f$, test.id('o1')));

-- ===== notes =====
insert into public.workspaces (id, name) values (:wsb, 'WB');
insert into public.notes (id, workspace_id, title, content_text) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', :ws1, 'N', 'hello world');
select test.eq('preview generated', (select preview from public.notes where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'hello world');
select test.eq('search matches prefix', (select count(*) from public.notes where search @@ to_tsquery('simple', 'hel:*')), 1::bigint);
create temp table t0 as select updated_at from public.notes where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select pg_sleep(0.01);
update public.notes set title = 'N2' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select test.eq('updated_at bumps on edit', (select n.updated_at > t0.updated_at from public.notes n, t0 where n.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), true);
select public.set_note_tags('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['Idea']);
select test.eq('note tag set', (select count(*) from public.note_tags), 1::bigint);
select test.throws('note cannot link a todo from another workspace',
  format($f$insert into public.note_todos (note_id, todo_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %L)$f$, test.id('o1')));
insert into public.note_todos (note_id, todo_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', test.id('a'));
select test.eq('note linked to same-workspace todo', (select count(*) from public.note_todos), 1::bigint);
insert into public.note_folders (id, workspace_id, name) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', :wsb, 'F');
select test.throws('note folder must be in the same workspace',
  $$update public.notes set folder_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$);
select public.set_todo_tags(test.id('o1'), array['wstag']);
select test.throws('note cannot use a tag from another workspace',
  $$insert into public.note_tags (note_id, tag_id) select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', id from public.tags where name = 'wstag'$$);
select test.throws('todo cannot use a tag from another workspace',
  format($f$insert into public.todo_tags (todo_id, tag_id) select %L, id from public.tags where name = 'wstag'$f$, test.id('a')));

-- ===== user 2: isolation =====
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select test.eq('u2 sees no workspaces', (select count(*) from public.workspaces), 0::bigint);
select test.eq('u2 sees no todos', (select count(*) from public.todos), 0::bigint);
select test.eq('u2 sees no notes', (select count(*) from public.notes), 0::bigint);
select test.eq('u2 sees no ledger', (select count(*) from public.rewards_ledger), 0::bigint);
select test.eq('u2 sees no tags', (select count(*) from public.tags), 0::bigint);
select test.throws('u2 cannot add todos to u1 workspace', format($f$insert into public.todos (workspace_id, title) values (%L, 'x')$f$, :ws1));
select test.throws('u2 cannot add notes to u1 workspace', format($f$insert into public.notes (workspace_id) values (%L)$f$, :ws1));
select public.complete_todo(test.id('open one'));   -- RLS hides it from u2, so this is a silent no-op
select test.eq('u2 cannot read u1 todo', (select count(*) from public.todos where id = test.id('open one')), 0::bigint);
reset role;
select test.eq('u1 todo untouched by u2', (select status from public.todos where id = test.id('open one')), 'open');

-- ===== user 3: goals, spending, streaks =====
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', false);
insert into public.workspaces (id, name) values (:ws3, 'W3');
select test.mk('g1', :ws3); select test.mk('g2', :ws3); select test.mk('g3', :ws3); select test.mk('g4', :ws3);
select public.complete_todo(test.id('g1')); select public.complete_todo(test.id('g2'));
select test.eq('no daily goal yet at 2 of 3', (select count(*) from public.rewards_ledger where kind = 'daily_goal'), 0::bigint);
select public.complete_todo(test.id('g3'));
select test.eq('daily goal paid at 3 of 3', (select count(*) from public.rewards_ledger where kind = 'daily_goal' and coins = 20), 1::bigint);
select public.complete_todo(test.id('g4'));
select test.eq('daily goal not paid twice', (select count(*) from public.rewards_ledger where kind = 'daily_goal'), 1::bigint);

-- spending
insert into public.reward_shop_items (name, cost_coins) values ('Coffee', 5), ('Holiday', 100000);
select test.eq('coins before purchase', (select coins from public.profiles where id = auth.uid()), 2::bigint * 4 + 5 + 20);
select public.redeem_reward((select id from public.reward_shop_items where name = 'Coffee'));
select test.eq('coins spent', (select coins from public.profiles where id = auth.uid()), 2::bigint * 4 + 5 + 20 - 5);
select test.eq('redemption recorded', (select count(*) from public.redemptions), 1::bigint);
select test.throws('cannot overspend', format($f$select public.redeem_reward(%L)$f$, (select id from public.reward_shop_items where name = 'Holiday')));
select test.eq('balance intact after failed purchase', (select coins from public.profiles where id = auth.uid()), 2::bigint * 4 + 5 + 20 - 5);
select test.throws('cannot buy a freeze without coins', 'select public.buy_streak_freeze()');

-- streaks (rewind last_active_date as the DB owner, then complete as the user)
reset role;
create function test.today() returns date language sql as $$ select (now() at time zone 'UTC')::date $$;
update public.profiles set last_active_date = test.today() - 1, current_streak = 4, longest_streak = 4 where id = :u3;
set role authenticated; select test.mk('s1', :ws3); select public.complete_todo(test.id('s1'));
select test.eq('consecutive day extends streak', (select current_streak from public.profiles where id = auth.uid()), 5);

reset role;
update public.profiles set last_active_date = test.today() - 2, streak_freezes = 1 where id = :u3;
set role authenticated; select test.mk('s2', :ws3); select public.complete_todo(test.id('s2'));
select test.eq('freeze bridges one missed day', (select current_streak from public.profiles where id = auth.uid()), 6);
select test.eq('freeze consumed', (select streak_freezes from public.profiles where id = auth.uid()), 0);
select test.eq('freeze usage logged', (select count(*) from public.rewards_ledger where kind = 'freeze_used'), 1::bigint);

reset role;
update public.profiles set last_active_date = test.today() - 3, streak_freezes = 2 where id = :u3;
set role authenticated;
select test.eq('lapsed streak displays as 0', (public.reward_summary() ->> 'streak')::int, 0);
select test.mk('s3', :ws3); select public.complete_todo(test.id('s3'));
select test.eq('streak resets after a long gap', (select current_streak from public.profiles where id = auth.uid()), 1);
select test.eq('longest streak remembered', (select longest_streak from public.profiles where id = auth.uid()), 6);

reset role;
update public.profiles set last_active_date = test.today() - 1, current_streak = 6, streak_freezes = 0, coins = 500 where id = :u3;
set role authenticated; select test.mk('s7', :ws3); select public.complete_todo(test.id('s7'));
select test.eq('7-day streak earns a freeze', (select streak_freezes from public.profiles where id = auth.uid()), 1);
select test.eq('week warrior unlocked', (select count(*) from public.user_achievements where code = 'streak_7'), 1::bigint);
select public.buy_streak_freeze();
select test.eq('bought a freeze', (select streak_freezes from public.profiles where id = auth.uid()), 2);
select test.throws('max 2 freezes', 'select public.buy_streak_freeze()');

select test.eq('summary has all fields', (select bool_and(public.reward_summary() ? k) from unnest(array['xp','level','coins','streak','freezes','today_done','week_done','metrics','achievements','timezone']) k), true);
\echo ALL TESTS PASSED
