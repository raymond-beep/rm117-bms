# RM117 BMS — Handoff Index

This file was last meaningful for the initial machine setup on 2026-06-10. The project has
moved well past that. For current state, read these files in order:

1. **`CLAUDE.md`** — stack, architecture, invariants, integrations (always current)
2. **`NEXT_SESSION.md`** — where we stopped, exact next steps, QBO cleanup list (updated each session)
3. **`CHECKLIST.md`** — full phase-by-phase build checklist with completion status
4. **`SCHEMA.md`** — Supabase table definitions

## Current status (as of 2026-06-17)

- **2026-06-17 (docs):** Clarified that the future client portal authenticates via Clerk by email
  only — separate from the staff Google OAuth app — so it can't consume the 100 test-user cap or
  affect staff. Recorded as an invariant in `CLAUDE.md` + across the planning docs (commit `f2ba7dd`,
  pushed). Git identity set globally to `raymond@rm117.com`.
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
