# RM117 BMS — Second Generation

Job + client management platform for **Room 117 Architecture & Design LLC**.
Supabase is the source of truth; the Google Sheet is the migration seed + read-only
fallback through Phase 3. See **CLAUDE.md** (context), **VISION.md** (the why),
**PLAN.md** (build order), **SCHEMA.md** (data model), **ADR-001** (the decision).

## Quick start

```bash
npm install
copy .env.example .env   # fill in keys as Phase 0 accounts are created
npm run dev              # Vite on :5173 + Express API on :3001
```

The app boots clean with **mock data** until `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
are set — every screen shows a "Mock data" pill so there's no mistaking it.
`GET /api/health` reports which integrations have env vars present.

## Layout

| Path | What |
|------|------|
| `src/rm117-app-shell-v1.jsx` | App shell: sidebar, dashboard, BMS at `/bms`, Phase 5–7 placeholders |
| `src/rm117-dashboard-v1.jsx` | BMS: stat tiles, jobs table w/ filter+search, JobEditor drawer, payments |
| `api/` | Vercel serverless functions (`jobs`, `jobs/update`, `jobs/create`, `payments`, `health`) |
| `api/_lib/db.js` | Supabase client module (service role, server-side only) |
| `server.js` | Local dev wrapper — Express hosting the `api/` functions on :3001 |
| `supabase/migrations/0001_init.sql` | Phase 1 schema: all tables, checks, indexes, RLS |
| `scripts/import-sheet.js` | Phase 2 one-time Sheet → Supabase import (`npm run import:sheet -- --dry-run`) |

## Phase status

- **Phase 0 (accounts/env)** — in progress, outside the code: Supabase project, Clerk
  client role, company calendar, Resend, DocuSign, QBO dev app, Zapier webhook. Fill `.env`.
- **Phase 1 (schema)** — SQL written: run `supabase/migrations/0001_init.sql` in the
  Supabase SQL editor once the project exists.
- **Phase 2 (import)** — script written; verify `COLUMN_MAP` against the real Sheet with
  `--dry-run` before the live run.
- **Phase 3 (app re-point + job management)** — API + UI built; reads Supabase automatically
  when env vars exist, mock data until then.
- **Phase 4 (payments)** — payment logging + computed outstanding built; Zapier→edge-function
  inbound sync still to do.
- **Phases 5–8** — placeholder routes in the sidebar; not started.

## Invariants (do not break)

- Job ID `YY_NNN_[FF_]LastName` must match the QuickBooks Customer Display Name exactly.
- Through Phase 3 the Sheet is read-only fallback (service account is Viewer-only).
- Clients never receive Google Drive permissions; the backend brokers every file access.
- A client must never access another client's jobs, files, or messages.
- `outstanding` is computed (`job_total − Σ payments`), never stored.
