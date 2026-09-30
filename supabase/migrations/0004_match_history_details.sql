-- WordBridge: per-step link strengths and opponent identity on race history (for squares + "Race again").
-- Run after 0003 in Supabase Dashboard -> SQL Editor.

alter table public.match_results add column if not exists my_step_scores int[];
alter table public.match_results add column if not exists opponent_identity text;
