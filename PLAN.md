# RM117 — PLAN.md
# Build plan for the RM117 BMS — Second Generation.
# Follow alongside ADR-001, VISION.md, CLAUDE.md, and SCHEMA.md. Work top-down;
# each phase is roughly one Claude Code session. Check items off as you go.

## North star (one sentence)
Supabase becomes the single source of truth for all job, client, financial, and
correspondence data. The Google Sheet is the **seed, not the spine**. QuickBooks
becomes a payment processor and invoice-delivery channel, not a record-keeping system.

## How to use this
- Read CLAUDE.md (context), VISION.md (the why), ADR-001 (the decision), and
  SCHEMA.md (the data model) at the start of each session.
- Do not skip Phase 0 — nothing downstream works until the accounts/env exist.
- Keep every step scoped by **Job ID**, the shared key across Sheet/Drive/QBO/Supabase.
- Phase 8 (billing automation) stays BLOCKED until Ang defines the trigger map.

> **Phase renumber (was 7 phases, now 9: 0–8).** Forefront moved to its own phase (6),
> the client portal moved to 7, and billing automation moved from old "Phase 6" to **Phase 8**.
> When talking to Ang, "the billing automation phase" = Phase 8 now.

---

## The three eras
- **Era 1 (Phases 0–2):** Stand up the database, migrate historical data, get the app
  reading from Supabase instead of the Sheet. Ang's workflow doesn't change yet — she
  keeps using the Sheet (read-only fallback stays live through Phase 3) while you verify.
- **Era 2 (Phases 3–6):** Build the staff tools — job editing, billing/invoicing,
  proposals, email templates, Forefront tracking. The app becomes useful for daily work
  and the Sheet starts collecting dust.
- **Era 3 (Phases 7–8):** Build the client-facing layer — portal, vault, messaging — and
  finally phase-transition billing automation.

---

## Phase 0 — Accounts & environment  ⬅️ START HERE (mostly outside Claude Code)
Nothing downstream works until these exist. Do them first, in order.

- [ ] **Create the Supabase project** (Pro tier — the free tier pauses after a week of
      inactivity, which kills a live portal). Save project URL, anon key, service-role key.
- [ ] **Confirm Clerk:** a `client` role can be added; Google scopes
      (`gmail.readonly` + `calendar.readonly`) are still set.
- [ ] **Create the company Google Calendar** and record its ID for `COMPANY_CALENDAR_ID`.
- [ ] **Create the email-service account** (Resend; Postmark if Resend's inbound parsing
      proves unreliable). Verify the sending domain. Save the API key.
      Flag: **validate inbound email parsing before Phase 7 commits to it.**
- [ ] **Create the DocuSign account** (Standard plan; ~100 envelopes/yr). Note the
      integration key. (Check if Ang qualifies for the $20 REALTORS plan.)
- [ ] **Enable the QuickBooks Online API** (outbound invoicing — Phase 5). Create an
      Intuit developer app; save the client ID/secret and set up the OAuth refresh-token
      flow. This is new tooling vs. the first-generation plan.
- [ ] **Set up a Zapier webhook step** that can POST to a Supabase edge function URL
      (this replaces the old Lookup-tab approach entirely).
- [ ] **Add env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`
      (or `POSTMARK_*`), `DOCUSIGN_*`, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`,
      `QBO_REFRESH_TOKEN`, `COMPANY_CALENDAR_ID`. Keep existing `SHEET_ID` + Google
      service-account creds (still needed for the import and the Drive file-broker).
- [ ] **Share the master Sheet** with the service account as **Viewer** (read-only). This is
      deliberate: Viewer is enough for the one-time import, and it guarantees the app/Claude Code
      can never write back to the Sheet, keeping it a clean fallback through Phase 3.
- **Done when:** all accounts exist, keys are in `.env`, `npm run dev` boots clean, and
  the master Sheet is shared with the service account.

## Phase 1 — Supabase schema
The full second-generation data model. Design it right once. See **SCHEMA.md** for fields.

- [ ] Create core tables: `jobs`, `payments`, `invoices`, `proposals`, `templates`,
      `forefront_commissions`, `staff`.
- [ ] Create client-tier tables (used from Phase 7): `clients`, `threads`, `messages`,
      `file_records`, `notifications`.
- [ ] `outstanding` on a job is computed (`job_total - sum(payments.amount)`), not stored.
- [ ] Add row-level security: all staff roles get full read/write on everything except
      `staff` (admin only). The `client` role (Phase 7) gets read-only on its own `jobs`,
      `file_records`, `threads`, and `messages` rows, scoped by Job ID.
- [ ] Add a small DB client module; verify read/write from an `api/` function.
- **Done when:** schema is live, a test row writes and reads back from an `api/` function,
  RLS policies are in place.

## Phase 2 — Historical data import (one-time migration)
- [ ] **Import script** (`scripts/import-sheet.js`): read the master Sheet via the Sheets
      API (service account, Viewer). Parse `Current Job Log` row by row, extracting Job ID,
      correspondence, address, client, notes, bill flag, phase, and Forefront flag/commission.
      Write clean rows to `jobs` (+ `forefront_commissions` where applicable).
- [ ] Parse the `2026/2025/2024/2023_Billing` tabs into `payments` rows. Reconcile the
      `Forefront Commissions` tab into `forefront_commissions`.
- [ ] Any row that fails to parse cleanly: write the raw cell content to `import_notes` and
      set `import_needs_review = true`. These become a cleanup queue.
- [ ] **Parallel verification (1–2 weeks):** app reads from Supabase; Sheet stays untouched;
      staff keep working in the Sheet. Spot-check jobs across both to verify the import.
- [ ] **Manual cleanup:** work the `import_needs_review` queue in the app to zero flags.
- [ ] **Sheet stays a read-only fallback through Phase 3** — do NOT archive yet. The
      service account holds **Viewer** access only, so nothing the app (or Claude Code) does
      can accidentally write back to the Sheet during the migration.
- **Done when:** all historical jobs, payments, and Forefront commissions are in Supabase;
  no `import_needs_review` flags remain. (Sheet archival happens at the end of Phase 3,
  not here.)

## Phase 3 — App re-point + core job management
> Lifts the old "dashboard behavior is frozen" rule. The BMS keeps its existing UX, but its
> **data layer is swapped underneath** from Sheet → Supabase. Preserve behavior; change the source.

- [ ] Re-point `api/jobs.js` to read from Supabase; replace the artifact's `JOBS` mock data
      with live data.
- [ ] `api/jobs/update.js` — the `saveJobToSheet()` seam becomes `saveJob()` writing to
      Supabase (phase, notes, bill flag, job total, last correspondence, phase override).
- [ ] `api/jobs/create.js` — new-job creation from the app (replaces entering jobs in the Sheet).
- [ ] `JobEditor` drawer fully functional: edit any field, save to Supabase, optimistic UI
      update, real error handling + rollback.
- [ ] Dashboard stat tiles (active pipeline, outstanding, bill flags, Forefront) derived from
      live Supabase data.
- [ ] Jobs view gets filter/search — by phase, Forefront flag, staff member, client name.
- [ ] Roles: admin (Ray, Ang) see all fields incl. financials; staff same for now, with the
      architecture in place to restrict later.
- [ ] **Retire the Sheet:** once staff have run daily work in the app and confirmed it holds,
      move the master Sheet to a read-only archive and remove the service account's Sheet access.
- **Done when:** staff can create, edit, and search all jobs entirely in the app; the Sheet is
  no longer needed for daily job management and has been archived.

## Phase 4 — Payments, billing, and the quarterly view
- [ ] `api/payments.js` — create/read/update payment records per job (type, amount, method, date).
- [ ] `JobEditor` gets a **Payments tab**: full payment history per job + inline "log a payment".
- [ ] `outstanding` computed from payment records — replaces the Sheet formula and the manual
      billing-tab tracking.
- [ ] **Billing view:** quarterly breakdown derived automatically from `payments`. Gross revenue
      per quarter, per job, outstanding highlighted. Replaces the `2026_Billing` tab format,
      always accurate because it reads real payment data.
- [ ] **Zapier webhook in:** on a paid QBO invoice, Zapier POSTs to a Supabase edge function that
      creates a `payments` row. Match key = Job ID in the QBO **Customer Display Name**.
- **Done when:** every payment is logged in the app; outstanding is always accurate; the quarterly
  view is automatic; QBO paid invoices sync back via webhook.

## Phase 5 — Proposals, invoices & email templates
- [ ] **Templates system** (`templates` table, iterated without code changes):
      - Proposal templates by project type (addition/renovation, new construction, fire escape,
        interior…), each with scope / fee schedule / payment milestones / terms.
      - Invoice templates (retainer, DP1, DP2, CD, final), line items editable before sending.
      - Email templates (`type = 'email'`): follow-up, designs-for-review, billing reminder,
        proposal cover note — staff can create + save their own.
- [ ] **Proposal flow:** select template → fill job details → preview → send via DocuSign
      (email PDF fallback) → status tracked in `proposals` → on signing, status → `signed`,
      optionally triggers retainer invoice creation.
- [ ] **Invoice flow:** select template → review/edit line items → preview → send to client via
      Resend **and create in QuickBooks via the QBO API**. Store `qbo_invoice_id` so the Phase 4
      Zapier sync matches payment back. This is the outbound QBO integration — the app creates the
      invoice in QBO instead of Ang doing it by hand.
- **Done when:** a proposal or invoice is generated from a template in under two minutes; email
  templates are accessible + saveable; proposals track through DocuSign; invoices create in QBO via
  API and sync payment status back via Zapier.

## Phase 6 — Forefront commissions view
- [ ] Dedicated Forefront section in the sidebar (replaces the current placeholder).
- [ ] Per-job commission tracking: total owed, amount paid, payment history, status.
- [ ] Commission payment logging (date, amount, method).
- [ ] Summary view: total outstanding commissions across all active Forefront jobs.
- [ ] Data imported in Phase 2 — no new data entry.
- **Done when:** Forefront tracking is fully in the app and the Sheet tab is redundant.

## Phase 7 — Client portal
- [ ] Clerk `client` role — clients sign in with the email on file (magic link, no password).
- [ ] Portal landing: client sees only their own job(s) — details, current phase, outstanding.
- [ ] Document vault: per-job file list from the Drive *Files Sent* folder (service account);
      clients download. Upload into *Files Received* is the stretch goal (hide button for view-only).
- [ ] Per-job messaging: one thread per job. Firm message → client email notification via Resend;
      client email reply → inbound parse appends to the thread.
      **Validate Resend inbound parsing before committing — Postmark is the fallback.**
- [ ] Onboarding sequence: intake → proposal → DocuSign → on signing, Supabase creates the client
      account + sends a login invite → app prompts for retainer invoice creation.
- [ ] Every call verifies the caller owns that Job ID. Clients get **no** Drive permissions.
- **Done when:** a client can log in, view their job, download PDFs, and message the firm; replies
  come back into the portal thread.

## Phase 8 — Billing automation (BLOCKED)
- [ ] Phase-transition rule engine: moving a job from phase X → Y auto-creates a **draft** invoice
      for the configured amount and notifies the assigned staff member.
- [ ] Human in the loop: staff reviews/approves the draft before it sends — no fully automatic
      billing initially.
- [ ] The trigger map (phase transition → invoice type → amount formula) is **configuration, not
      code** — Ang defines it, Ray enters it into a settings table, it runs from there.
- **Blocked until:** Ang defines which phase transitions trigger which invoice amounts.

---

## What gets retired, in order
- The Google Sheet stays a **live, read-only fallback through Phase 3**, then moves to a
  read-only archive at the end of Phase 3 (once daily work has fully moved into the app).
- The Zapier **Lookup-tab** approach is never built into the master Sheet — from Phase 4 on,
  Zapier writes **directly to Supabase via webhook**.
- The test copy-sheet is deleted once the Phase 2 import is verified.
- QuickBooks stays as the invoice-delivery + payment-collection channel but stops being a
  record-keeping system as the app's invoice/payment tracking matures.

## Invariants — never break these
- Job ID `YY_NNN_[FF_]LastName` must match the QuickBooks Customer Display Name exactly —
  it is the shared key across Sheet (during migration), Drive, QBO, and Supabase.
- A client must never access another client's jobs, files, or messages.
- Through Phase 3, the master Sheet stays a **read-only / untouched** fallback — the service
  account is Viewer-only and the app reads from Supabase, never writing back into the Sheet.
- Clients never receive Google Drive permissions; the backend brokers every file access.

> **Retired invariants (first-generation, no longer apply):** "Google Sheet is the source of
> truth," "never write the Sheet's Outstanding column," "never modify the Zapier Lookup tab,"
> and "`rm117-dashboard-v1.jsx` behavior is frozen." Supabase is now truth; the Sheet is archived;
> Zapier writes to a webhook; the dashboard's data layer is intentionally swapped in Phase 3.

## Rough cost once live (firm pays; clients pay nothing)
Supabase ~$25/mo · DocuSign ~$25/mo · email $0–20/mo · Vercel $0–20/mo ·
Drive storage $0 (already in Workspace) · QuickBooks already in use · QBO API $0 →
**≈ $50–90/mo total.**
