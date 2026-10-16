-- Load-test data: 100,000 todos for one workspace. Replace the two ids, then run in the SQL editor.
-- Run after migration 0004 (tags are a separate table; position defaults to newest-first).
do $$
declare
  v_user uuid := 'YOUR-USER-ID';
  v_workspace uuid := 'YOUR-WORKSPACE-ID';
  v_tag uuid;
begin
  insert into public.todos (owner_id, workspace_id, title, description, priority, status, due_at, completed_at, created_at, position)
  select v_user, v_workspace,
         'Seed todo ' || g,
         'Generated description for load testing ' || g,
         g % 4,
         case when g % 7 = 0 then 'done' when g % 11 = 0 then 'in_progress' else 'open' end,
         case when g % 3 = 0 then null else now() + (((g % 60) - 20) * interval '1 day') + ((g % 24) * interval '1 hour') end,
         case when g % 7 = 0 then now() - (g % 500) * interval '1 minute' end,
         now() - g * interval '1 second',
         g * 1024.0
  from generate_series(1, 100000) g;

  insert into public.tags (owner_id, workspace_id, name) values (v_user, v_workspace, 'work')
  on conflict (workspace_id, name) do update set name = excluded.name returning id into v_tag;

  insert into public.todo_tags (todo_id, tag_id, owner_id)
  select id, v_tag, v_user from public.todos
  where workspace_id = v_workspace and title like 'Seed todo %' and (substring(title from 11)::int % 5) = 0
  on conflict do nothing;
end $$;
