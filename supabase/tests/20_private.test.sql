\set ON_ERROR_STOP on
-- Private workspaces: conversion lifecycle, server-side ciphertext enforcement, lock-column protection.
-- Relies on the test.* helpers created by 10_database.test.sql.

\set u4 '''00000000-0000-0000-0000-0000000000d4'''
\set u5 '''00000000-0000-0000-0000-0000000000e5'''
\set wsp '''55555555-5555-5555-5555-555555555555'''
\set note1 '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set note2 '''cccccccc-cccc-cccc-cccc-cccccccccccc'''

reset role;
insert into auth.users (id) values (:u4), (:u5);

set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', false);
insert into public.workspaces (id, name) values (:wsp, 'Diary');

-- plaintext content that exists BEFORE the workspace becomes private
select test.mk('tp1', :wsp); select test.mk('tp2', :wsp);
update public.todos set description = 'secret details' where id = test.id('tp1');
select public.set_todo_tags(test.id('tp1'), array['hush']);
insert into public.note_folders (workspace_id, name) values (:wsp, 'Folder');
insert into public.notes (id, workspace_id, title, content, content_text)
  values (:note1, :wsp, 'My diary', '{"type":"doc"}', 'dear diary'), (:note2, :wsp, '', '{"type":"doc"}', '');
select public.complete_todo(test.id('tp1'));
select test.eq('plaintext title recorded in ledger before privacy', (select meta ->> 'title' from public.rewards_ledger where todo_id = test.id('tp1')), 'tp1');
create temp table before_order as select id, updated_at from public.notes where workspace_id = :wsp;

-- lock columns cannot be written directly
select test.throws('cannot set lock_state directly', format($f$update public.workspaces set lock_state = 'locked' where id = %L$f$, :wsp));
select test.throws('cannot set wrapped_key directly', format($f$update public.workspaces set wrapped_key = 'x' where id = %L$f$, :wsp));
select test.throws('cannot insert a pre-locked workspace', $$insert into public.workspaces (name, lock_state) values ('x', 'locked')$$);
update public.workspaces set name = 'Diary 2', color = '#ff0000' where id = :wsp;
select test.eq('appearance columns stay editable', (select name from public.workspaces where id = :wsp), 'Diary 2');

-- another user cannot lock, rewrap or convert it
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e5', false);
select test.throws('other user cannot start a lock',
  format($f$select public.start_workspace_lock(%L, 'pin', 's', 600000, 'w')$f$, :wsp));
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', false);

-- bad parameters are rejected
select test.throws('weak iteration count rejected', format($f$select public.start_workspace_lock(%L, 'pin', 's', 1000, 'w')$f$, :wsp));
select test.throws('unknown lock type rejected', format($f$select public.start_workspace_lock(%L, 'face', 's', 600000, 'w')$f$, :wsp));

select public.start_workspace_lock(:wsp, 'pin', 'c2FsdA==', 600000, 'v1.aXY=.Y3Q=', 'cnNhbHQ=', 'v1.aXY=.cmN0');
select test.eq('state is encrypting', (select lock_state from public.workspaces where id = :wsp), 'encrypting');
select test.throws('cannot start twice', format($f$select public.start_workspace_lock(%L, 'pin', 's', 600000, 'w')$f$, :wsp));
select test.eq('plaintext still counted', (public.pending_counts(:wsp) ->> 'plain_todos')::int, 2);
select test.throws('cannot finish while plaintext remains', format($f$select public.finish_workspace_lock(%L)$f$, :wsp));
select test.throws('encrypting batch must be ciphertext',
  format($f$select public.apply_batch(%L, jsonb_build_array(jsonb_build_object('id', %L::uuid, 'title', 'still plain', 'description', '')))$f$, :wsp, test.id('tp2')));
select test.throws('notes must be ciphertext too',
  format($f$select public.apply_batch(%L, '[]', jsonb_build_array(jsonb_build_object('id', %L::uuid, 'title', 'enc:v1:a:b', 'content', '{"type":"doc"}'::jsonb, 'content_text', '')))$f$, :wsp, :note1));

-- run the real conversion loop, a batch at a time
do $$
declare b jsonb; todos jsonb; notes jsonb; rounds int := 0;
begin
  loop
    b := public.pending_encryption('55555555-5555-5555-5555-555555555555', 1);
    exit when jsonb_array_length(b -> 'todos') = 0 and jsonb_array_length(b -> 'notes') = 0;
    rounds := rounds + 1;
    assert rounds < 20, 'conversion did not converge';
    select coalesce(jsonb_agg(jsonb_build_object('id', t ->> 'id', 'title', 'enc:v1:iv:' || (t ->> 'id'),
             'description', case when t ->> 'description' = '' then '' else 'enc:v1:iv:desc' end)), '[]') into todos
      from jsonb_array_elements(b -> 'todos') t;
    select coalesce(jsonb_agg(jsonb_build_object('id', n ->> 'id', 'title', 'enc:v1:iv:' || (n ->> 'id'),
             'content', jsonb_build_object('enc', 'v1', 'iv', 'a', 'ct', 'b'), 'content_text', '')), '[]') into notes
      from jsonb_array_elements(b -> 'notes') n;
    perform public.apply_batch('55555555-5555-5555-5555-555555555555', todos, notes);
  end loop;
end $$;
select test.eq('nothing plaintext after conversion', (public.pending_counts(:wsp) ->> 'plain_todos')::int + (public.pending_counts(:wsp) ->> 'plain_notes')::int, 0);
select test.eq('note order preserved by conversion',
  (select count(*) from public.notes n join before_order b using (id) where n.updated_at = b.updated_at), 2::bigint);

select public.finish_workspace_lock(:wsp);
select test.eq('state is locked', (select lock_state from public.workspaces where id = :wsp), 'locked');
select test.eq('tags removed', (select count(*) from public.tags where workspace_id = :wsp), 0::bigint);
select test.eq('folders removed', (select count(*) from public.note_folders where workspace_id = :wsp), 0::bigint);
select test.eq('ledger plaintext title scrubbed', (select meta ->> 'title' from public.rewards_ledger where todo_id = test.id('tp1')), 'Private todo');
select test.eq('no plaintext title anywhere in the todos table', (select count(*) from public.todos where workspace_id = :wsp and title not like 'enc:v1:%'), 0::bigint);
select test.eq('no plaintext description either', (select count(*) from public.todos where workspace_id = :wsp and description not in ('') and description not like 'enc:v1:%'), 0::bigint);

-- locked: the server refuses plaintext everywhere
select test.throws('plaintext todo rejected', format($f$insert into public.todos (workspace_id, title) values (%L, 'leak')$f$, :wsp));
select test.throws('plaintext description rejected', format($f$insert into public.todos (workspace_id, title, description) values (%L, 'enc:v1:a:b', 'leak')$f$, :wsp));
select test.throws('editing a title to plaintext rejected', format($f$update public.todos set title = 'leak' where id = %L$f$, test.id('tp2')));
select test.throws('plaintext note rejected', format($f$insert into public.notes (workspace_id, title) values (%L, 'leak')$f$, :wsp));
select test.throws('note plaintext search text rejected', format($f$update public.notes set content_text = 'leak' where id = %L$f$, :note1));
select test.throws('tags rejected', format($f$insert into public.tags (workspace_id, name) values (%L, 'x')$f$, :wsp));
select test.throws('folders rejected', format($f$insert into public.note_folders (workspace_id, name) values (%L, 'x')$f$, :wsp));
select test.throws('tags via rpc rejected', format($f$select public.set_todo_tags(%L, array['x'])$f$, test.id('tp2')));

-- ciphertext is accepted
insert into public.todos (id, workspace_id, title, description) values ('99999999-9999-9999-9999-999999999991', :wsp, 'enc:v1:x:y', 'enc:v1:x:z');
insert into public.notes (workspace_id, title, content) values (:wsp, 'enc:v1:t:t', '{"enc":"v1","iv":"i","ct":"c"}');
select test.eq('ciphertext todo + note accepted', (select count(*) from public.todos where workspace_id = :wsp and title = 'enc:v1:x:y'), 1::bigint);

-- everything that doesn't touch content keeps working
select public.complete_todo('99999999-9999-9999-9999-999999999991');
select test.eq('complete works', (select status from public.todos where id = '99999999-9999-9999-9999-999999999991'), 'done');
select test.eq('ledger never records a private title', (select meta ->> 'title' from public.rewards_ledger where todo_id = '99999999-9999-9999-9999-999999999991'), 'Private todo');
select public.move_todo(test.id('tp2'), null);
update public.todos set priority = 3, due_at = now() + interval '1 day', recurrence = 'daily' where id = test.id('tp2');
select public.complete_todo(test.id('tp2'));
select test.eq('recurring private todo spawns an encrypted copy', (select count(*) from public.todos where spawned_from = test.id('tp2') and title like 'enc:v1:%'), 1::bigint);
select public.reopen_todo(test.id('tp2'));
select public.complete_todos(array[test.id('tp2')]);
select public.delete_todos(array[test.id('tp2')]);
select test.eq('bulk functions work', (select count(*) from public.todos where id = test.id('tp2')), 0::bigint);

-- changing the code
select public.rewrap_workspace_key(:wsp, 'password', 'bmV3c2FsdA==', 600000, 'v1.bmV3.d3JhcA==');
select test.eq('rewrapped', (select lock_type || '/' || wrapped_key from public.workspaces where id = :wsp), 'password/v1.bmV3.d3JhcA==');
select test.eq('recovery key dropped when not re-issued', (select recovery_wrapped_key is null from public.workspaces where id = :wsp), true);

-- a stranger cannot unlock/convert
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e5', false);
select test.throws('stranger cannot start unlock', format($f$select public.start_workspace_unlock(%L)$f$, :wsp));
select test.throws('stranger cannot rewrap', format($f$select public.rewrap_workspace_key(%L, 'pin', 's', 600000, 'w')$f$, :wsp));
select test.throws('stranger cannot apply batches', format($f$select public.apply_batch(%L, '[]', '[]')$f$, :wsp));
select test.eq('stranger sees none of it', (select count(*) from public.workspaces), 0::bigint);
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', false);

select test.throws('batches only allowed during conversion', format($f$select public.apply_batch(%L, '[]', '[]')$f$, :wsp));
select test.throws('cannot finish unlock before decrypting', format($f$select public.finish_workspace_unlock(%L)$f$, :wsp));

-- remove the lock again
select public.start_workspace_unlock(:wsp);
select test.eq('state is decrypting', (select lock_state from public.workspaces where id = :wsp), 'decrypting');
select test.throws('cannot finish while ciphertext remains', format($f$select public.finish_workspace_unlock(%L)$f$, :wsp));
do $$
declare b jsonb; todos jsonb; notes jsonb; rounds int := 0;
begin
  loop
    b := public.pending_decryption('55555555-5555-5555-5555-555555555555', 100);
    exit when jsonb_array_length(b -> 'todos') = 0 and jsonb_array_length(b -> 'notes') = 0;
    rounds := rounds + 1;
    assert rounds < 20, 'decryption did not converge';
    select coalesce(jsonb_agg(jsonb_build_object('id', t ->> 'id', 'title', 'plain ' || left(t ->> 'id', 4), 'description', '')), '[]') into todos
      from jsonb_array_elements(b -> 'todos') t;
    select coalesce(jsonb_agg(jsonb_build_object('id', n ->> 'id', 'title', 'plain note', 'content', '{"type":"doc"}'::jsonb, 'content_text', 'restored text')), '[]') into notes
      from jsonb_array_elements(b -> 'notes') n;
    perform public.apply_batch('55555555-5555-5555-5555-555555555555', todos, notes);
  end loop;
end $$;
select public.finish_workspace_unlock(:wsp);
select test.eq('lock fully removed', (select lock_state || coalesce(wrapped_key, '') || coalesce(lock_salt, '') || coalesce(recovery_wrapped_key, '') from public.workspaces where id = :wsp), 'none');
select test.eq('search text restored for notes', (select count(*) from public.notes where workspace_id = :wsp and content_text = 'restored text'), 3::bigint);
insert into public.todos (workspace_id, title) values (:wsp, 'plaintext allowed again');
select public.set_todo_tags((select id from public.todos where title = 'plaintext allowed again'), array['ok']);
select test.eq('tags allowed again after unlocking', (select count(*) from public.tags where workspace_id = :wsp), 1::bigint);

\echo ALL TESTS PASSED
