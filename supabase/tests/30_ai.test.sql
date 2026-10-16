\set ON_ERROR_STOP on
-- AI assistant tables: isolation, usage accounting, and what clients cannot write.
-- Relies on the test.* helpers created by 10_database.test.sql.

\set u6 '''00000000-0000-0000-0000-0000000000f6'''
\set u7 '''00000000-0000-0000-0000-000000000007'''
\set wsa '''66666666-6666-6666-6666-666666666666'''
\set conv '''77777777-7777-7777-7777-777777777777'''

reset role;
insert into auth.users (id) values (:u6), (:u7);

set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f6', false);
insert into public.workspaces (id, name) values (:wsa, 'Mine');
insert into public.ai_conversations (id, title) values (:conv, 'Planning');
insert into public.ai_messages (conversation_id, role, content) values (:conv, 'user', 'what is due today?');
select test.eq('message touches the conversation', (select updated_at > created_at from public.ai_conversations where id = :conv), true);
insert into public.ai_messages (conversation_id, role, content, actions)
  values (:conv, 'assistant', 'Two things.', '[{"kind":"created_todo","id":"x"}]');
select test.eq('history persisted in order', (select string_agg(role, ',' order by created_at, id) from public.ai_messages where conversation_id = :conv), 'user,assistant');
select test.throws('invalid role rejected', format($f$insert into public.ai_messages (conversation_id, role, content) values (%L, 'system', 'x')$f$, :conv));
select test.throws('oversized message rejected', format($f$insert into public.ai_messages (conversation_id, role, content) values (%L, 'user', repeat('x', 20001))$f$, :conv));

-- usage accounting
select test.eq('usage starts empty', (public.ai_usage_summary() ->> 'tokens_today')::int, 0);
select public.ai_record_usage(1000, 250);
select public.ai_record_usage(500, 100);
select test.eq('requests counted', (public.ai_usage_summary() ->> 'requests_today')::int, 2);
select test.eq('tokens summed', (public.ai_usage_summary() ->> 'tokens_today')::int, 1850);
select test.eq('month includes today', (public.ai_usage_summary() ->> 'tokens_month')::int, 1850);
select test.throws('negative usage rejected', 'select public.ai_record_usage(-1, 0)');
select test.throws('absurd usage rejected', 'select public.ai_record_usage(999999999, 0)');
select test.throws('cannot write usage directly', format($f$insert into public.ai_usage (user_id, day) values (auth.uid(), current_date)$f$));
select test.throws('cannot reset usage', 'update public.ai_usage set requests = 0');
select test.throws('cannot delete usage', 'delete from public.ai_usage');

-- progress counts (rows are only counted for the caller's own todos)
select test.mk('c-open', :wsa); select test.mk('c-doing', :wsa); select test.mk('c-late', :wsa); select test.mk('c-done', :wsa);
update public.todos set status = 'in_progress' where id = test.id('c-doing');
update public.todos set due_at = now() - interval '1 day' where id = test.id('c-late');
select public.complete_todo(test.id('c-done'));
select test.eq('counts per workspace',
  (select to_jsonb(c) - 'workspace_id' from public.ai_workspace_counts(array[:wsa::uuid], now() - interval '1 hour', now() + interval '1 hour', now() - interval '7 days') c),
  '{"open": 2, "overdue": 1, "due_today": 0, "in_progress": 1, "completed_this_week": 1}'::jsonb);
select test.eq('unknown workspaces count as zero',
  (select open from public.ai_workspace_counts(array['99999999-9999-9999-9999-999999999999'::uuid], now(), now(), now())), 0::bigint);

-- preferences
insert into public.ai_preferences (tone) values ('concise');
select test.throws('unknown tone rejected', $$update public.ai_preferences set tone = 'rude'$$);
insert into public.ai_workspace_prefs (workspace_id, allowed) values (:wsa, false);
-- the same upserts the app sends: user_id is never supplied, the column default fills it in
insert into public.ai_preferences (tone, briefing_enabled, updated_at) values ('coach', false, now())
  on conflict (user_id) do update set tone = excluded.tone, briefing_enabled = excluded.briefing_enabled, updated_at = excluded.updated_at;
select test.eq('preferences upsert updates the existing row', (select tone || ':' || briefing_enabled::text from public.ai_preferences), 'coach:false');
insert into public.ai_workspace_prefs (workspace_id, allowed) values (:wsa, true)
  on conflict (user_id, workspace_id) do update set allowed = excluded.allowed;
select test.eq('workspace access upsert flips the choice', (select count(*) || ':' || bool_and(allowed)::text from public.ai_workspace_prefs), '1:true');
insert into public.ai_workspace_prefs (workspace_id, allowed) values (:wsa, false)
  on conflict (user_id, workspace_id) do update set allowed = excluded.allowed;
select test.eq('workspace preference saved', (select allowed from public.ai_workspace_prefs where workspace_id = :wsa), false);

-- briefings are unique per day and kind
insert into public.ai_briefings (day, kind, content) values (current_date, 'morning', 'Good morning');
select test.throws('one morning briefing per day', $$insert into public.ai_briefings (day, kind, content) values (current_date, 'morning', 'again')$$);
insert into public.ai_briefings (day, kind, content) values (current_date, 'evening', 'Good evening');

-- another user sees none of it and cannot attach to it
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', false);
select test.eq('stranger sees no conversations', (select count(*) from public.ai_conversations), 0::bigint);
select test.eq('stranger sees no messages', (select count(*) from public.ai_messages), 0::bigint);
select test.eq('stranger gets no counts for my workspace', (select open from public.ai_workspace_counts(array[:wsa::uuid], now(), now(), now())), 0::bigint);
select test.eq('stranger sees no usage', (public.ai_usage_summary() ->> 'tokens_today')::int, 0);
select test.eq('stranger sees no briefings', (select count(*) from public.ai_briefings), 0::bigint);
select test.eq('stranger sees no preferences', (select count(*) from public.ai_preferences) + (select count(*) from public.ai_workspace_prefs), 0::bigint);
select test.throws('cannot write into another conversation', format($f$insert into public.ai_messages (conversation_id, role, content) values (%L, 'user', 'hi')$f$, :conv));
select test.throws('cannot set access for another workspace', format($f$insert into public.ai_workspace_prefs (workspace_id, allowed) values (%L, true)$f$, :wsa));
select test.throws('cannot forge a message for someone else', format($f$insert into public.ai_messages (conversation_id, user_id, role, content) values (%L, %L, 'user', 'x')$f$, :conv, '00000000-0000-0000-0000-0000000000f6'));

-- deleting a conversation removes its messages; deleting a workspace removes its access preference
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f6', false);
delete from public.ai_conversations where id = :conv;
select test.eq('messages cascade with the conversation', (select count(*) from public.ai_messages), 0::bigint);
delete from public.workspaces where id = :wsa;
select test.eq('workspace preference cascades', (select count(*) from public.ai_workspace_prefs), 0::bigint);

\echo ALL TESTS PASSED
