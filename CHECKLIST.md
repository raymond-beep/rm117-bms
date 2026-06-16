# RM117 BMS — Master Build Checklist
**Last updated:** 2026-06-15 (visual refresh + mobile responsive shipped)
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
2. ~~**Deploy to Vercel**~~ ✅ **Live at rm117-bms.vercel.app — 2026-06-13**
3. ~~**Forefront commissions view**~~ ✅ **Live — 41 FF jobs, $2,050 tracked, payment logging works — 2026-06-13**
4. ~~**QuickBooks sync**~~ ✅ **Zapier webhook live + historical payments imported — 2026-06-14**
5. ~~**Priority Inbox (Gmail)**~~ ✅ **Live — per-user read-only Gmail, client-sender matching — 2026-06-15**
6. ~~**Client backbone (from QBO)**~~ ✅ **`clients` table seeded + typed — 2026-06-15**
7. **DocuSign** (Phase 5 partial — proposals)
8. **Client Portal** (Phase 7)
9. **Templates** (Phase 5 — last, not essential per Ang)

---

## Priority Inbox + Client Backbone — 2026-06-15
> Goal: dashboard surfaces each user's client emails; `clients` table becomes the real backbone.

### Priority Inbox (Gmail) — DONE
- [x] Per-user read-only Gmail via Clerk Google OAuth + `gmail.readonly` (`api/inbox.js`, `_lib/clerk.js`)
- [x] OAuth fixed: Clerk custom-credentials **Scopes** must be the FULL URL
  `https://www.googleapis.com/auth/gmail.readonly` (bare `gmail.readonly` → Google `invalid_scope`)
- [x] Google Cloud project = **rm117-bms** (# 358622628253) on Ray's personal Gmail; Testing mode,
  Ray+Ang test users — do NOT publish (restricted scope)
- [x] Sender→client matching upgraded to email-first + surname fallback (`_lib/client-match.js`)
- [x] Deployed to production (working-dir `vercel deploy --prod`)
- [ ] **Known issue — surname fallback false-positives:** non-client senders get tagged as clients
  (e.g. **"ClickUp Team"** matched a client surname). Tighten `_lib/client-match.js`: skip
  no-reply/automated/team addresses + known SaaS domains; require email-domain match (not just
  surname) before flagging. Low priority — cosmetic, noted 2026-06-15.

### Client backbone (QBO Customer Contact List) — DONE
- [x] `scripts/import-clients.js` — 64 clients imported (46 w/ email), 64/133 jobs linked
- [x] Clients typed: 2 contractor, 8 investor (incl. Monita Sun), rest homeowner
- [ ] **Reconcile 12 unmatched QBO customers** → see `CLIENT-RECON.md`, then re-run `import-clients.js`
- [ ] Merge duplicate no-email client rows (Gabe DaSilva ×2, Josh Russo ×2)
- [ ] Commit the inbox + client work to git (currently deployed but uncommitted)

### Google Calendar widget — DONE (personal); shared cal pending Ang
- [x] `calendar.readonly` scope added (Google + Clerk), Google Calendar API enabled in rm117-bms
- [x] `api/calendar.js` + `CalendarWidget` live — reads user's primary Google cal + `COMPANY_CALENDAR_ID`
- [ ] **Shared RM117 calendar (needs Ang — she owns the iCloud one):** create a Google calendar for
  RM117, share with all staff, everyone adds it to Apple Calendar (add Google account) for native
  two-way sync. Then give Ray the Calendar ID → set `COMPANY_CALENDAR_ID` in `.env` + Vercel → redeploy.

---

## Visual Refresh ("Architectural" direction) + Mobile — 2026-06-15
> Goal: recreate the design-handoff look in the live codebase, and make it usable on a phone.
> Source: `~/Desktop/design_handoff_rm117_visual_refresh/` (README + `RM117 Mockup.dc.html` + screenshots).

### Desktop refresh — DONE
- [x] JetBrains Mono loaded (`index.html`); used for ALL data (IDs, money, dates, stat values, micro-labels)
- [x] Warm-paper token set in `src/styles.css` (`#f6f5f1` bg, `#e6e3db` borders, `#9a968c`/`#7a766c` text)
- [x] Title-block stat strip (single container, 1px gridlines, big mono values)
- [x] Grouped sidebar nav (WORKSPACE / UPCOMING mono captions, brass active left-border, brass avatar chip)
- [x] Eyebrow + greeting page headers; recolored phase group bars; refreshed editor drawer + payments tab
- [x] Forefront + BMS + Dashboard restyled; **functionality unchanged**
- [x] Committed `8d0ef17` + deployed prod → rm117-bms.vercel.app

### Mobile responsive — DONE
- [x] Sidebar hidden ≤760px; slim dark mobile top bar (brand + Clerk `UserButton` for sign-out / Connect Google)
- [x] Bottom tab bar (Home / Jobs / Forefront), active-tab in `--primary`
- [x] Stacked header, 2×2 stat tiles, single-column cards, sized-down type
- [x] Fixed CSS Grid overflow: `minmax(0,1fr)` on stat strip + grid-2 (mono data shrinks to fit)
- [x] Verified at true 390px via Chrome DevTools-Protocol emulation — NO OVERFLOW on Dashboard + BMS
- [x] Committed `fab22e4` + deployed prod; confirmed on Ray's phone 2026-06-15

### Still TODO from the handoff (own pass)
- [ ] Mobile BMS toolbar → compact filter-chip row (currently wraps to stacked rows — usable, not pixel-perfect)
- [ ] Client Portal (Phase 7) — desktop + mobile (net-new surface; backbone ready)
- [ ] Mobile field-specific screens (job detail w/ call/directions, bottom-sheet log-payment)

---

## Phase 3 — App Re-point + Core Job Management
> Goal: staff can create, edit, search all jobs in the app; Sheet archived.

- [x] Re-point `api/jobs.js` to read live Supabase data — confirmed working 2026-06-13
- [ ] Confirm `api/jobs/update.js` saves job edits to Supabase
- [ ] Confirm `api/jobs/create.js` creates new jobs in Supabase
- [ ] `JobEditor` drawer: edit + save all fields, optimistic UI, error rollback
- [x] Dashboard stat tiles reflect live Supabase data — outstanding computed from payments table
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

- [x] `api/payments/webhook.js` — POST endpoint with secret auth, job lookup, payment insert — 2026-06-14
- [ ] `api/payments.js` — GET payment history per job (for JobEditor Payments tab)
- [ ] `JobEditor` Payments tab: full payment history + inline "log a payment"
- [x] `outstanding` computed from real payment records — live in `api/jobs.js` — 2026-06-13
- [ ] Billing view: quarterly breakdown by job, outstanding highlighted
- [x] **Zapier webhook live**: QBO "New Paid Invoice" → POST to `rm117-bms.vercel.app/api/payments/webhook` → `payments` row — 2026-06-14
- [x] **Historical payments imported**: 131 payments from QBO CSV via `scripts/import-payments.js` — 2026-06-14
- [x] **Job totals corrected**: 77 `job_total` values synced from QBO invoice data via `scripts/sync-job-totals.js` — 2026-06-14

### Remaining QBO cleanup (next session):
- [ ] Add `26_FF_032_Riera` to Supabase — exists in QBO but not in app
- [ ] Resolve ~10 name mismatches between QBO and Supabase (job numbers differ slightly — need Ray to confirm correct mapping before auto-applying):
  - `25_052_FE_Mendham` (QBO) vs `25_053_FE_Mendham` (Supabase)
  - `25_054_Malanga_Subdivide` (QBO) vs `25_053_Malanga_Subdivide` (Supabase)
  - `26_025_Samsel_510 Harrison Place` (QBO) vs `26_022_Samsel_510 Harrison. Place` (Supabase)
  - Personal-name QBO accounts (Mickael Avedissian, Jay Rodriguez, etc.) — need Ray to confirm which job IDs these map to
- [ ] Ang to review $190K outstanding on "completed" phase jobs — money owed on finished work

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
> **Prereq DONE (2026-06-15):** `clients` table seeded from QBO (64 clients, emails on file,
> jobs linked via `client_id`) — the login/identity backbone now exists.

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
