# RM117 BMS — Machine Transition Handoff
**Written:** 2026-06-10 · **From:** session on Ray's Windows 11 machine (Claude Code, Fable 5)
**Purpose:** everything a fresh Claude Code session on the new machine needs to pick up exactly
where this one left off. Read this alongside CLAUDE.md, PLAN.md, SCHEMA.md, VISION.md, ADR-001.

---

## 1. What happened in this session (2026-06-10)

The folder started with ONLY the five planning docs (CLAUDE.md, PLAN.md, SCHEMA.md, VISION.md,
ADR-001) — zero code. In one session, the entire second-generation scaffold was built and
verified:

| Built | File(s) | Status |
|-------|---------|--------|
| Project config | `package.json`, `vite.config.js`, `index.html`, `vercel.json`, `.gitignore`, `.env.example` | done |
| App shell | `src/rm117-app-shell-v1.jsx` (+ `src/main.jsx`, `src/styles.css`, `src/lib/format.js`) | done — sidebar, home dashboard w/ live stats, calendar+inbox placeholders, Phase 5/6/7 placeholder routes |
| BMS dashboard | `src/rm117-dashboard-v1.jsx` | done — stat tiles, jobs table w/ search + phase/FF/bill filters, JobEditor drawer (optimistic save + rollback), Payments tab w/ logging, New Job drawer w/ Job-ID validation |
| API | `api/health.js`, `api/jobs.js`, `api/jobs/update.js`, `api/jobs/create.js`, `api/payments.js`, `api/_lib/db.js`, `api/_lib/mock-data.js` | done — Supabase when env vars exist, mock fallback otherwise; `outstanding` always computed |
| Local dev wrapper | `server.js` (Express on :3001; Vite proxies `/api`) | done |
| Phase 1 schema | `supabase/migrations/0001_init.sql` | written, NOT yet run (no Supabase project exists) |
| Phase 2 import | `scripts/import-sheet.js` | written, NOT yet run — `COLUMN_MAP` is a best guess, MUST be verified with `--dry-run` against the real Sheet |
| Dev launcher shim | `dev.cmd`, `.claude/launch.json` | this-machine-specific (see §4) |

**Verification done:** `npm run build` passes clean. All API endpoints smoke-tested via curl
(GET jobs w/ computed outstanding; update rejects invalid phases; create rejects malformed Job
IDs and defaults `is_forefront` from `_FF_`; payments rejects invalid methods/types). UI
verified visually in the preview: dashboard stats math matches mock payments exactly
($42,400 outstanding), drawer + payments tab + filters all work, zero console errors/warnings.

## 2. Where the project stands (phase map)

- **Phase 0 (accounts/env): NOT STARTED — this is the blocker and it's all human work.**
  No Supabase project, no keys of any kind exist yet. `.env` does not exist (only
  `.env.example`). The app runs in clearly-labeled MOCK DATA mode until
  `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` are set. `GET /api/health` reports which env
  vars are present (booleans only).
- **Phase 1 (schema):** SQL is written. Once the Supabase project exists, paste
  `supabase/migrations/0001_init.sql` into the Supabase SQL editor and run it.
- **Phase 2 (import):** script written. Run `npm run import:sheet -- --dry-run` first,
  verify/fix `COLUMN_MAP` against the real Sheet headers, then run live.
- **Phase 3 (app re-point):** the code path is already built — the API reads Supabase
  automatically when env vars exist. What remains is real-data verification + the
  parallel-run period with Ang, then Sheet archival.
- **Phase 4 (payments):** logging + computed outstanding built. Still to do: the quarterly
  billing view, and the Zapier → Supabase edge function for inbound QBO paid invoices.
- **Phases 5–8:** placeholder routes only. Phase 8 stays BLOCKED until Ang defines the
  trigger map.

**Not yet done anywhere:** Clerk auth integration (app is currently unauthenticated dev
mode), calendar widget, Gmail inbox widget, git repo (folder is not a git repository —
`git init` + first commit is a good first move on the new machine), Vercel project.

## 3. Setting up the new machine

1. **Install Node.js LTS** (v22+). On Windows: `winget install OpenJS.NodeJS.LTS`.
2. Copy this entire folder (or unzip `RM117-App-handoff.zip`). `node_modules` is
   excluded — that's expected.
3. `npm install`
4. `npm run dev` → Vite on http://localhost:5173, API on :3001. You should see the
   dashboard with the orange "Mock data" pill and 4 pipeline jobs.
5. When ready to go live: `copy .env.example .env`, fill in keys as Phase 0 accounts are
   created. The mock→Supabase switch is automatic once the two Supabase vars are set.
6. Optional: `git init` and commit everything as the baseline.

## 4. Quirks of the OLD machine (safe to discard on the new one)

- Node was installed mid-session via winget, so this machine's tool shells needed a PATH
  refresh, and the Claude Code preview launcher needed `dev.cmd` (a batch shim that
  prepends `C:\Program Files\nodejs` to PATH) referenced by an **absolute path** in
  `.claude/launch.json`. **On the new machine:** fix the absolute path in
  `.claude/launch.json` (or delete both files and let a new session recreate them) —
  if Node is installed before Claude Code starts, the shim isn't needed at all.
- A Claude Code memory file existed outside the project folder noting the PATH quirk
  (`~/.claude/projects/.../memory/windows-node-path-quirk.md`). It's machine-specific;
  its useful content is already captured in this section. Recreate memories fresh on
  the new machine if wanted.

## 5. Key decisions made while building (not explicit in the planning docs)

- **Mock-data fallback pattern:** every api/ function checks `hasDb()` and serves
  schema-shaped mock data (in `api/_lib/mock-data.js` — all names fictional) when
  Supabase env vars are absent. Responses carry `source: 'mock' | 'supabase'` and writes
  carry `persisted: false` in mock mode; the UI surfaces this as a colored pill so live
  vs. sample is never ambiguous. This satisfied "npm run dev boots clean" before Phase 0.
- **Field whitelist on update:** `api/jobs/update.js` only accepts the fields the
  JobEditor edits (EDITABLE set) — computed/import/identity fields can't be written.
- **RLS posture:** all tables have RLS enabled with NO anon/authenticated policies =
  default-deny. The api/ layer uses the service-role key (bypasses RLS) and owns scoping.
  Phase 7 adds client-role policies.
- **"Pipeline" definition** used by stat tiles and the default table filter:
  `potential, survey_zoning, design_phase, cd_phase, active` (i.e. not completed/on-hold).
- **`phase_override` wins for display** (implemented in `src/lib/format.js: phaseLabel`).
- **New-job FF inference:** `is_forefront` defaults to true when the Job ID contains `_FF_`.
- **vercel.json** rewrites all non-`/api` routes to `index.html` so `/bms` deep-links
  survive on Vercel.

## 6. Suggested first moves on the new machine

1. `git init` + baseline commit.
2. Phase 0 checklist from PLAN.md — start with the Supabase project (Pro tier), since
   everything downstream hangs on it. Remember: use a personal Gmail for Google Cloud
   (the rm117.com org blocks service-account key downloads).
3. Run the Phase 1 migration, set the two Supabase env vars, watch the pill flip to
   "Supabase (live)".
4. Dry-run the import script against the real Sheet and correct `COLUMN_MAP`.
