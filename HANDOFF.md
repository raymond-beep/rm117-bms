# RM117 BMS — Handoff Index

This file was last meaningful for the initial machine setup on 2026-06-10. The project has
moved well past that. For current state, read these files in order:

1. **`CLAUDE.md`** — stack, architecture, invariants, integrations (always current)
2. **`NEXT_SESSION.md`** — where we stopped, exact next steps, QBO cleanup list (updated each session)
3. **`CHECKLIST.md`** — full phase-by-phase build checklist with completion status
4. **`SCHEMA.md`** — Supabase table definitions

## Current status (as of 2026-06-21)

- **2026-06-21 — Phase-1 security gate WRITTEN LOCALLY (NOT committed, NOT deployed):** an
  architect "user test" (graded the app 7/10; writeup in `~/Desktop/User Test Results/`) found the
  staff data APIs were **unauthenticated in prod** — `/api/jobs`, `/api/clients`, `/api/forefront`,
  `/api/payments`, `/api/phase-events` all returned live firm data anonymously. Built a shared
  `api/_lib/require-staff.js` gate (401 no-token / 403 not-staff; staff = `@rm117.com`), applied it to
  8 endpoints + refactored `field-notes.js` onto it, and added a token-attaching `src/lib/api.js`
  (`apiFetch`) wired into all 14 frontend call sites (the GET/write calls previously sent no token).
  Build green. **The live leak stays open until this is deployed** — see `NEXT_SESSION.md` for the
  deploy + anonymous-verify steps and the optional JWT-role-claim upgrade (the best-value perf fix).
- **2026-06-20 — Field Notes shipped + BMS drag/reorder/sort (all on `main`, deployed prod):**
  Upgraded to **Vercel Pro** (function cap gone). Built **Field Notes** end-to-end — the README's
  mobile feature: `field_notes` table, `api/field-notes.js` (GET/POST/PATCH/DELETE) +
  `api/field-notes/upload.js` (photos/voice → private `field-notes` Storage bucket, signed URLs),
  a mobile `+`-FAB capture sheet (text + photo [camera/library, multi] + voice + location, edit/delete,
  swipeable photo lightbox) and a read/edit/delete list in the desktop JobEditor Progress tab. Added
  **drag-to-organize** in the BMS grouped view (`@dnd-kit`): drag a card to another phase or reorder
  within a phase (persisted via `jobs.board_position`), plus a Sort dropdown (Manual / Most recent /
  Next milestone / Contract value / Outstanding / Client name). iOS polish (no focus-zoom, voice mime,
  button label) + an app-level `ErrorBoundary`. **Next: Templates** (table exists; see
  `REDESIGN-BACKEND-NEXT.md`), then the Forefront commission-rate decision (blocked on Ang).
- **2026-06-19 — UI redesign "Drafting + data" FRONTEND COMPLETE (branch `redesign-drafting-data`,
  pushed to origin; NOT merged to main — prod untouched):** new direction supersedes the warm-paper
  "Architectural" look — IBM Plex Sans/Mono, 5 live themes (`src/lib/theme.jsx` + `[data-theme]`),
  light themed sidebar, top header bar. Done: Dashboard (rich stat cards + month-grid calendar),
  BMS (Job ID as the bold primary line; `potential`→"Proposal Sent"), Job Editor drawer (payment
  chips), Forefront commission tracker (status-grouped ledger), Settings (theme picker), Client
  Portal (brand colors), Mobile (Portal tab + Appearance sheet). Source: `~/Desktop/design_handoff_rm117_app 2/`.
  **Next session = backend** (Field Notes + Templates tables/APIs; Forefront rate pending Ang) —
  see **`REDESIGN-BACKEND-NEXT.md`** (note: now on Vercel Pro as of 2026-06-20 — 12-function cap
  lifted, build new APIs as clean standalone files).
- **2026-06-18 — Phase 7 Client Portal COMPLETE (commits `a0f5e2f`→`74eed0a`, deployed + pushed to origin):**
  portal redesigned to the Architectural mockup (switcher + horizontal stepper, money-free), **document
  vault live** via the Drive service-account broker (**85 jobs mapped + audited**), **staff-side portal
  preview**, and **in-portal messaging** (client panel + staff JobEditor Messages tab). Also: **company
  Google Calendar live** and an **Outstanding display fix** (active ~$128K vs $454K all-jobs). Fixed a
  Vercel `GOOGLE_PRIVATE_KEY` quoting bug; data fixes (Russo merge, McCalla folder, `23_047` unlinked,
  portal test data deleted). **Deferred:** email bridge (Wix domain access), document uploads, staff-API
  auth, QBO reconciliation. Resume details at the top of `NEXT_SESSION.md`.
- **2026-06-17 (docs):** Clarified client portal auth = Clerk email only, separate from staff Google
  OAuth (can't touch the 100 test-user cap). Git identity set globally to `raymond@rm117.com`.
- App live at **rm117-bms.vercel.app**; **134 jobs** in Supabase, financials accurate from QBO.
- Phases 0–4 (core) complete. Priority Inbox (Gmail), `clients` backbone, Google Calendar widget all live.
- **NEW 2026-06-16:** JobEditor verified · client-link Details tab · payment-safety (QBO dedup) ·
  **Progress Timeline** (per-job phase dates + dashboard "Coming up"; the internal alternative to a
  client portal) · data cleanup (job→client coverage **64 → 126/134**). All committed to `main` +
  deployed (latest `b8fb41e`).
- **Resume point + prioritized next steps:** see the **▶ RESUME HERE** block at the top of `NEXT_SESSION.md`.
  Headlines: ~$80K QBO payment imports (`CLIENT-RECON.md`, needs Ray) · client-type reclassification ·
  8 jobs w/ $0 total · Stage B outbound QBO+DocuSign (needs Ang) · shared calendar (needs Ang).
- **Deploys:** working-dir `vercel --prod`. Repo now matches production (no uncommitted drift as of 2026-06-16).

## Original build session (2026-06-10)

The scaffold was built on a Windows machine and transferred here. All code and config were
built from scratch in that session. The `.env.example`, Supabase migrations, import scripts,
and full API layer all date from that session. See git log for the initial commit if needed.
