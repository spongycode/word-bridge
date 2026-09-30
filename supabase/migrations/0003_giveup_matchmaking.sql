-- WordBridge: daily give-up and random matchmaking queue.
-- Run after 0002 in Supabase Dashboard -> SQL Editor.

-- ==========================================
-- DAILY GIVE UP (a finished run that did not reach the target)
-- ==========================================
alter table public.daily_runs add column if not exists gave_up boolean not null default false;

drop index if exists daily_runs_leaderboard_idx;
create index if not exists daily_runs_leaderboard_idx
  on public.daily_runs (day, score desc, steps asc, finished_at asc)
  where finished and not gave_up;

-- ==========================================
-- MATCHMAKING QUEUE (server-only; one entry per player identity)
-- ==========================================
create table if not exists public.match_queue (
  identity text primary key,          -- "u-<uuid>" or "g-<guest id>"
  client_id text not null,            -- realtime clientId of the waiting tab
  name text not null,
  updated_at timestamptz not null default now()
);

alter table public.match_queue enable row level security;
revoke all on public.match_queue from anon, authenticated;
grant all on public.match_queue to service_role;

-- Atomically pairs the caller with the oldest fresh waiting player, or enqueues the caller.
-- status: 'matched' (opponent columns set), 'waiting' (caller is queued), or
-- 'gone' (heartbeat from a player whose queue entry was already taken by a match; wait for the inbox notice).
create or replace function public.matchmake(
  p_identity text,
  p_client_id text,
  p_name text,
  p_is_heartbeat boolean default false,
  p_ttl_seconds int default 45
)
returns table (status text, opponent_identity text, opponent_client_id text, opponent_name text)
language plpgsql
set search_path = public
as $$
declare
  v_opponent public.match_queue%rowtype;
  v_self_exists boolean;
begin
  delete from public.match_queue where updated_at < now() - make_interval(secs => p_ttl_seconds);

  -- Lock our own entry first so a concurrent match against us is observed consistently
  perform 1 from public.match_queue where identity = p_identity for update;
  v_self_exists := found;
  if p_is_heartbeat and not v_self_exists then
    return query select 'gone'::text, null::text, null::text, null::text;
    return;
  end if;

  select * into v_opponent
  from public.match_queue
  where identity <> p_identity
  order by updated_at asc
  limit 1
  for update skip locked;

  if found then
    delete from public.match_queue where identity in (v_opponent.identity, p_identity);
    return query select 'matched'::text, v_opponent.identity, v_opponent.client_id, v_opponent.name;
    return;
  end if;

  insert into public.match_queue (identity, client_id, name, updated_at)
  values (p_identity, p_client_id, p_name, now())
  on conflict (identity) do update
    set client_id = excluded.client_id, name = excluded.name, updated_at = now();
  return query select 'waiting'::text, null::text, null::text, null::text;
end;
$$;

revoke execute on function public.matchmake(text, text, text, boolean, int) from public, anon, authenticated;
grant execute on function public.matchmake(text, text, text, boolean, int) to service_role;
