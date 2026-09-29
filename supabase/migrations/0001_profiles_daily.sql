-- WordBridge: profiles, daily puzzles, and server-authoritative daily runs.
-- Run once in Supabase Dashboard -> SQL Editor.

-- ==========================================
-- PROFILES
-- ==========================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_-]{3,16}$'),
  avatar_url text,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable" on public.profiles
  for select using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Clients may only change their username; everything else is server-managed
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (username) on public.profiles to authenticated;

-- Builds a unique username from a base string (e.g. Google first name)
create or replace function public.generate_username(base text)
returns text
language plpgsql
set search_path = public
as $$
declare
  clean text;
  candidate text;
  attempts int := 0;
begin
  clean := left(regexp_replace(coalesce(base, ''), '[^A-Za-z0-9_-]', '', 'g'), 12);
  if length(clean) < 3 then
    clean := 'Player';
  end if;

  candidate := clean;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    attempts := attempts + 1;
    candidate := clean || (1000 + floor(random() * 9000))::int::text;
    if attempts > 50 then
      candidate := left(clean, 10) || substr(md5(random()::text), 1, 6);
    end if;
  end loop;

  return candidate;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    public.generate_username(split_part(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ), ' ', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users who signed in before this migration
do $$
declare
  u record;
begin
  for u in select * from auth.users where id not in (select id from public.profiles) loop
    insert into public.profiles (id, username, avatar_url)
    values (
      u.id,
      public.generate_username(split_part(coalesce(
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name',
        split_part(u.email, '@', 1)
      ), ' ', 1)),
      u.raw_user_meta_data ->> 'avatar_url'
    );
  end loop;
end;
$$;

-- ==========================================
-- DAILY PUZZLES (one canonical pair per UTC day)
-- ==========================================
create table if not exists public.daily_puzzles (
  day date primary key,
  source text not null,
  target text not null,
  baseline_score int not null,
  created_at timestamptz not null default now()
);

alter table public.daily_puzzles enable row level security;

drop policy if exists "Daily puzzles are publicly readable" on public.daily_puzzles;
create policy "Daily puzzles are publicly readable" on public.daily_puzzles
  for select using (true);

grant select on public.daily_puzzles to anon, authenticated;

-- ==========================================
-- DAILY RUNS (written only by the server with the secret key)
-- ==========================================
create table if not exists public.daily_runs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null references public.daily_puzzles (day) on delete cascade,
  path text[] not null,
  step_scores int[] not null default '{}',
  failed_attempts int not null default 0,
  last_proximity int not null default 0,
  finished boolean not null default false,
  steps int,
  score int,
  rank text,
  version int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (user_id, day)
);

create index if not exists daily_runs_leaderboard_idx
  on public.daily_runs (day, score desc, steps asc, finished_at asc)
  where finished;

alter table public.daily_runs enable row level security;

drop policy if exists "Users can read their own daily runs" on public.daily_runs;
create policy "Users can read their own daily runs" on public.daily_runs
  for select using (auth.uid() = user_id);

revoke insert, update, delete on public.daily_runs from anon, authenticated;
grant select on public.daily_runs to authenticated;

grant all on public.profiles, public.daily_puzzles, public.daily_runs to service_role;
