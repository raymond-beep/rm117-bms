# RM117 BMS — Handoff Index

This file was last meaningful for the initial machine setup on 2026-06-10. The project has
moved well past that. For current state, read these files in order:

1. **`CLAUDE.md`** — stack, architecture, invariants, integrations (always current)
2. **`NEXT_SESSION.md`** — where we stopped, exact next steps, QBO cleanup list (updated each session)
3. **`CHECKLIST.md`** — full phase-by-phase build checklist with completion status
4. **`SCHEMA.md`** — Supabase table definitions

## Current status (as of 2026-06-15)

- App live at **rm117-bms.vercel.app**
- 133 jobs in Supabase, financials accurate from QBO
- Zapier webhook live — future QBO paid invoices auto-sync
- Phases 0–4 (core) complete
- **NEW 2026-06-15:** Priority Inbox (Gmail) live · `clients` backbone built from QBO (64 clients,
  typed) · Google Calendar widget live (personal). See `NEXT_SESSION.md` for full detail.
- Next: shared RM117 calendar (needs Ang) · `CLIENT-RECON.md` (12 customers) · JobEditor ·
  optional layout redesign in Claude design (files staged in `~/Desktop/RM117 App Design/`)
- Deploys are working-dir `vercel deploy --prod` (gitDirty); today's work deployed but uncommitted

## Original build session (2026-06-10)

The scaffold was built on a Windows machine and transferred here. All code and config were
built from scratch in that session. The `.env.example`, Supabase migrations, import scripts,
and full API layer all date from that session. See git log for the initial commit if needed.
