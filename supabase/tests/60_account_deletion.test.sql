\set ON_ERROR_STOP on
-- Deleting an account (the delete-account function deletes the auth user) must leave no trace of the person's data.
-- Fills every feature with data for one user, deletes them, then scans EVERY table in the public schema.
-- Relies on the test.* helpers created by 10_database.test.sql.

\set ud '''00000000-0000-0000-0000-0000000000d9'''
\set wsd '''d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0'''
\set wso '''e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0'''

reset role;
insert into auth.users (id) values (:ud), ('00000000-0000-0000-0000-0000000000da');   -- the second user must be untouched

set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d9', false);
insert into public.workspaces (id, name) values (:wsd, 'Everything');
select test.mk('del-parent', :wsd, 3, now() + interval '1 day');
select test.mk('del-child', :wsd, 0, null, true, test.id('del-parent'));
select public.set_todo_tags(test.id('del-parent'), array['alpha', 'beta']);
select public.complete_todo(test.id('del-child'));                   -- rewards ledger, streak, achievements
select public.complete_todo(test.id('del-parent'));
insert into public.note_folders (workspace_id, name) values (:wsd, 'F');
insert into public.notes (id, workspace_id, title, content_text) values ('abababab-abab-abab-abab-abababababab', :wsd, 'N', 'text');
select public.set_note_tags('abababab-abab-abab-abab-abababababab', array['gamma']);
insert into public.note_todos (note_id, todo_id) values ('abababab-abab-abab-abab-abababababab', test.id('del-parent'));
insert into public.reward_shop_items (name, cost_coins) values ('Coffee', 1);
select public.redeem_reward((select id from public.reward_shop_items));
insert into public.ai_conversations (id, title) values ('cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', 'Chat');
insert into public.ai_messages (conversation_id, role, content) values ('cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', 'user', 'hello');
select public.ai_record_usage(10, 10);
insert into public.ai_preferences (tone) values ('coach');
insert into public.ai_workspace_prefs (workspace_id, allowed) values (:wsd, true);
insert into public.ai_briefings (day, kind, content) values (current_date, 'morning', 'hi');
select public.report_client_error('del-fp', 'crash');

-- the other user has data too, which must survive
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000da', false);
insert into public.workspaces (id, name) values (:wso, 'Other person');
insert into public.todos (workspace_id, title) values (:wso, 'keep me');

-- sanity: the first user really has data in many tables
reset role;
create temp table before_counts as
select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where %I = %L', table_name, col, '00000000-0000-0000-0000-0000000000d9'), false, true, '')))[1]::text::int as n
from (select c.table_name, c.column_name as col from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name in ('user_id', 'owner_id', 'id') and c.data_type = 'uuid'
        and (c.column_name <> 'id' or c.table_name = 'profiles')) q;
select test.eq('user has rows in many tables before deletion', (select count(*) >= 14 from before_counts where n > 0), true);

-- delete the account
delete from auth.users where id = '00000000-0000-0000-0000-0000000000d9';

-- every table, by whichever column ties it to a person
do $$
declare r record; n int; leftovers text := '';
begin
  for r in
    select c.table_name, c.column_name as col
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type = 'uuid'
      and ((c.column_name in ('user_id', 'owner_id')) or (c.column_name = 'id' and c.table_name = 'profiles'))
  loop
    execute format('select count(*) from public.%I where %I = %L', r.table_name, r.col, '00000000-0000-0000-0000-0000000000d9') into n;
    if n > 0 then leftovers := leftovers || format('%s.%s=%s ', r.table_name, r.col, n); end if;
  end loop;
  assert leftovers = '', 'rows left behind after account deletion: ' || leftovers;
end $$;
select test.eq('no row in any table still belongs to the deleted user', true, true);

select test.eq('workspace content is gone', (select count(*) from public.todos where workspace_id = :wsd) + (select count(*) from public.notes where workspace_id = :wsd) + (select count(*) from public.tags where workspace_id = :wsd), 0::bigint);
select test.eq('error reports are kept, anonymously', (select count(*) from public.client_errors where fingerprint = 'del-fp' and user_id is null), 1::bigint);
select test.eq('another user is untouched', (select count(*) from public.todos where title = 'keep me') + (select count(*) from public.workspaces where id = :wso), 2::bigint);

\echo ALL TESTS PASSED
