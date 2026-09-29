"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client";
import { USERNAME_PATTERN } from "../player";

export interface Profile {
  id: string;
  username: string;
}

// Loads the signed-in player's profile (created by a DB trigger on first sign-in)
export function useProfile(user: User | null) {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!user || !supabase) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("id, username")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error("Profile load failed:", error.message);
        if (!cancelled) setProfile(data ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Returns an error message, or null on success
  const updateUsername = useCallback(
    async (name: string): Promise<string | null> => {
      const supabase = getSupabaseBrowserClient();
      const clean = name.trim();
      if (!supabase || !user) return "Not signed in.";
      if (!USERNAME_PATTERN.test(clean)) return "Use 3-16 letters, numbers, _ or -.";

      const { data, error } = await supabase
        .from("profiles")
        .update({ username: clean })
        .eq("id", user.id)
        .select("id, username")
        .maybeSingle();

      if (error) return error.code === "23505" ? "That username is taken." : error.message;
      if (!data) return "Profile not found.";
      setProfile(data);
      return null;
    },
    [user]
  );

  return { profile, updateUsername };
}
