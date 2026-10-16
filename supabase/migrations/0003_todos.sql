-- Phase 3: todos with subtasks, priorities, due dates, tags and recurrence.
-- Tags are a text[] column (GIN indexed) instead of a join table: simpler and fast enough for filtering.
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  parent_id uuid references public.todos on delete cascade,
  spawned_from uuid references public.todos on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  description text not null default '' check (char_length(description) <= 20000),
  status text not null default 'open' check (status in ('open', 'done')),
  priority smallint not null default 0 check (priority between 0 and 3),
  due_at timestamptz,
  reminder_at timestamptz,
  recurrence text check (recurrence in ('daily', 'weekly', 'monthly')),
  tags text[] not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', title || ' ' || description)) stored,
  check (recurrence is null or due_at is not null)
);

-- Keyset-pagination friendly indexes for each list view (top-level todos only).
create index todos_open_due_idx on public.todos (workspace_id, due_at, id) where parent_id is null and status = 'open';
create index todos_open_created_idx on public.todos (workspace_id, created_at desc, id desc) where parent_id is null and status = 'open';
create index todos_done_idx on public.todos (workspace_id, completed_at desc, id desc) where parent_id is null and status = 'done';
create index todos_parent_idx on public.todos (parent_id) where parent_id is not null;
create index todos_search_idx on public.todos using gin (search);
create index todos_tags_idx on public.todos using gin (tags);
create index todos_spawned_idx on public.todos (spawned_from) where spawned_from is not null;

alter table public.todos enable row level security;

create policy "own todos select" on public.todos for select using (owner_id = auth.uid());
create policy "own todos insert" on public.todos for insert with check (
  owner_id = auth.uid()
  and exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
  and (parent_id is null or exists (
    select 1 from public.todos p where p.id = parent_id and p.owner_id = auth.uid() and p.workspace_id = todos.workspace_id))
);
create policy "own todos update" on public.todos for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own todos delete" on public.todos for delete using (owner_id = auth.uid());

-- Completing a recurring todo atomically spawns the next occurrence.
-- Phase 5 extends this function to award XP/coins.
create function public.complete_todo(p_id uuid) returns void
language plpgsql as $$
declare
  t public.todos;
  step interval;
  nxt timestamptz;
begin
  update public.todos set status = 'done', completed_at = now()
  where id = p_id and status = 'open' returning * into t;
  if not found then return; end if;

  if t.recurrence is not null and t.due_at is not null then
    step := case t.recurrence when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end;
    nxt := t.due_at + step;
    while nxt <= now() loop nxt := nxt + step; end loop;
    insert into public.todos (workspace_id, title, description, priority, due_at, reminder_at, recurrence, tags, spawned_from)
    values (t.workspace_id, t.title, t.description, t.priority, nxt,
            case when t.reminder_at is null then null else t.reminder_at + (nxt - t.due_at) end,
            t.recurrence, t.tags, t.id);
  end if;
end $$;

-- Undo a completion; also removes the still-open occurrence it spawned.
create function public.reopen_todo(p_id uuid) returns void
language plpgsql as $$
begin
  update public.todos set status = 'open', completed_at = null where id = p_id and status = 'done';
  delete from public.todos where spawned_from = p_id and status = 'open';
end $$;

revoke execute on function public.complete_todo(uuid), public.reopen_todo(uuid) from public, anon;
grant execute on function public.complete_todo(uuid), public.reopen_todo(uuid) to authenticated;
