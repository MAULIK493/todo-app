-- Phase 1: profiles. Phase 2 adds workspaces; later phases add todos, notes, rewards, AI.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  xp bigint not null default 0,
  level int not null default 1,
  coins bigint not null default 0,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "own profile read" on public.profiles for select using (id = auth.uid());
-- XP, level, coins and streaks must only change through server-side functions (Phase 5),
-- so users may update only their settings column.
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (settings) on public.profiles to authenticated;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
