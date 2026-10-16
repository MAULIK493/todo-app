-- Phase 3b: tags as real tables, manual ordering, "in progress" status for the Kanban board,
-- and bulk-action functions.

-- 1. Status: add 'in_progress' (Kanban middle column).
alter table public.todos drop constraint todos_status_check;
alter table public.todos add constraint todos_status_check check (status in ('open', 'in_progress', 'done'));

-- 2. Manual order. New todos default to the top (more negative = earlier), matching the old
--    "newest first" order. Gaps are halved on every move; move_todo() rebalances when they get tiny.
alter table public.todos add column position double precision not null default (-extract(epoch from clock_timestamp()));
update public.todos set position = -extract(epoch from created_at);

drop index public.todos_open_due_idx;
drop index public.todos_open_created_idx;
create index todos_active_due_idx on public.todos (workspace_id, due_at, id) where parent_id is null and status <> 'done';
create index todos_active_pos_idx on public.todos (workspace_id, position, id) where parent_id is null and status <> 'done';
create index todos_status_pos_idx on public.todos (workspace_id, status, position, id) where parent_id is null;

-- 3. Tags: per-workspace, case-insensitive (stored lowercase), many-to-many with todos.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 40 and name = lower(btrim(name))),
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table public.todo_tags (
  todo_id uuid not null references public.todos on delete cascade,
  tag_id uuid not null references public.tags on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (todo_id, tag_id)
);
create index todo_tags_tag_idx on public.todo_tags (tag_id, todo_id);

alter table public.tags enable row level security;
alter table public.todo_tags enable row level security;

create policy "own tags select" on public.tags for select using (owner_id = auth.uid());
create policy "own tags insert" on public.tags for insert with check (
  owner_id = auth.uid()
  and exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);
create policy "own tags update" on public.tags for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own tags delete" on public.tags for delete using (owner_id = auth.uid());

create policy "own todo_tags select" on public.todo_tags for select using (owner_id = auth.uid());
-- A link is only allowed between a todo and a tag that both belong to the caller and the same workspace.
create policy "own todo_tags insert" on public.todo_tags for insert with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.todos t join public.tags g on g.workspace_id = t.workspace_id
    where t.id = todo_tags.todo_id and g.id = todo_tags.tag_id
      and t.owner_id = auth.uid() and g.owner_id = auth.uid())
);
create policy "own todo_tags delete" on public.todo_tags for delete using (owner_id = auth.uid());

-- 4. Carry over existing text[] tags, then drop the old column.
insert into public.tags (owner_id, workspace_id, name)
select distinct t.owner_id, t.workspace_id, lower(btrim(x))
from public.todos t cross join lateral unnest(t.tags) as x
where char_length(lower(btrim(x))) between 1 and 40
on conflict do nothing;

insert into public.todo_tags (todo_id, tag_id, owner_id)
select distinct t.id, g.id, t.owner_id
from public.todos t
cross join lateral unnest(t.tags) as x
join public.tags g on g.workspace_id = t.workspace_id and g.name = lower(btrim(x))
on conflict do nothing;

drop index public.todos_tags_idx;
alter table public.todos drop column tags;

-- 5. Functions. All run as the caller (security invoker), so RLS applies.

-- Replaces the Phase 3 version: any non-done status can be completed, and tags carry over to the next occurrence.
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
end $$;

-- Replace a todo's tags with exactly this set of names (creating tags as needed).
create function public.set_todo_tags(p_todo uuid, p_names text[]) returns void
language plpgsql as $$
declare
  ws uuid;
  clean text[];
begin
  select workspace_id into ws from public.todos where id = p_todo;
  if not found then raise exception 'todo not found'; end if;

  select coalesce(array_agg(distinct s.n), '{}'::text[]) into clean
  from (select lower(btrim(x)) as n from unnest(coalesce(p_names, '{}'::text[])) x) s
  where char_length(s.n) between 1 and 40;

  insert into public.tags (workspace_id, name) select ws, unnest(clean) on conflict (workspace_id, name) do nothing;
  delete from public.todo_tags tt using public.tags g
  where tt.todo_id = p_todo and g.id = tt.tag_id and not (g.name = any(clean));
  insert into public.todo_tags (todo_id, tag_id)
  select p_todo, g.id from public.tags g where g.workspace_id = ws and g.name = any(clean)
  on conflict do nothing;
end $$;

create function public.rebalance_positions(p_workspace uuid) returns void
language sql as $$
  update public.todos t set position = r.rn * 1024.0
  from (select id, row_number() over (order by position, id) as rn
        from public.todos
        where workspace_id = p_workspace and parent_id is null and status <> 'done') r
  where t.id = r.id;
$$;

-- Move a todo to sit directly below p_after (null = top). The next neighbour is looked up here, so the
-- client only needs to know the item above, even when the list is only partly loaded.
-- p_status ('open' | 'in_progress') optionally moves it to another Kanban column in the same call.
create function public.move_todo(p_id uuid, p_after uuid default null, p_status text default null) returns void
language plpgsql as $$
declare
  t public.todos;
  prev_pos double precision;
  next_pos double precision;
  new_pos double precision;
  attempt int := 0;
begin
  select * into t from public.todos where id = p_id;
  if not found then raise exception 'todo not found'; end if;
  if p_status is not null and p_status not in ('open', 'in_progress') then raise exception 'invalid status'; end if;

  if p_status is not null then
    if t.status = 'done' then perform public.reopen_todo(p_id); end if;
    update public.todos set status = p_status where id = p_id;
  end if;

  loop
    if p_after is null then
      select min(position) - 1 into new_pos from public.todos
      where workspace_id = t.workspace_id and parent_id is null and status <> 'done' and id <> p_id;
      exit;
    end if;

    select position into prev_pos from public.todos where id = p_after;
    if not found then raise exception 'anchor todo not found'; end if;

    select position into next_pos from public.todos
    where workspace_id = t.workspace_id and parent_id is null and status <> 'done' and id <> p_id
      and (position, id) > (prev_pos, p_after)
    order by position, id limit 1;

    if not found then new_pos := prev_pos + 1; exit; end if;
    if next_pos - prev_pos >= 1e-6 or attempt > 0 then new_pos := (prev_pos + next_pos) / 2; exit; end if;

    perform public.rebalance_positions(t.workspace_id);
    attempt := attempt + 1;
  end loop;

  update public.todos set position = coalesce(new_pos, position) where id = p_id;
end $$;

-- Bulk actions take id arrays in the request body (a URL would be too long for thousands of ids).
create function public.complete_todos(p_ids uuid[]) returns void
language plpgsql as $$
declare i uuid;
begin
  if cardinality(p_ids) > 2000 then raise exception 'too many ids'; end if;
  foreach i in array p_ids loop perform public.complete_todo(i); end loop;
end $$;

create function public.reopen_todos(p_ids uuid[]) returns void
language plpgsql as $$
declare i uuid;
begin
  if cardinality(p_ids) > 2000 then raise exception 'too many ids'; end if;
  foreach i in array p_ids loop perform public.reopen_todo(i); end loop;
end $$;

create function public.delete_todos(p_ids uuid[]) returns void
language plpgsql as $$
begin
  if cardinality(p_ids) > 2000 then raise exception 'too many ids'; end if;
  delete from public.todos where id = any(p_ids);
end $$;

create function public.set_todos_priority(p_ids uuid[], p_priority smallint) returns void
language plpgsql as $$
begin
  if cardinality(p_ids) > 2000 then raise exception 'too many ids'; end if;
  update public.todos set priority = p_priority where id = any(p_ids);
end $$;

create function public.add_tag_to_todos(p_ids uuid[], p_name text) returns void
language plpgsql as $$
declare nm text := lower(btrim(p_name));
begin
  if cardinality(p_ids) > 2000 then raise exception 'too many ids'; end if;
  if char_length(nm) < 1 or char_length(nm) > 40 then raise exception 'invalid tag name'; end if;
  insert into public.tags (workspace_id, name)
  select distinct workspace_id, nm from public.todos where id = any(p_ids)
  on conflict do nothing;
  insert into public.todo_tags (todo_id, tag_id)
  select t.id, g.id from public.todos t join public.tags g on g.workspace_id = t.workspace_id and g.name = nm
  where t.id = any(p_ids)
  on conflict do nothing;
end $$;

revoke execute on function
  public.complete_todo(uuid), public.set_todo_tags(uuid, text[]), public.rebalance_positions(uuid),
  public.move_todo(uuid, uuid, text), public.complete_todos(uuid[]), public.reopen_todos(uuid[]),
  public.delete_todos(uuid[]), public.set_todos_priority(uuid[], smallint), public.add_tag_to_todos(uuid[], text)
from public, anon;
grant execute on function
  public.complete_todo(uuid), public.set_todo_tags(uuid, text[]), public.rebalance_positions(uuid),
  public.move_todo(uuid, uuid, text), public.complete_todos(uuid[]), public.reopen_todos(uuid[]),
  public.delete_todos(uuid[]), public.set_todos_priority(uuid[], smallint), public.add_tag_to_todos(uuid[], text)
to authenticated;
