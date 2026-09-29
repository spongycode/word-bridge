-- WordBridge: API rate limiting and cloud match history.
-- Run after 0001 in Supabase Dashboard -> SQL Editor.

-- ==========================================
-- RATE LIMITS (fixed-window counters, server-only)
-- ==========================================
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Atomically counts one hit; returns true when the caller is still within the limit
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup of expired windows (~1% of calls)
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- ==========================================
-- MATCH RESULTS (one row per player per 1v1 round)
-- ==========================================
create table if not exists public.match_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  match_key text not null,
  room_code text not null,
  source_word text not null,
  target_word text not null,
  my_username text not null,
  my_steps int not null,
  my_path text[] not null,
  opponent_name text not null,
  opponent_steps int,
  opponent_path text[],
  result text not null check (result in ('won', 'lost', 'draw', 'abandoned')),
  created_at timestamptz not null default now(),
  unique (user_id, match_key)
);

create index if not exists match_results_user_created_idx on public.match_results (user_id, created_at desc);

alter table public.match_results enable row level security;

drop policy if exists "Users manage their own match results" on public.match_results;
create policy "Users manage their own match results" on public.match_results
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.match_results to authenticated;
grant all on public.match_results to service_role;
