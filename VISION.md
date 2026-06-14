# RM117 — VISION.md — Founder's goals, preferences, decisions. Read with CLAUDE.md each session.
## What This Is
Workflow + client-management app for **Room 117 Architecture & Design LLC** (RM117).
Built by Ray. Single-tenant today; north-star is resale to other architecture/design firms —
so keep IDs/config in env vars; never hardcode firm-specific values in component logic.

## The Three Layers
1. **App Shell + Dashboard** — employee home screen: calendar, inbox, job stats.
   Inspired by Steward (steward.cc) in layout only; ignore its church/domain features.
2. **BMS** — existing job tracker, billing, Forefront commissions. Lives at `/bms`.
   Already built (`rm117-dashboard-v1.jsx`). Preserve its UX; its **data layer is swapped
   Sheet→Supabase in Phase 3** (the one deliberate change — see PLAN.md).
3. **Client layer (NEW)** — onboarding + a per-project portal + a document vault.

## Users & Access
Staff (Ang, Tom, Nicole, Danielle, Ray) = full edit, no per-row perms yet.
Clients = a scoped `client` role in Clerk; log in with the email on file and see ONLY
their own job(s). Clients are real estate investors/contractors, often with multiple jobs.

## Client Portal + Document Vault
- One portal per client, showing all their jobs. Account created **at contract signing**
  (the buffer before first site visit is used to gather preliminary info).
- **Two-way vault** per job: download from Drive *Files Sent*, upload into *Files Received*
  (view-only fallback if uploads get messy). **Files stay in Google Drive** — the backend
  (service account) brokers every access; clients never get Drive perms; scoping by Job ID.
- **Messaging:** one thread per job. A portal message also emails/notifies the client;
  client email replies flow back into the thread. (Email bridge: Resend or equivalent.)

## Onboarding
Intake → proposal → **DocuSign** e-signature → signed contract → portal account created
→ retainer collected as a **QuickBooks** invoice (created by the app via the QBO API in Phase 5).

## Data Backbone (second-generation)
- **Supabase (Postgres) is the source of truth** for all job, client, financial, and
  correspondence data — see SCHEMA.md.
- The **Google Sheet is the migration seed**, then a **read-only fallback through Phase 3**
  (Viewer-only; app never writes back), then archived. **QuickBooks** drops to a payment +
  invoice-delivery channel, not a record-keeper.
- Job ID is the shared key across Sheet (during migration), Drive, QBO, and Supabase.
- Clients/contractors: one `clients` table; each job has `client_id` (who's billed) and
  `referred_by_id` (who referred it in — inbound referrals only).

## Calendar Vision
- Front and center on the dashboard — the most important widget. Shows the logged-in user's
  personal Google Calendar + one shared **company** calendar (`COMPANY_CALENDAR_ID`).
- Ang keeps the **Apple Calendar app** and adds the company Google Calendar as an account
  (native two-way sync); the dashboard reads Google, so it sees her edits. She creates firm
  events on that company calendar, not her local iCloud one.
- More shared calendars later = config change, not code. Microsoft Calendar is aspirational.

## Email Vision (two separate systems — do not conflate)
- Dashboard **priority inbox** = the logged-in user's OWN Gmail (per-user OAuth via Clerk).
- BMS job correspondence = shared `projects@rm117.com` via service account (separate, later).
- Portal email bridge (Phase 7) = Resend; validate inbound parsing before committing.

## Auth Decisions
- Login-gated. Clerk handles auth + Google OAuth (scopes: `gmail.readonly`,
  `calendar.readonly`). Google in V1; Microsoft stubbed. `client` role added in Phase 7.

## Billing & Automation (Phase 8 — not yet)
- Goal: a phase change auto-creates a draft QuickBooks invoice (human approves before send).
- BLOCKED until Ang defines which phase transitions trigger which invoice amounts.

## Things That Must Not Break
- Job ID `YY_NNN_[FF_]LastName` must match the QuickBooks Customer Display Name exactly.
- Through Phase 3 the Sheet is a **read-only fallback** — Viewer-only access; the app reads
  from Supabase and never writes back to the Sheet.
- Clients never receive Google Drive permissions; the backend brokers every file access.
- A client must never see another client's jobs, files, or messages.
> Superseded first-gen rules: Sheet-as-truth, "never write the Outstanding column," "never
> modify the Zapier Lookup tab," and "dashboard behavior is frozen." Supabase is now truth;
> Zapier writes to a webhook; the dashboard data layer is intentionally swapped in Phase 3.
## Resale North-Star (don't build yet, don't block it)
Supabase is already the tenant boundary (one data store per future firm). Drive-as-storage is
fine for RM117 — reassess at the first external firm.
