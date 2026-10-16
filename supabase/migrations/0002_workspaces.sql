-- Phase 2: user-named workspaces shared by todos and notes (added in later phases).
-- Phase 6 adds the lock columns (is_private, lock_type, lock_salt, ...).
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text not null default '#7c5cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text not null default 'folder',
  position int not null default 0,
  background jsonb,
  created_at timestamptz not null default now()
);

create index workspaces_owner_position_idx on public.workspaces (owner_id, position);

alter table public.workspaces enable row level security;

create policy "own workspaces select" on public.workspaces for select using (owner_id = auth.uid());
create policy "own workspaces insert" on public.workspaces for insert with check (owner_id = auth.uid());
create policy "own workspaces update" on public.workspaces for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own workspaces delete" on public.workspaces for delete using (owner_id = auth.uid());
