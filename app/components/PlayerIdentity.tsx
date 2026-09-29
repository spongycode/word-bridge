"use client";

import { useState } from "react";

interface PlayerIdentityProps {
  username: string;
  label: string;
  onSave: (name: string) => Promise<string | null> | string | null;
}

// Name pill with inline edit; onSave returns an error message or null
export default function PlayerIdentity({ username, label, onSave }: PlayerIdentityProps) {
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

  return (
    <div className="p-2.5 bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-1.5">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""));
              setError(null);
            }}
            placeholder="Username"
            maxLength={16}
            autoFocus
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 px-2 py-1 rounded text-white text-xs font-mono focus:outline-none"
          />
          <button
            type="submit"
            disabled={saving}
            className="px-2 py-1 bg-white text-black font-semibold rounded text-xs disabled:opacity-50"
          >
            {saving ? "..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="px-2 py-1 bg-zinc-800 text-zinc-400 rounded text-xs"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
            <span className="text-[11px] font-mono text-zinc-400">{label}</span>
            <span className="text-xs font-semibold text-white font-mono truncate">{username}</span>
          </div>
          <button
            onClick={() => {
              setDraft(username);
              setEditing(true);
            }}
            className="text-[11px] font-mono text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 bg-zinc-900 px-2 py-0.5 rounded transition shrink-0"
          >
            Edit
          </button>
        </div>
      )}
      {error && <p className="text-[11px] font-mono text-rose-400">{error}</p>}
    </div>
  );
}
