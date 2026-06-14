# RM117 BMS — Master Build Checklist
**Last updated:** 2026-06-13
**Working folder:** `RM117-App-handoff copy` (the second-gen scaffold)
**Status key:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Phase 0 — Accounts & Environment
> Goal: every account exists, keys are in `.env`, app boots showing "Supabase (live)" pill.

### Supabase
- [x] Upgrade Supabase account to **Pro tier** ($25/mo)
- [x] Confirm project exists in the Supabase dashboard
- [x] Copy **Project URL** from Settings → API → paste into `.env` as `SUPABASE_URL`
- [x] Copy **service_role secret key** from Settings → API → paste into `.env` as `SUPABASE_SERVICE_KEY`

### Local environment
- [x] `cp .env.example .env` inside this folder
- [x] Paste `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` into `.env`
- [x] Carry over Google creds from `rm117-bms/.env`:
  - [x] `GOOGLE_SERVICE_ACCOUNT_EMAIL`
  - [x] `GOOGLE_PRIVATE_KEY`
  - [x] `SHEET_ID`
- [x] `npm install`
- [x] `npm run dev` → app boots at http://localhost:5173

### Google Sheet
- [ ] Open the master Sheet → Share → add `rm117-sheets-reader@starry-tracker-498023-i0.iam.gserviceaccount.com` as **Viewer**
  - Note: Viewer-only is intentional — the app must never write back to the Sheet

### Clerk (staff auth)
- [x] Created account at clerk.com (GitHub login)
- [x] Application "RM117 BMS" created → Email + Google OAuth enabled
- [x] `VITE_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` → `.env`
- [x] `@clerk/clerk-react` installed, wired into `main.jsx` + `rm117-app-shell-v1.jsx`
- [x] Sign-in confirmed working with work Google account — 2026-06-13
- [x] Invited Ang (angelena@rm117.com) via Clerk Users dashboard — 2026-06-13
- [x] Phase-grouped jobs view built — Potential, Survey/Zoning, Design Phase, CD Phase, Active, On Hold, Completed sections with colored headers and job counts — 2026-06-13
- [x] Grouped/Table view toggle in toolbar

### Phase 0 done when:
- [x] App confirmed `"data_source": "supabase"` via `/api/health` — **2026-06-13**
- [ ] Master Sheet shared with service account (Viewer)
- [ ] Clerk deferred — complete before sharing app with Ang

---

## Phase 1 — Supabase Schema
> Goal: all tables exist, a test row writes and reads back, RLS is in place.

- [x] Open Supabase project → **SQL Editor**
- [x] Paste entire contents of `supabase/migrations/0001_init.sql` → **Run** — "Success. No rows returned" confirmed 2026-06-13
- [x] Verify tables created: `clients`, `file_records`, `forefront_commissions`, `invoices`, `jobs`, `messages`, `notifications`, `payments`, `proposals`, `staff`, `templates`, `threads` — all 12 present
- [x] Manually insert test row `26_TEST_Smith` → confirmed in `GET /api/jobs` response with `"source":"supabase"` and `"outstanding":5000` computed correctly — 2026-06-13
- [x] Delete test row

### Phase 1 done when:
- [x] All 12 tables exist in Supabase — confirmed 2026-06-13
- [x] Test row round-tripped through the API — confirmed 2026-06-13
- [x] RLS enabled (default-deny; service-role bypasses via api/ layer)

---

## Phase 2 — Historical Data Import (one-time migration)
> Goal: all historical jobs, payments, Forefront commissions in Supabase; zero `import_needs_review` flags.

- [x] Dry-run import: `npm run import:sheet -- --dry-run`
- [x] Review output — verified `COLUMN_MAP` against real Sheet headers (col layout was wrong; fixed)
- [x] Fixed column mapping: client_name→4, address→3, correspondence→1, notes→6, job_total→9; phase from section headers
- [x] Re-ran dry-run: 134 jobs, 0 flagged — clean
- [x] Run live import: `npm run import:sheet` — **133 unique jobs imported, 41 forefront_commissions rows, 0 flagged — 2026-06-13**
- [x] `import_needs_review` queue = 0 — no cleanup needed
- [x] Parse billing tabs — ran `npm run update:billing`: **111 jobs updated with real job_total, 7 forefront_commissions updated** — 2026-06-13
  - 116 billing-tab IDs not in Supabase = completed 2023/2024 jobs that aged out of Current Job Log (expected)
- [x] Forefront commission totals updated from $0 placeholders (7 updated; remainder have no column G amount in sheet)
- [x] **Parallel verification** — all 133 jobs visible in app, phases/clients/addresses/FF flags confirmed correct — 2026-06-13
- [ ] Manually add skipped jobs: `26_032_FF_Williams` (FF in wrong position in sheet), `XXX`-numbered potentials

### Phase 2 done when:
- [x] 133 jobs in Supabase — confirmed 2026-06-13
- [x] Job totals populated — dashboard shows $365,940 outstanding, $42,800 contracted — 2026-06-13
- [x] Forefront commission totals updated
- [x] Parallel verification complete
> **Phase 2 complete — 2026-06-13**

---

## Build Priority (agreed 2026-06-13)
> Goal: get Ang using the app for daily work with accurate data, then expand.
> Templates deprioritized — not essential to daily workflow per Ang.

1. **Invite Ang to Clerk** + test job editing/payment logging
2. **Deploy to Vercel** (Ang needs a real URL, not localhost)
3. **Forefront commissions view** (Phase 6 — she tracks this daily)
4. **QuickBooks sync** (Phase 4 — inbound: Zapier webhook when invoice paid → payments row)
5. **DocuSign** (Phase 5 partial — proposals)
6. **Client Portal** (Phase 7)
7. **Templates** (Phase 5 — last, not essential per Ang)

---

## Phase 3 — App Re-point + Core Job Management
> Goal: staff can create, edit, search all jobs in the app; Sheet archived.

- [ ] Re-point `api/jobs.js` to read live Supabase data (replaces mock)
- [ ] Confirm `api/jobs/update.js` saves job edits to Supabase
- [ ] Confirm `api/jobs/create.js` creates new jobs in Supabase
- [ ] `JobEditor` drawer: edit + save all fields, optimistic UI, error rollback
- [ ] Dashboard stat tiles reflect live Supabase data
- [ ] Job filters work: by phase, Forefront flag, client name
- [ ] Set up Clerk auth (if not done in Phase 0): admin roles for Ray + Ang
- [ ] Run app in parallel with Sheet for 1–2 weeks; Ang confirms data matches
- [ ] **Archive the master Sheet** (move to read-only; remove service account Viewer access)

### Deferred accounts to set up before Phase 3:
- [ ] Create **Company Google Calendar** → record Calendar ID → add to `.env` as `COMPANY_CALENDAR_ID`
  - Ang adds the company calendar to Apple Calendar for two-way sync

### Phase 3 done when:
- Daily job management runs entirely in the app
- Sheet is archived

---

## Phase 4 — Payments, Billing & Quarterly View
> Goal: every payment logged in app; outstanding always accurate; QBO paid invoices sync back.

- [ ] `api/payments.js` — create/read/update payment records
- [ ] `JobEditor` Payments tab: full payment history + inline "log a payment"
- [ ] `outstanding` computed from real payment records
- [ ] Billing view: quarterly breakdown by job, outstanding highlighted
- [ ] Set up **Zapier webhook**: on QBO paid invoice → POST to Supabase edge function → creates `payments` row

### Deferred accounts for Phase 4:
- [ ] Set up **Zapier** account + webhook step (connects to QBO)
  - Zapier triggers on "Invoice Paid" in QBO → POSTs Job ID + amount to your Supabase edge function URL

### Phase 4 done when:
- All payments logged; outstanding accurate; QBO paid invoices auto-sync via webhook

---

## Phase 5 — Proposals, Invoices & Email Templates
> Goal: proposal or invoice generated from template in <2 min; invoices create in QBO via API.

- [ ] `templates` table populated: proposal types, invoice types, email templates
- [ ] Proposal flow: select template → fill → preview → send via DocuSign → track status
- [ ] Invoice flow: select template → edit line items → preview → send via Resend + create in QBO
- [ ] `qbo_invoice_id` stored so Phase 4 webhook can match payment back

### Deferred accounts for Phase 5:
- [ ] **DocuSign** — Standard plan (~$25/mo; check if Ang qualifies for $20 REALTORS plan)
  - Create account → copy Integration Key, User ID, Account ID, Private Key → `.env`
- [ ] **Resend** (email service) — verify sending domain `rm117.com` → copy API key → `.env`
  - Validate inbound email parsing works before committing to it (Postmark is fallback)
- [ ] **QuickBooks Online API**
  - Go to developer.intuit.com → create app → copy Client ID + Secret → `.env`
  - Complete OAuth flow → store refresh token as `QBO_REFRESH_TOKEN`
  - Store `QBO_REALM_ID` (your QBO company ID)

### Phase 5 done when:
- Proposals go through DocuSign; invoices create in QBO via API and sync back

---

## Phase 6 — Forefront Commissions View
> Goal: Forefront tracking fully in the app; Sheet tab redundant.

- [ ] Dedicated Forefront section in sidebar (replace current placeholder)
- [ ] Per-job commission: total owed, amount paid, payment history, status
- [ ] Commission payment logging (date, amount, method)
- [ ] Summary view: total outstanding commissions across all active Forefront jobs
- [ ] Data from Phase 2 import — no new data entry needed

### Phase 6 done when:
- Forefront is fully tracked in app; Sheet Forefront Commissions tab is redundant

---

## Phase 7 — Client Portal
> Goal: a client can log in, view their job, download PDFs, and message the firm.

- [ ] Clerk `client` role: magic-link login with email on file (no password)
- [ ] Portal landing: client sees only their own job(s) — phase, outstanding balance
- [ ] Document vault: per-job file list from Drive *Files Sent* folder; clients can download
- [ ] Per-job messaging: one thread per job; firm message → client email notification
- [ ] Inbound email reply → appended to portal thread (validate Resend inbound parsing first)
- [ ] Onboarding flow: intake → proposal → DocuSign → on signing → Supabase creates client account + sends login invite
- [ ] Every API call verifies caller owns that Job ID — no cross-client data leakage
- [ ] Clients never get Google Drive permissions — backend brokers all file access

### Phase 7 done when:
- Client logs in, views job, downloads files, sends/receives messages through portal

---

## Phase 8 — Billing Automation (BLOCKED)
> Blocked until Ang defines the trigger map (which phase transition → which invoice → what amount).

- [ ] **[BLOCKED]** Define trigger map with Ang: phase X → phase Y = auto-draft invoice of type Z
- [ ] Phase-transition rule engine: moving job phase auto-creates draft invoice
- [ ] Human-in-the-loop: staff reviews + approves draft before it sends
- [ ] Trigger map stored as config in a settings table (not hardcoded)

---

## Costs once live (firm pays; clients pay nothing)
| Service | Cost |
|---|---|
| Supabase Pro | ~$25/mo |
| DocuSign Standard | ~$25/mo |
| Resend / email | $0–20/mo |
| Vercel | $0–20/mo |
| Zapier | $0–20/mo |
| Google Workspace | already in use |
| QuickBooks | already in use |
| **Total** | **≈ $50–90/mo** |

---

## Quick reference — env vars by phase

| Var | Phase needed | Source |
|---|---|---|
| `SUPABASE_URL` | 0 | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | 0 | Supabase → Settings → API (service_role) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | 0/2 | Already in `rm117-bms/.env` |
| `GOOGLE_PRIVATE_KEY` | 0/2 | Already in `rm117-bms/.env` |
| `GOOGLE_APPLICATION_CREDENTIALS` | 0/2 | Path to key JSON (alt to inline key) |
| `SHEET_ID` | 2 | Already in `rm117-bms/.env` |
| `VITE_CLERK_PUBLISHABLE_KEY` | 0 (before sharing with Ang) | clerk.com dashboard |
| `CLERK_SECRET_KEY` | 0 (before sharing with Ang) | clerk.com dashboard |
| `COMPANY_CALENDAR_ID` | 3 | Google Calendar → Settings → Calendar ID |
| `RESEND_API_KEY` | 5 | resend.com dashboard |
| `DOCUSIGN_INTEGRATION_KEY` | 5 | developer.docusign.com |
| `DOCUSIGN_USER_ID` | 5 | DocuSign admin |
| `DOCUSIGN_ACCOUNT_ID` | 5 | DocuSign admin |
| `DOCUSIGN_PRIVATE_KEY` | 5 | DocuSign JWT key |
| `QBO_CLIENT_ID` | 5 | developer.intuit.com |
| `QBO_CLIENT_SECRET` | 5 | developer.intuit.com |
| `QBO_REFRESH_TOKEN` | 5 | OAuth flow |
| `QBO_REALM_ID` | 5 | QuickBooks company ID |
