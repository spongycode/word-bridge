<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# WordBridge project notes

See `README.md` for what the app is, setup, and layout. Conventions for working in this repo:

## Commits
- Commit as the repo owner (`git config user.name/email`); **no `Co-Authored-By` or other AI attribution lines**.
- Don't push; the owner pushes.
- Before committing, make sure `package-lock.json` only references the public registry. Installs on the owner's work network rewrite tarball URLs to an internal proxy that Vercel can't reach:
  ```bash
  grep -c "sfw-ci.blinkit.in" package-lock.json   # must print 0
  ```
  If not, rewrite `https://sfw-ci.blinkit.in/npm/` to `https://registry.npmjs.org/` (integrity hashes are identical).

## Next.js 16 specifics used here
- Middleware is `proxy.ts` (named export `proxy`), not `middleware.ts`.
- `cookies()` / `headers()` are async.
- Route files may only export handlers/config; put shared constants and types in `app/lib/`.

## Database
- Schema changes are new files in `supabase/migrations/` (`000N_name.sql`), run manually in the Supabase SQL Editor. Code that depends on a new column should tolerate it missing until the migration runs.
- Server-authoritative writes use the secret-key client (`app/lib/supabase/admin.ts`, `server-only`); never import it from client code.
- There are no live users yet, so breaking schema/localStorage changes are fine.

## Realtime (Ably)
- Channel names: `room:<CODE>` for races, `inbox:<identity>` for per-player notices. Ably capability wildcards only work per namespace (`room:*`), not mid-name.
- Trust `msg.clientId` (stamped by Ably from the server-issued token), never a clientId inside `msg.data`.
- Race handlers read live state through refs (`opponentRef`, `roundRef`, ...) because subscriptions outlive renders.

## UI
- Mobile first; check changes at 375px width, including the compact layout when the keyboard is open.
- Text is 12px or larger; monospace only for numbers and codes. Brand accent `--accent` (violet), opponent `--opponent` (rose-red), link tiers in `app/lib/links.ts`.
