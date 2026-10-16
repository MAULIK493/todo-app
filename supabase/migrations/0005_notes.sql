-- Phase 4: notes with folders, tags (shared `tags` table) and links to todos.
-- Phase 6 will store title/content as ciphertext for private workspaces.

create table public.note_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index note_folders_ws_idx on public.note_folders (workspace_id, position);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  folder_id uuid references public.note_folders on delete set null,
  title text not null default '' check (char_length(title) <= 300),
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb
    check (octet_length(content::text) <= 1000000),
  -- Plain text of the editor content, kept in sync by the client; powers search and list previews.
  content_text text not null default '' check (char_length(content_text) <= 500000),
  preview text generated always as (left(content_text, 160)) stored,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', title || ' ' || content_text)) stored
);

-- Pinned notes are listed separately (few), the rest is keyset-paginated by recency.
create index notes_pinned_idx on public.notes (workspace_id, updated_at desc, id desc) where pinned;
create index notes_recent_idx on public.notes (workspace_id, updated_at desc, id desc) where not pinned;
create index notes_folder_idx on public.notes (folder_id) where folder_id is not null;
create index notes_search_idx on public.notes using gin (search);

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

create trigger notes_touch before update on public.notes
for each row execute function public.touch_updated_at();

create table public.note_tags (
  note_id uuid not null references public.notes on delete cascade,
  tag_id uuid not null references public.tags on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (note_id, tag_id)
);
create index note_tags_tag_idx on public.note_tags (tag_id, note_id);

create table public.note_todos (
  note_id uuid not null references public.notes on delete cascade,
  todo_id uuid not null references public.todos on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (note_id, todo_id)
);
create index note_todos_todo_idx on public.note_todos (todo_id, note_id);

alter table public.note_folders enable row level security;
alter table public.notes enable row level security;
alter table public.note_tags enable row level security;
alter table public.note_todos enable row level security;

create policy "own folders select" on public.note_folders for select using (owner_id = auth.uid());
create policy "own folders insert" on public.note_folders for insert with check (
  owner_id = auth.uid()
  and exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);
create policy "own folders update" on public.note_folders for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own folders delete" on public.note_folders for delete using (owner_id = auth.uid());

create policy "own notes select" on public.notes for select using (owner_id = auth.uid());
create policy "own notes insert" on public.notes for insert with check (
  owner_id = auth.uid()
  and exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
  and (folder_id is null or exists (
    select 1 from public.note_folders f where f.id = folder_id and f.owner_id = auth.uid() and f.workspace_id = notes.workspace_id))
);
-- A note's folder must stay in the note's own workspace.
create policy "own notes update" on public.notes for update using (owner_id = auth.uid()) with check (
  owner_id = auth.uid()
  and (folder_id is null or exists (
    select 1 from public.note_folders f where f.id = folder_id and f.owner_id = auth.uid() and f.workspace_id = notes.workspace_id))
);
create policy "own notes delete" on public.notes for delete using (owner_id = auth.uid());

create policy "own note_tags select" on public.note_tags for select using (owner_id = auth.uid());
create policy "own note_tags insert" on public.note_tags for insert with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.notes n join public.tags g on g.workspace_id = n.workspace_id
    where n.id = note_tags.note_id and g.id = note_tags.tag_id and n.owner_id = auth.uid() and g.owner_id = auth.uid())
);
create policy "own note_tags delete" on public.note_tags for delete using (owner_id = auth.uid());

create policy "own note_todos select" on public.note_todos for select using (owner_id = auth.uid());
create policy "own note_todos insert" on public.note_todos for insert with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.notes n join public.todos t on t.workspace_id = n.workspace_id
    where n.id = note_todos.note_id and t.id = note_todos.todo_id and n.owner_id = auth.uid() and t.owner_id = auth.uid())
);
create policy "own note_todos delete" on public.note_todos for delete using (owner_id = auth.uid());

-- Replace a note's tags with exactly this set of names (creating tags as needed).
create function public.set_note_tags(p_note uuid, p_names text[]) returns void
language plpgsql as $$
declare
  ws uuid;
  clean text[];
begin
  select workspace_id into ws from public.notes where id = p_note;
  if not found then raise exception 'note not found'; end if;

  select coalesce(array_agg(distinct s.n), '{}'::text[]) into clean
  from (select lower(btrim(x)) as n from unnest(coalesce(p_names, '{}'::text[])) x) s
  where char_length(s.n) between 1 and 40;

  insert into public.tags (workspace_id, name) select ws, unnest(clean) on conflict (workspace_id, name) do nothing;
  delete from public.note_tags nt using public.tags g
  where nt.note_id = p_note and g.id = nt.tag_id and not (g.name = any(clean));
  insert into public.note_tags (note_id, tag_id)
  select p_note, g.id from public.tags g where g.workspace_id = ws and g.name = any(clean)
  on conflict do nothing;
end $$;

revoke execute on function public.set_note_tags(uuid, text[]), public.touch_updated_at() from public, anon;
grant execute on function public.set_note_tags(uuid, text[]) to authenticated;
