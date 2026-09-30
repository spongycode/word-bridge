"use client";

import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./supabase/client";
import {
  MatchHistoryItem,
  getMatchHistory as getLocalHistory,
  saveMatchResult as saveLocal,
  attachOpponentPath as attachLocal,
  clearMatchHistory as clearLocal,
} from "./player";

type NewMatch = Omit<MatchHistoryItem, "id" | "timestamp">;

function fromRow(r: any): MatchHistoryItem {
  return {
    id: r.id,
    matchKey: r.match_key,
    roomCode: r.room_code,
    sourceWord: r.source_word,
    targetWord: r.target_word,
    myUsername: r.my_username,
    mySteps: r.my_steps,
    myPath: r.my_path,
    myStepScores: r.my_step_scores ?? undefined,
    opponentName: r.opponent_name,
    opponentIdentity: r.opponent_identity ?? undefined,
    opponentSteps: r.opponent_steps ?? undefined,
    opponentPath: r.opponent_path ?? undefined,
    result: r.result,
    timestamp: new Date(r.created_at).getTime(),
  };
}

// Signed-in players keep history in Supabase (synced across devices); guests use localStorage
function cloud(user: User | null) {
  const supabase = getSupabaseBrowserClient();
  return user && supabase ? supabase : null;
}

export async function loadMatchHistory(user: User | null): Promise<MatchHistoryItem[]> {
  const db = cloud(user);
  if (!db) return getLocalHistory();
  const { data, error } = await db
    .from("match_results")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    console.error("Match history load failed:", error.message);
    return [];
  }
  return (data ?? []).map(fromRow);
}

export async function recordMatch(user: User | null, item: NewMatch): Promise<void> {
  const db = cloud(user);
  if (!db || !user) return saveLocal(item);
  const row: Record<string, unknown> = {
    user_id: user.id,
    match_key: item.matchKey,
    room_code: item.roomCode,
    source_word: item.sourceWord,
    target_word: item.targetWord,
    my_username: item.myUsername,
    my_steps: item.mySteps,
    my_path: item.myPath,
    opponent_name: item.opponentName,
    opponent_steps: item.opponentSteps ?? null,
    opponent_path: item.opponentPath ?? null,
    result: item.result,
    my_step_scores: item.myStepScores ?? null,
    opponent_identity: item.opponentIdentity ?? null,
  };
  let { error } = await db.from("match_results").upsert(row, { onConflict: "user_id,match_key" });
  // Before migration 0004 the detail columns don't exist; save the core record anyway
  if (error?.code === "PGRST204") {
    const { my_step_scores: _s, opponent_identity: _o, ...core } = row;
    ({ error } = await db.from("match_results").upsert(core, { onConflict: "user_id,match_key" }));
  }
  if (error) console.error("Match save failed:", error.message);
}

export async function patchOpponentPath(user: User | null, matchKey: string, opponentPath: string[]): Promise<void> {
  const db = cloud(user);
  if (!db) return attachLocal(matchKey, opponentPath);
  const { error } = await db
    .from("match_results")
    .update({ opponent_path: opponentPath, opponent_steps: Math.max(0, opponentPath.length - 1) })
    .eq("match_key", matchKey);
  if (error) console.error("Match update failed:", error.message);
}

export async function clearAllMatches(user: User | null): Promise<void> {
  const db = cloud(user);
  if (!db || !user) return clearLocal();
  const { error } = await db.from("match_results").delete().eq("user_id", user.id);
  if (error) console.error("Match history clear failed:", error.message);
}
