# RM117 BMS — Claude Context

## What this is
Job + client management platform for **Room 117 Architecture & Design LLC** (RM117, Ray's firm) —
jobs, billing, payments, proposals, Forefront commissions, correspondence. **Second-gen:** Supabase
is the source of truth; the Google Sheet is the migration seed + read-only fallback through Phase 3;
QuickBooks is a payment/invoice-delivery channel, not a record-keeper.

## Stack
- **Frontend:** React 19 + Vite — app shell `src/rm117-app-shell-v1.jsx` hosting the BMS dashboard
- **API:** Vercel Serverless Functions in `api/` (wrapped by `server.js` for local dev)
- **Data (truth):** Supabase (Postgres) — all jobs, payments, invoices, proposals, Forefront,
  templates, staff, and portal data. See SCHEMA.md.
- **Data (seed/fallback):** Google Sheets API, service account **Viewer-only**, through Phase 3
  (read for the import; never written by the app)
- **Files:** Google Drive (per-job *Files Sent* / *Files Received*); backend brokers all access
- **Auth:** Clerk (staff today; `client` role in Phase 7)
- **Email:** Resend (portal notifications + inbound reply bridge; Postmark fallback)
- **E-sign / invoicing:** DocuSign (proposals); QuickBooks Online API (outbound invoices)
- **Deployment:** Vercel (auto-deploys from `main`)

## Local dev
`npm run dev` → Vite (5173) + Express API (3001) via concurrently. Vite proxies `/api/*` →
`localhost:3001`. VS Code build task: `Cmd+Shift+B`.

## Key files
| File | Purpose |
|------|---------|
| `src/rm117-app-shell-v1.jsx` | App shell: sidebar, dashboard, calendar, inbox, BMS at `/bms` |
| `src/rm117-dashboard-v1.jsx` | BMS job dashboard — data layer being swapped Sheet→Supabase (Phase 3) |
| `api/jobs.js` | GET /api/jobs — reads jobs from Supabase, joins each job's `client` record |
| `api/jobs/update.js` | POST — `saveJob()` writes job edits; stamps a `job_phase_events` row on phase change |
| `api/clients.js` | GET /api/clients — client list for the Details-tab picker |
| `api/payments.js` | Payment records per job (Phase 4); webhook dedups on `qbo_invoice_id` |
| `api/phase-events.js` | GET/POST/DELETE — per-job phase-reached timeline (Progress tab) |
| `scripts/import-sheet.js` | One-time Sheet → Supabase migration (Phase 2) |
| `scripts/link-jobs-to-clients.js` | Link unlinked jobs to existing clients (dry-run default) |
| `scripts/create-clients-for-unlinked.js` | Create clients for unlinked jobs w/ real names (dry-run default) |
| `.env` | Supabase, Resend, DocuSign, QBO, Google creds |

All `api/` routes must also be registered in `server.js` (the local-dev Express wrapper); on Vercel
each `api/` file deploys directly as a function.

## Environment
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY` (or `POSTMARK_*`), `DOCUSIGN_*`,
`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REFRESH_TOKEN`, `COMPANY_CALENDAR_ID`, plus existing
`SHEET_ID` + Google service-account creds (for the import + Drive broker).
- **Use a personal Gmail for Google Cloud** — the rm117.com org's
  `iam.disableServiceAccountKeyCreation` blocks service-account key downloads.

## Data model
Full schema in **SCHEMA.md**. Core tables: `jobs`, `payments`, `invoices`, `proposals`,
`templates`, `forefront_commissions`, `staff`, `job_phase_events`. Client tier (Phase 7): `clients`,
`threads`, `messages`, `file_records`, `notifications`.
- **`jobs`** keyed by Job ID (`YY_NNN_[FF_]LastName`). `client_id` = who's billed;
  `referred_by_id` = who referred the work in (nullable; inbound referrals only — no outbound).
  `next_milestone_label` + `next_milestone_date` = the one upcoming "date to follow".
- **`outstanding` is computed**, never stored: `job_total - sum(payments.amount)`.
- **`job_phase_events`** = append-only log of when each job reached a phase (powers the Progress
  timeline). Auto-stamped on phase change; editable per phase via `POST /api/phase-events`.
- `import_notes` / `import_needs_review` flag rows the Phase 2 import couldn't parse cleanly.

## Progress Timeline (internal — chosen over the client portal)
Ray opted to hold the external client portal (login-management overhead) and instead surface job
progress to staff: the JobEditor **Progress tab** shows a phase ladder (reached dates, editable) +
a "Next milestone" date; the dashboard shows a **"Coming up"** strip. Portal tables still exist for
a future revisit.

## Job phases (single `phase` field, in order — no separate status)
Potential → Survey/Zoning → Design Phase → CD Phase → Active → On Hold → Completed
"Active" = finishing touches before completion. `phase_override` wins when set.

## Integrations
- **QBO outbound:** app creates invoices via API; `qbo_invoice_id` links back. **QBO inbound:**
  on a paid invoice, Zapier webhook → Supabase edge fn creates a `payments` row, matched by Job ID
  in the QBO **Customer Display Name**.
- **DocuSign:** proposals sent for e-signature; status tracked in `proposals`.
- **Email bridge:** outbound notify on new portal message; inbound parse appends client replies
  to the thread (validate Resend inbound parsing before Phase 7).
- **Calendar:** dashboard reads the user's Google Calendar + shared `COMPANY_CALENDAR_ID`; Ang
  adds the company calendar to Apple Calendar for native two-way sync.

## Invariants (do not break)
- Job ID `YY_NNN_[FF_]LastName` must match the QuickBooks Customer Display Name exactly.
- Through Phase 3 the Sheet is a **read-only fallback** — service account is Viewer-only;
  the app reads from Supabase and never writes back to the Sheet.
- Clients never receive Google Drive permissions; the backend brokers every file access.
- A client must never access another client's jobs, files, or messages.
> Superseded first-gen rules: "Sheet is the source of truth," "never write the Outstanding
> column," "never touch the Zapier Lookup tab," "dashboard behavior is frozen." Supabase is now
> truth; Zapier writes to a webhook; the dashboard data layer is intentionally swapped in Phase 3.
