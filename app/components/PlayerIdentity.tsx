"use client";

import { useState } from "react";

interface PlayerIdentityProps {
  username: string;
  signedIn: boolean;
  onSave: (name: string) => Promise<string | null> | string | null;
}

// Name with inline edit for the home header; onSave returns an error message or null
export default function PlayerIdentity({ username, signedIn, onSave }: PlayerIdentityProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const err = await onSave(draft);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex-1 min-w-0 space-y-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex items-center gap-1.5"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""));
              setError(null);
            }}
            aria-label="Username"
            maxLength={16}
            autoFocus
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 px-2.5 py-1.5 rounded-lg text-white text-base focus:outline-none focus:border-zinc-500"
          />
          <button type="submit" disabled={saving} className="px-2.5 py-1.5 bg-white text-black font-semibold rounded-lg text-sm disabled:opacity-50">
            {saving ? "…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="px-2 py-1.5 text-zinc-400 hover:text-white text-sm"
          >
            Cancel
          </button>
        </form>
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(username);
        setEditing(true);
      }}
      title="Edit your name"
      className="flex items-center gap-2 min-w-0 text-left group"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${signedIn ? "bg-emerald-400" : "bg-zinc-500"}`}></span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white truncate">
          {username} <span className="text-zinc-500 group-hover:text-zinc-300 font-normal">✎</span>
        </span>
        <span className="block text-xs text-zinc-500">{signedIn ? "Signed in" : "Guest"}</span>
      </span>
    </button>
  );
}
