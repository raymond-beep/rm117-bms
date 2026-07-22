# RM117 BMS — Claude Context

## What this is
Job + client management platform for **Room 117 Architecture & Design LLC** (RM117, Ray's firm) —
jobs, billing, payments, proposals, Forefront commissions, correspondence. **Second-gen:** Supabase
is the source of truth; the Google Sheet is the migration seed + read-only fallback through Phase 3.
QuickBooks is the **accounting** system of record; the app is its clean front-end via a **live two-way
sync** (2026-06-30): the app creates QBO customers/invoices, and paid QBO invoices flow back as
`payments`. The **Job ID is the connective tissue** — it must equal the QBO Customer Display Name and
the Google Drive folder name exactly (the "Correct Job ID" tool renames all three together).

## Stack
- **Frontend:** React 19 + Vite — app shell `src/rm117-app-shell-v1.jsx` hosting the BMS dashboard
- **API:** Vercel Serverless Functions in `api/` (wrapped by `server.js` for local dev). On
  **Vercel Pro** (upgraded 2026-06-20) — no function-count cap concern; build each endpoint as its
  own standalone file (e.g. `api/jobs.js`). The `api/portal/[action].js` dispatcher predates Pro and
  stays as a coherent group, but new features no longer need to be consolidated to dodge a cap.
- **Data (truth):** Supabase (Postgres) — all jobs, payments, invoices, proposals, Forefront,
  templates, staff, and portal data. See SCHEMA.md.
- **Data (seed/fallback):** Google Sheets API, service account **Viewer-only**, through Phase 3
  (read for the import; never written by the app)
- **Files:** Google Drive (per-job *Files Sent* / *Files Received*); backend brokers all access
- **Auth:** **two separate systems, on purpose.**
  - **Staff → Clerk** (Google sign-in, `@rm117.com`). Clerk is a **Development** instance; there is
    no production instance and none is needed.
  - **Clients → magic link, no Clerk account at all** (2026-07-13). A client clicks a signed,
    expiring, revocable link in an email; `/api/portal/enter` exchanges the token for an HttpOnly
    session cookie. See `api/_lib/portal-session.js` (the crypto) and `portal_links` (the table).
    Rationale: a homeowner won't keep a password and a developer won't tolerate one, but both will
    click a link — and the notification email is the portal's front door anyway. This also keeps a
    Clerk production instance + client-facing DNS off the critical path entirely.
  - Clients never touch the Google OAuth app, so the portal can't consume the Google 100-test-user cap.
- **Email:** Resend (portal notifications + inbound reply bridge; Postmark fallback)
- **E-sign / invoicing:** DocuSign (proposals); QuickBooks Online API (outbound invoices)
- **Documents:** client-side PDF generation with **`pdf-lib`** (building-dept letters + proposals) — see
  Document generators below. No server/AI; PDFs assemble in the browser.
- **Deployment:** Vercel, **auto-deploys from `main`** (Git integration). `git push origin main` = production;
  **do NOT run `vercel --prod`** (causes duplicate deploys). A **test gate** runs first: `vercel-build` =
  `vitest run && vite build`, so a failing test aborts the deploy. Roll back via the Vercel dashboard or
  `vercel rollback`. Tests live in `tests/` (Vitest); `npm test` to run locally.

## Local dev
`npm run dev` → Vite (5173) + Express API (3001) via concurrently. Vite proxies `/api/*` →
`localhost:3001`. VS Code build task: `Cmd+Shift+B`.

## Key files
| File | Purpose |
|------|---------|
| `src/rm117-app-shell-v1.jsx` | App shell: sidebar, dashboard, calendar, inbox, the job board at `/bms`. **Sidebar label is "Project Management"** (renamed from "BMS" 2026-07-13) — the **route stays `/bms`** so links/bookmarks don't break, same as the Drawing QA → Checksets rename. Mobile bottom tab bar = `MOBILE_TABS` (Home · Jobs · **Financial** · Portal — Forefront is desktop-sidebar-only) |
| `src/rm117-dashboard-v1.jsx` | BMS job dashboard — data layer being swapped Sheet→Supabase (Phase 3) |
| `api/jobs.js` | GET /api/jobs — reads jobs from Supabase, joins each job's `client` record |
| `api/jobs/update.js` | POST — `saveJob()` writes job edits; stamps a `job_phase_events` row on phase change |
| `api/clients.js` | GET list + **POST (update/create)** — client records; powers the Details-tab picker + the editable client-contact card |
| `api/payments.js` | Payment records per job (Phase 4); webhook dedups on `qbo_invoice_id` |
| `api/payments/webhook.js` | Inbound: Zapier POSTs here when a QBO invoice is paid → inserts a `payments` row (matched by Job ID = QBO Customer Display Name); shared-secret + idempotent |
| `api/_lib/qbo.js` | QBO API client: OAuth refresh + token rotation (`qbo_tokens`), find/create customer, `renameCustomer`, create/send invoice, `intuit_tid` capture |
| `api/_lib/qbo-oauth.js` | OAuth2 connect/reconnect helper — signed-state CSRF, authorize URL, code→token exchange |
| `api/qbo/connect.js` / `callback.js` | Mint/refresh the seed refresh token (the reconnect path); connect is localhost-open, prod-gated by `QBO_CONNECT_KEY` |
| `api/qbo/create-customer.js` / `create-invoice.js` | Outbound: find-or-create the job's QBO customer / create (+ optionally email) an invoice, mirrored to `invoices` |
| `api/qbo/status.js` | `{configured,env,realm}` (no secrets) — the UI flag-gates the "Send to QuickBooks" panel on it |
| `api/jobs/next-number.js` | GET `?yy=26` — job numbers already used in **Google Drive** for a year, so the New Job builder recommends `max(app DB, Drive) + 1` (jobs are filed in Drive too until the app fully takes over, so the DB alone lags). Staff-gated, read-only; folder scan via `listJobNumbersForYear` in `google-drive.js`. Frontend combines via `nextJobNumberAcross` (`src/lib/job-id.js`) |
| `api/jobs/rename.js` | **"Correct Job ID"** — renames a job across App (cascade) + QBO customer + Drive folder together, with dry-run preview + rollback |
| **Drive → app sync** (2026-07-14) | The firm works BOTH ways round: often the Drive folder exists weeks before anything reaches the app. `api/_lib/drive-sync.js` (pure: `parseFolderName` + `buildQueue`) · `api/drive/new-folders.js` (GET the queue, 60s cache) · `api/drive/import.js` (POST: create the job/lead, or dismiss the folder) · `src/components/bms/DriveInbox.jsx` (the **"New in Drive"** strip on the board; renders nothing when empty). Drive already speaks the app's language by accident: `26_XXX_Onorato` IS the app's lead placeholder, `26_044_Seesman` is a numbered job. See the invariants below |
| `src/components/job-editor/QboInvoicePanel.jsx` | "Send to QuickBooks" invoice UI (in PaymentsTab; shown only when QBO configured). Shows the job's app-generated proposal fee schedule (via `/api/proposals?job_id=`) as a **contract reference** with one-click "Use" → invoice line |
| `api/jobs/proposal-docs.js` | GET — a job's **signed proposal(s)** from its Drive "Proposal" folder: `?jobId=` lists files; `?jobId=&fileId=` streams a chosen PDF through the app (staff-gated; fileId validated to live in that folder). The contract of record for **existing** jobs (whose proposals are Drive PDFs, not in the `proposals` table) |
| `src/components/job-editor/ProposalDocs.jsx` | **Signed-proposal viewer** in the PaymentsTab — lists proposals + inline iframe viewer (blob fetch carries auth) + "Open full screen"; renders nothing when none on file |
| `src/components/job-editor/CorrectJobIdModal.jsx` | Preview→retype-confirm UI for the 3-system rename (the `✎ ID` button in JobEditor) |
| `api/qbo/financials.js` | GET — **Financial tab** data (staff-gated, read-only): open-invoice A/R + P&L (selected period) + quarter-summarized P&L (6 quarters) + top invoices; reads isolated via `Promise.allSettled`; **`?basis=sent\|cash\|accrual`** (default `sent`), `?ar=recent\|all`, `?start=&end=`, `?fresh=1` (bypass cache). `sent` fetches the invoice book and overlays invoices-sent income (by **best-effort sent date**, see `invoiceSentDate`) on the accrual report's expenses; every quarter is shown (no hiding). **90s in-memory TTL cache** (`_cache`, per warm instance, keyed by basis/period/AR; only clean results cached) so repeat loads skip the ~5 live QBO calls |
| `api/_lib/qbo-reports.js` | Pure QBO report/query → normalized-shape transforms (no db/network): `summarizeReceivables` (aging buckets + `minJobYear` filter via `jobIdYear`), `parseProfitAndLoss`, `parseProfitAndLossColumns` (per-quarter), `toTopInvoices`, **`invoiceSendDate`** (raw QBO email send date) + **`invoiceSentDate`** (best-effort: email send date, else invoice date when the invoice is paid or predates `QBO_EMAIL_ERA_START` = `2025-10-01`; a recent un-emailed unpaid invoice = an upfront phase not yet sent → excluded) + **`sumSentInPeriod`** (invoices *sent* in a period, with billed/paid/open split) + **`buildSentQuarters`** (per-quarter billed **and** collected for the double-bar chart) + **`listSentInvoices`** (the individual invoices sent in a period, unpaid-first, for the per-quarter list) + **`invoiceDescription`** (what an invoice bills for — line-item service/phase name, else line description, else memo — surfaced as the "Phase / service" column in both the sent-list and A/R tables) |
| `src/components/financial/Financial.jsx` | **Financial tab** UI (`/financial`): P&L on top with a **`Sent \| Paid \| All invoiced` basis toggle** (default **Sent** = invoices billed for completed work = how the firm tracks income). Sent shows 4 tiles (Total billed · Expenses · Unpaid invoices · Net income) + a **"Billed vs collected by quarter" double-bar chart** (billed + collected per quarter; click a quarter to load it) + an **"Invoices sent · [quarter]" list** (`PeriodInvoices` — every invoice sent that quarter, grouped Unpaid then Paid, columns Job · Phase/service · Invoice # · Sent · Billed · Open balance); other bases keep 3 tiles (Income/Expenses/Net) + a single-bar chart + Top invoices. Top expenses stays below. Top invoices + Top expenses, then A/R aging below (sort: Most overdue\|Job ID; scope: 2025+\|All). `.fin-*` styles in `styles.css` |
| `api/phase-events.js` | GET/POST/DELETE — per-job phase-reached timeline (Progress tab) |
| `api/field-notes.js` | GET/POST/PATCH/DELETE — on-site field notes (staff-only; author from Clerk token); GET signs attachment URLs |
| `api/field-notes/upload.js` | POST base64 photo/voice → private `field-notes` Storage bucket; returns the storage path |
| `api/proposals.js` | GET list/`?id`/POST/DELETE — saved proposals (fields-only) in `proposals.content` jsonb |
| `api/letters.js` | GET list/`?id`/POST/DELETE — saved building-dept letters (fields-only) in `letters.content` jsonb |
| `src/lib/note-media.jsx` | Shared field-note media render (photo thumbs + swipeable lightbox, voice players, location link) — used by the mobile sheet + desktop Progress tab |
| `src/components/site-report/SiteReport.jsx` | Per-job printable Field-Notes site report (`/report/:jobId`, chrome-free, print→PDF) |
| **Document generators** (`/templates`) | `src/components/templates/` — `TemplatesHome` (category grid), `LetterGenerator` (`/templates/letter`), `ProposalGenerator` (`/templates/proposal`). Both build an assembled PDF (letter/proposal + image/reference-PDF attachments) shown in an iframe + Download; save/reopen via the proposals/letters APIs. |
| `src/lib/pdf-doc.js` | Shared PDF engine: page geometry, `drawLetterhead` (embeds `src/assets/rm117-logo-black.png`), `embedLogo`, `appendAttachments`, `makeWriter` (cursor/paginator) |
| `src/lib/letter-pdf.js` / `src/lib/proposal-pdf.js` | Document renderers (proposal bakes in the scope/exclusions/binding boilerplate verbatim from samples) |
| `src/lib/doc-format.js` / `src/lib/doc-assets.js` | Pure formatters (`longDateOnly`, `dollarsToWords`, `wrapText`, `parseBodyBlocks`, …) / logo-trim + image→JPEG helpers |
| **Drawing QA** (`/drawing-qa`) | Checkset QA/QC — the standalone "Checksets" app merged into the BMS. UI `src/components/drawing-qa/*`, API `api/checksets/*` + `api/jobs/checkset-files.js`, libs `api/_lib/checksets/*` (incl. canonical **CHECKS.md**). Full detail in the "Drawing QA" section below + `DRAWING_QA.md` |
| **Set Check** (`/set-check`) | **IN BUILD on branch `set-check` — not deployed.** Sibling of Drawing QA: checks what a contractor BOUGHT/SUBMITTED against what we SPECIFIED (windows first — size vs our schedule, U-factor vs our REScheck, and *nothing else*: series/grille/colour/operation are the developer's choice). UI `src/components/set-check/SetCheck.jsx`, API `api/set-check/{runs,files}.js`, pure lib `api/_lib/set-check/doc-roles.js`, tables `set_check_runs` + `set_check_findings` (migration `0017`, applied). Unlike Drawing QA it reads the job's **whole Drive tree** (`listJobFolderTree`), because its three inputs sit in different subfolders. Canonical plan + build phases = **`SET_CHECK.md`**; business docs in `set-check-docs/` |
| **Weekly Planner** (`/delegation`) | Sidebar label "Weekly Planner"; route stays `/delegation`. Digital weekly delegation sheet (replaces Ang's paper grid): Mon–Fri × employee ink grid, one board per week (Monday-keyed). Native Pointer-Events → HTML5 canvas ink (**no tldraw**); strokes stored as normalized-0..1 point arrays. **Plus typed per-cell notes** via a `✏ Pen \| ⌨ Type` toggle (one note per employee×weekday). UI `src/components/delegation/Delegation.jsx`; API `api/delegation.js` (GET/POST/DELETE, staff-gated); tables `delegation_members` + `delegation_strokes` + `delegation_notes`. **Row-level write perms enforced server-side** (own row, or admin=Ang) via `canWrite()`/`canDelete()` (unit-tested `tests/delegation-perms.test.js`) — not RLS. Live sync = 4s polling (no Supabase Realtime). Each row is a light "paper" canvas so ink reads in dark mode. Roster (`delegation_members`, live DB is source of truth): Tom·Ray·Nicole·Ang·Dani. **Shared "Everyone" lane** pinned at the top (reserved `row_owner_email = '__studio__'` sentinel, admin-write only) for firm-wide items (e.g. a measure-up) written once instead of into every row — see SCHEMA.md. **⭐ The `__studio__` sentinel lives in 3 files that must stay in sync: `Delegation.jsx`, `api/delegation.js`, and `src/components/dashboard/MyWeekWidget.jsx`.** The dashboard **"My week" widget** (`MyWeekWidget.jsx`, on Home) surfaces both the signed-in user's own row **and** the shared Everyone lane so a firm-wide item reaches every dashboard without opening the planner. Phase 2 (not built) = faint BMS job-reference chips per row |
| `api/jobs/design-phases.js` | GET `?jobId=` — reads the job's **signed proposal PDF** from Drive and **suggests** `design_phase_count` (how many design phases the client bought). Staff-gated, read-only; **never writes** — the JobEditor pre-fills the dropdown + shows the quoted contract language, staff confirm with Save. Pure logic in `api/_lib/proposal-extract.js` (native PDF `document` block + **structured outputs** JSON schema; `normalize()` is the guard between the model and the 1–3 CHECK constraint). **Accurate on 5/6 real proposals; a safety classifier false-positives on one (`26_033_Guido` → `category: "bio"`) and even the Opus retry declines it — that job is typed by hand.** See PHASE_MODEL.md |
| `api/client-contacts.js` | **Several people per client** — the firm's biggest clients are DEVELOPERS with teams (Tyler Deuel 5 jobs; Gabe DaSilva was already cramming a shared team inbox into the one email field). Contacts hang off the **CLIENT, not the job**, so a developer's PM added once is on all their projects. GET/POST/DELETE, staff-gated. **Deactivates rather than deletes** (their links + the record of what they were told survive) and **revokes their magic links** on removal. `clients.email` is kept in sync as a mirror of the primary contact — older screens still read it |
| `api/_lib/gmail-send.js` | **Sends email AS the signed-in staff member, via their own Gmail** (`gmail.send` scope, token from Clerk — the same Google connection the Inbox widget uses). Chosen over Resend because **rm117.com's DNS is on a Wix account the firm doesn't control**, so verifying a sending domain has been blocked for months — and because a client update from "Ray Arocha" gets opened while `noreply@` gets ignored. Replies land in Ray's inbox; the message appears in his Sent folder |
| `api/_lib/portal-notify.js` | Pure composition of the **client update email** (no network/db, so the wording is unit-tested without sending anything). Deliberately excludes money, sub-phases (Prep/Outgoing, DPI/II/III), Job IDs and phase jargon — a client who reads "your CDs are 90% done" replies "so where's my set?" |
| `api/_lib/portal-session.js` | **Client magic-link auth** (pure crypto, unit-tested): mint/hash link tokens, sign/verify the session cookie, cookie plumbing. Tokens are stored **hashed** (`portal_links.token_hash`) so the DB never holds a working credential; the session cookie is HMAC-signed and HttpOnly |
| `api/_lib/portal-auth.js` | The one place portal authorization lives. **Two identity paths, cookie first:** magic-link session → `clients` row; else Clerk → staff (or a legacy Clerk-linked client). `getClientJob` scopes every job read by `client_id` |
| `api/portal/[action].js` | All portal routes. Client-facing: `me`/`files`/`download`/`messages`/`send`. **Public:** `enter` (the magic-link landing — it *is* the login; redirects so the token leaves the URL) + `signout`. **Staff-only:** `invite` (mint a link), `links`, `revoke`, **`draft`** (compose the client update email and **send NOTHING** — this is what the confirm dialog shows), **`notify`** (actually sends), **`history`** (what a client was told, verbatim). `buildPortalJobs` builds the payload incl. the per-job billing summary. ⚠️ **`draft` must stay side-effect-free** — the magic link is minted only on `notify`, so opening the dialog and closing it leaves nothing behind (an early version minted on preview and revoked the client's working link) |
| `src/components/shell/portal-gate.jsx` | Resolves the magic-link cookie **above** the Clerk gates in the shell — without it a client would land on the staff Google sign-in screen. Staff have no portal cookie, so they skip the probe entirely |
| `src/rm117-portal-v1.jsx` | The client portal. **One project → card switcher** (homeowner); **several → `PortfolioTable`** (developer: every project, stage, next-up, balance on one screen). `BillingStrip` shows contract total / paid / outstanding. The only forward-looking date is the job's **next milestone** — blank if staff haven't set it (the Progress tab now flags that) |
| `scripts/import-sheet.js` | One-time Sheet → Supabase migration (Phase 2) |
| `scripts/link-jobs-to-clients.js` | Link unlinked jobs to existing clients (dry-run default) |
| `scripts/create-clients-for-unlinked.js` | Create clients for unlinked jobs w/ real names (dry-run default) |
| `.env` | Supabase, Resend, DocuSign, QBO, Google creds |

All `api/` routes must also be registered in `server.js` (the local-dev Express wrapper); on Vercel
each `api/` file deploys directly as a function.

## Environment
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY` (or `POSTMARK_*`), `DOCUSIGN_*`,
`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REALM_ID` (`193514517070094`), `QBO_CONNECT_KEY`
(gates the prod `/api/qbo/connect` reconnect route), `WEBHOOK_SECRET` (inbound Zapier),
`COMPANY_CALENDAR_ID`, plus existing `SHEET_ID` + Google service-account creds (for the import +
Drive broker). `QBO_REFRESH_TOKEN` is optional locally — the rotating token lives in the shared
`qbo_tokens` table (read DB-first, env seed as fallback).
- **`ANTHROPIC_API_KEY`** (+ optional `ANTHROPIC_MODEL`, default `claude-sonnet-5`) — Drawing QA
  vision analysis. On Vercel for Production + Preview(`drawing-qa-merge`); in local `.env`.
- **Use a personal Gmail for Google Cloud** — the rm117.com org's
  `iam.disableServiceAccountKeyCreation` blocks service-account key downloads.

## Data model
Full schema in **SCHEMA.md**. Core tables: `jobs`, `payments`, `invoices`, `proposals`, `letters`,
`templates`, `forefront_commissions`, `staff`, `job_phase_events`, `field_notes`, `qbo_tokens`
(migration `0006`: singleton rotating QBO refresh token). Client tier
(Phase 7): `clients`, `threads`, `messages`, `file_records`, `notifications`.
- **`jobs(job_id)` FKs use `ON UPDATE CASCADE`** (migration `0007`) so a Job ID rename moves all child
  rows atomically — this is what makes `api/jobs/rename.js` (the "Correct Job ID" tool) safe.
- **`proposals` / `letters`** = saved document drafts (fields-only): the generator's form state in a
  `content` jsonb, `job_id` nullable (a proposal can precede its job). No files/PDFs stored — the PDF
  regenerates on reopen and attachments are re-added. (The *delivered* PDF → Drive "Files Sent" is a
  planned next step. **Drive write access is now unblocked** — the service account got **Content
  manager** on the Shared Drive 2026-07-04 for the Drawing QA export, the same gate this delivery needs.)
- **`field_notes`** = on-site notes (the mobile feature); photo/voice files live in the private
  `field-notes` Supabase **Storage** bucket (backend signs short-lived URLs on read).
- **`jobs.board_position`** = manual within-phase ordering for the BMS drag-to-reorder board.
- **Frontend DnD** uses `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (BMS grouped view).
- **`jobs`** keyed by Job ID (`YY_NNN_[FF_]LastName`). `client_id` = who's billed;
  `referred_by_id` = who referred the work in (nullable; inbound referrals only — no outbound).
  `next_milestone_label` + `next_milestone_date` = the one upcoming "date to follow".
- **`outstanding` is computed**, never stored: `job_total - sum(payments.amount)`.
- **`job_phase_events`** = append-only log of when each job reached a phase (powers the Progress
  timeline). Auto-stamped on phase change; editable per phase via `POST /api/phase-events`.
- `import_notes` / `import_needs_review` flag rows the Phase 2 import couldn't parse cleanly.
- **Drawing QA tables** (shared project): `drawing_sets` (one row per job+Drive-file review;
  `job_number`=Job ID, `drive_file_id`), `checklist_results` (per sheet: results + `sheet_type`,
  `applicable_ids`, `reviewed_ids`, `overrides`, `advisory`, `sheet_index`), `markup` (tldraw shapes
  per (set,page) in NORMALIZED 0–1 coords). Private `drawings` Storage bucket (legacy upload path).

## Progress Timeline (internal — chosen over the client portal)
Ray opted to hold the external client portal (login-management overhead) and instead surface job
progress to staff: the JobEditor **Progress tab** shows a phase ladder (reached dates, editable) +
a "Next milestone" date; the dashboard shows a **"Coming up"** strip. Portal tables still exist for
a future revisit.
> **Clarified (2026-06-17):** the portal will **not** affect staff use. Clients log in via Clerk
> by email only and never touch the Google OAuth app, so they can't consume the 100 test-user cap.
> The remaining reason to defer is onboarding/login-management effort, not any staff-side limit.

## Job phases + sub-phases (rebuilt 2026-07-13 to Angelena's workflow — see `PHASE_MODEL.md`)

**Lifecycle:** Lead → Proposal Sent → Survey/Zoning → Design → CD → Permitting → Construction →
Completed. Off-ladder: **Job Dropped** (proposal rejected, work never began), **Canceled** (a
*signed* job terminated early — retainer earned; these two are deliberately DIFFERENT), **On Hold**
(paused, will resume). `phase_override` wins when set.

Stored key → **BMS label** (`PHASE_LABELS`, `src/lib/format.js`). Labels deliberately differ from
keys — don't "fix" one to match the other:
`lead` → **Lead** · `potential` → **Proposal Sent** · `survey_zoning` → **Survey + Zoning Analysis
+ Schematics** · `design_phase` → **Design Phase** · `cd_prep` → **CD — Prep** · `cd_outgoing` →
**CD — Outgoing** · `permitting` → **Permitting** · `construction` → **Construction** · `on_hold` → **On Hold** · `completed` →
**Completed** · `job_dropped` → **Job Dropped** · `canceled` → **Canceled**

⚠️ **`active` and `cd_phase` no longer exist.** `active` was never a phase (it was CD's wrap-up
stage) — migration `0011` folded it in. Then Angelena reviewed and asked for the CD stage to be two
board sections she drags between, so migration `0012` **split `cd_phase` into `cd_prep` +
`cd_outgoing`**. Both migrations remapped the live jobs.

**SUB-PHASES** (`sub_phase` column) — **only Design has them**:
- `design_phase` → `dp1`/`dp2`/`dp3` (**DPI/DPII/DPIII**). How many a job has is set by its
  proposal → `jobs.design_phase_count` (1–3). They vary per job, which is exactly why they can't be
  fixed board sections the way CD's two piles can.

**The internal CD split is a STAFF tool — clients never see it.** The portal's ladder
(`src/rm117-portal-v1.jsx`) shows plain-English steps only (Proposal · Survey/Zoning · Design ·
Construction Drawings · Permitting · Construction · Complete), and a ladder step may cover SEVERAL
stored phases — `cd_prep` + `cd_outgoing` both render as one "Construction Drawings" step. Telling a
client their CDs are "90% done" only invites "so where's my set?". Same for the Design sub-phases.

**BOARD TABS** (`BOARD_TABS`) — the BMS board is the **Pipeline**; leads and construction are
separate tabs so they don't clutter live design work:
**Job Leads** (lead · potential · job_dropped) · **Pipeline** (cd_outgoing · cd_prep · design_phase ·
survey_zoning · on_hold) · **In-Construction** (permitting · construction · completed · canceled).
**The Pipeline ENDS with the CD stage** (Ang) — once drawings go out the door it's permitting /
construction work, which lives in its own tab.

**AGING FLAGS** (`PHASE_AGE_LIMITS`, measured from `jobs.phase_since`): a proposal sitting >**14
days**, and >**21 days** in *either* CD phase, flag on the job card, with a stalled count on the board. A flag only —
never an email (Ray's call: an automatic client-facing email on a phase change is unrecallable).

⭐ **The phase set lives in 4 places that must stay in sync:** `PHASES` + `SUB_PHASES` (`api/_lib/db.js`),
`PHASE_*` / `SUB_PHASE*` / `BOARD_TABS` (`src/lib/format.js`), the `jobs.phase` / `jobs.sub_phase` /
`field_notes.phase` CHECK constraints (migrations `0011_phase_model.sql` + `0012_cd_split_phases.sql`), and the portal's own
client-facing `LADDER`. `tests/phase-model.test.js` asserts the first three agree.

## Integrations
- **QuickBooks two-way sync — LIVE (2026-06-30).** Connected to the real company
  `Room 117 Architecture & Design LLC` (**Realm `193514517070094`**). **Outbound:** the app creates
  QBO customers + invoices via API (`api/qbo/create-invoice`, "Send to QuickBooks" UI); `qbo_invoice_id`
  links back. **Inbound:** when a QBO invoice is paid, a **Zapier** zap POSTs `api/payments/webhook` →
  inserts a `payments` row, matched by Job ID = QBO **Customer Display Name**. Both directions depend on
  that name invariant — keep it via the new-job builder + the "Correct Job ID" tool.
  - **Financial tab (read-only, LIVE 2026-07-01):** the app surfaces QBO without touching the ledger — A/R aging
    (from open invoices), P&L, and a quarter-over-quarter comparison (`summarize_column_by=Quarter`) via the QBO
    Reports/Query API (`api/qbo/financials.js` → pure parsers in `api/_lib/qbo-reports.js`). A/R defaults to a
    "2025 & newer" view because pre-2025 QBO invoices are still being cleaned up (Job-ID-year filter, never a
    delete; "All" shows everything). Reads QBO live on each load (no caching yet).
  - **Income basis (2026-07-01 eve): the P&L defaults to "Sent" — invoices *billed for completed work*, which is
    how the firm actually tracks income** (Angelena's method). Distinct from QBO's accrual (every invoice created,
    incl. drafts) and cash (paid).
  - **Sent = best-effort sent date (revised 2026-07-09, Ang's Financial feedback).** QBO only records a send date
    when *it* emails the invoice (`DeliveryInfo.DeliveryTime`), and email adoption is noisy/partial (~0% before Oct
    2025, still only ~50% recently — no clean cutover; probed live). So `invoiceSentDate` combines the hard signal
    with proxies: emailed → real send date; else paid (definitely delivered) or pre-`QBO_EMAIL_ERA_START` (2025-10-01,
    sent by hand back then) → invoice date; else a recent un-emailed **unpaid** invoice = an upfront fee-schedule
    phase not yet sent → excluded. This (a) restores historical quarters that used to be hidden (2025-Q3 shows its
    real ~$115K, not $0), and (b) closes most of the Q2-2026 gap: app now $101K vs Ang's manual ~$106K (was $92.8K
    emailed-only; accrual $188K, cash $77K). **Residual ~$5K = invoices sent by hand but still unpaid — invisible to
    QBO.** Exact reconciliation needs sends recorded in-app ("mark as sent" — deferred; Ray chose best-effort only).
    Ang's workflow: create every fee-schedule phase up front in QBO, then send each as its phase completes.
  - **Creds note:** runs on Intuit's *dashboard-labeled "Development"* keys (`ABYas…`) — for a private,
    single-company app these legitimately connect to the **production** company. The "Production"-labeled
    keys (`AB6whTti…`) are only for marketplace publishing; not used. Refresh token lives in the shared
    `qbo_tokens` row (rotates); `.env` + Vercel hold `QBO_CLIENT_ID/SECRET/REALM_ID` + `QBO_CONNECT_KEY`.
  - **✅ DONE (2026-07-05):** rotated the `95YW…` Development secret (was shown in a screenshot) → new `BS20…`; updated `.env` + Vercel Production + redeployed + verified a live token refresh. (Vercel *Preview* still needs the new value added via the dashboard.)
- **DocuSign:** proposals sent for e-signature; status tracked in `proposals`.
- **Email bridge:** outbound notify on new portal message; inbound parse appends client replies
  to the thread (validate Resend inbound parsing before Phase 7).
- **Calendar:** dashboard reads the user's Google Calendar + shared `COMPANY_CALENDAR_ID`; Ang
  adds the company calendar to Apple Calendar for native two-way sync.

## Drawing QA (checkset review — the merged Checksets app)
Staff tab `/drawing-qa` for QA/QC of permit drawing sets. **This is the former standalone "Checksets"
app folded into the BMS (Phases A–C, LIVE in production 2026-07-04).** Flow: pick a **job** → pick a
**checkset PDF** from that job's Drive **Checksets** folder → view the sheet in a **zoomable/pannable
viewer** → **analyze** each sheet against the firm checklist (Anthropic vision, structured output,
type-scoped) with per-item verdicts + human overrides, check-offs, a set overview, "Analyze all" batch,
and a mis-typed escape hatch.

- **⚠️ tldraw markup was REMOVED (2026-07-04).** tldraw SDK 4.0+ requires a **paid production license**
  ($6k/yr; no cheap tier) — without a key it tears its canvas down ~5s after mount on any non-localhost
  HTTPS domain (the "sheet flashes away" bug; invisible in localhost dev, only bit us in production).
  Ray's call: drop markup and keep Drawing QA as a **pure AI-review tool**. The sheet is now shown via
  `PageViewer` (`react-zoom-pan-pinch`, MIT). The old markup **save/load + flatten-to-Drive export** flow
  is gone. The dead `markup`/`export` server APIs were **removed in the 2026-07-07 cleanup**; only the
  unused `markup` **table** remains (left in place, harmless) so drawing could be re-added later on a free
  lib (e.g. `perfect-freehand`, MIT) if wanted.

- **Where to develop = HERE, this repo.** The standalone `~/Desktop/Checksets App/files` is **FROZEN**
  (its own deploy is dead-ended); its `MERGE_PLAN.md` / `PROGRESS.md` / `NEXT_SESSION.md` are historical
  reference for *why* the engine works, not where work happens.
- **Frontend** `src/components/drawing-qa/*.jsx`: `DrawingQA` (job+file pickers), `ReviewClient` (review
  screen), `PageViewer` (zoom/pan sheet viewer, `react-zoom-pan-pinch`), `ChecklistSidebar`,
  `SetOverview`, `BatchAnalyzeButton`; helper `pdf.js`; `tailwind.css` is **utilities-only (no
  preflight)** so it doesn't touch the rest of the BMS. Route/nav in `src/rm117-app-shell-v1.jsx`
  (`/drawing-qa`, lazy). Job picker is a type-to-search combobox (`JobPicker`, `.dqa-combo*`).
  (Removed with tldraw: `MarkupOverlay`, `MarkupExporter`, `markup.js`.)
- **UI theming:** the review chrome follows the app theme via a scoped **`.dqa-review`** layer in
  `styles.css` (the overlay wrapper carries that class). Because the Tailwind is preflight-less, that
  layer **resets bare `<button>`/`<input>`** (else they show UA light control backgrounds — foreign in
  dark themes) and **remaps the ported Tailwind color utilities to the app CSS variables** (accent for
  primary actions; semantic green/amber/red for verdicts); canvas loading state =
  `.dqa-loading`/`.dqa-spinner`. When editing Drawing QA UI, prefer these theme vars over hard-coded
  Tailwind colors.
- **API** `api/checksets/*.js`: `sets` (find-or-create per job+Drive file), `analyze`, `results`
  (GET + PATCH verdicts/overrides/check-offs), `overview`. Plus `api/jobs/checkset-files.js` (list/stream
  a job's Checksets PDFs — now also attaches each set's review status for the file-list badge; clones
  `proposal-docs.js`). All also registered in `server.js`.
- **Server libs** `api/_lib/checksets/`: `checklist.js` (parses CHECKS.md → prompt/enum), `naming.js`
  (sheet-number convention → mislabel detection), `anthropic.js`. Reuse `getDb()` + `requireStaff()` +
  `api/_lib/google-drive.js` (`resolveChecksetsFolderId`, `downloadFileBytes`, `uploadToFolder`).
- **⭐ `api/_lib/checksets/CHECKS.md` is the CANONICAL 90-item checklist** (source of truth; keep item
  ids stable; carries each item's `applies to` sheet types). Read at runtime via `import.meta.url`
  (`@vercel/nft` bundles it — verified). Edit THIS copy; the standalone repo's CHECKS.md is a stale fork.
- **Model:** `ANTHROPIC_MODEL` (default `claude-sonnet-5`). **Keep adaptive thinking ON** — disabling it
  hurt vision recall; the analyze speed comes from **type-scoping the checklist**, not from cutting thinking.
- **If markup is ever revived:** the removed export re-inflated normalized (÷1000) marks and stamped them
  **rotation-aware** so mixed-`/Rotate` sets (e.g. a 270° cover sheet) aligned — worth knowing if drawing
  is rebuilt. A Drive export would need the service account = **Content manager** on the Shared Drive
  (confirmed open — the same gate as letters/proposals delivery). The old code lives in git history.
- **Deps for this feature:** `@anthropic-ai/sdk` (server), `pdfjs-dist` + `react-zoom-pan-pinch`
  (client). `pdf-lib` is present but for the document generators (letters/proposals), not Drawing QA.
  `tldraw` was removed. Handoff detail: **`DRAWING_QA.md`** at repo root.

## Invariants (do not break)
- Job ID `YY_NNN_[FF_]LastName` must match the QuickBooks Customer Display Name exactly.
- **`FF_` and `FE_` are DIFFERENT work types — one letter apart, never interchangeable.**
  `FF_` = **Forefront** (`jobs.is_forefront`; carries a commission — `ff_commission` /
  `ff_commission_paid`). `FE_` = **FIRE ESCAPE** (`jobs.is_fire_escape`, migration `0016`): its own
  kind of work, **not Forefront and not a developer** (Ray, 2026-07-14). The Job ID always encoded
  both, but the app modelled only FF and read FE as an ordinary part of the name. Never collapse
  them and never infer one from the other — a commission landing on a fire-escape job is the failure
  mode. The badges are deliberately different colours (FF gold, FE orange) because the two markers
  look so alike. Board has a **Fire Escape** filter beside **Forefront**.
- **The Drive → app sync NEVER creates a job on its own, and its watermark is not a bug.**
  A folder name carries no phase, no client record and no contract value — and the Job ID is what
  QuickBooks matches on, so a folder auto-promoted to a job is a QBO matching problem later. Every
  import is a staff click, and lands with `client_id` NULL + `import_needs_review` set ("Deuel" names
  five different projects; a wrong client link is worse than none).
  - **`drive_sync.watermark` (1 Jan 2026) is load-bearing.** A full scan finds 255 job folders + 104
    lead folders against 134 app jobs — but that 233-folder gap is almost all HISTORY (the app was
    seeded from Ang's Sheet, which only held live work). Ray's call is to leave it out. Do **not**
    "fix" the sync by lowering the watermark to catch everything; it would bury the board.
  - **Match on the NUMBER (`YY_NNN`), never the folder name.** Drive and the app genuinely disagree
    about names: Drive has `26_002 = 544 Valley`, the app has `26_002 = 542 Valley` (the addresses are
    swapped, and O'Bagel is `24_081` in Drive but `25_085` in the app). Those are Ang's reconciliation
    items — a name-matching sync would silently duplicate the jobs.
  - **A numbered folder's name is never tidied on import.** Job ID === folder name === QBO display
    name, character for character; a folder with stray spaces is FLAGGED for a rename in Drive, not
    imported as a cleaned-up string. Leads are exempt (a placeholder id never reaches QBO or Drive).
- **A lead imported FROM Drive already HAS a folder — promotion must RENAME it, not provision one.**
  `assignOfficialJobId` originally assumed a lead never has a folder ("precisely so we never have to
  rename one"), which is true only for leads created IN THE APP. For an imported one that assumption
  would create `26_047_Onorato` beside the original `26_XXX_Onorato` and orphan every file in it. The
  job remembers its folder in **`jobs.drive_folder_id`** and promotion renames that — which is exactly
  the rename staff do by hand today.
- **EVERY CONTACT GETS THEIR OWN MAGIC LINK** (`portal_links.contact_id`) and **their own email** — never one
  email with the team CC'd. A CC'd link would be a shared credential: when a developer's project manager leaves
  the firm you'd have to revoke the whole team and re-send. Per-person links mean you revoke that one person,
  and you can see who actually opened it.
- **The client portal's magic link IS the credential — there is NO identity check, by design.**
  Whoever opens the link is in; they never type an email or a code. The `clients.email` on file only
  decides *who the link is mailed to*, not who may use it. **Ray's explicit decision (2026-07-13),
  reaffirmed when asked — do not "harden" this into an email/OTP step.** A homeowner won't keep a
  password and a developer won't tolerate one; friction here means the portal simply doesn't get used,
  which defeats its whole purpose (killing "any update?" emails). Same model as a DocuSign or
  airline check-in link. **The real failure mode is a forwarded email, not an attacker** — and the blast
  radius is that ONE client seeing their OWN project (status, documents, balance). Mitigations already in
  place: the token is scoped to a single `client_id`, stored only as a SHA-256 hash, expires in 60 days,
  is revocable, and **each new "Notify client" email revokes the previous link** so a client only ever
  holds one live link.
- **A LEAD has no job number** — it runs as `YY_xxx_LastName` until the proposal is signed, so leads
  that never convert don't burn a number. A placeholder job must **never** reach QuickBooks or Drive
  (both are keyed by the Job ID); the QBO endpoints refuse one with a 409, and no Drive folder is
  provisioned until promotion. Moving a job out of `lead`/`potential`/`job_dropped` IS the signing
  event: `assignOfficialJobId()` (`api/_lib/job-number.js`) picks the next free number (app DB **and**
  Drive), renames the job (children follow via `ON UPDATE CASCADE`), and creates the Drive folder.
- **The client portal shows only three money figures per job — contract total, paid-to-date,
  outstanding — and nothing else.** (This deliberately supersedes the old "the portal is money-free"
  rule, dropped 2026-07-13: clients, especially developers running several jobs, want to know what
  they owe, and a large share of the firm's A/R sits 90+ days out.) Payment rows, Forefront
  commissions, bill flags, QBO invoice ids and every other internal field stay server-side —
  `buildPortalJobs` sums payments on the server and ships only the summary.
- Through Phase 3 the Sheet is a **read-only fallback** — service account is Viewer-only;
  the app reads from Supabase and never writes back to the Sheet.
- Clients never receive Google Drive permissions; the backend brokers every file access.
- A client must never access another client's jobs, files, or messages.
- **Clients authenticate by email only (Clerk magic link / email code) — never via Google.**
  The Google OAuth app (Gmail/Calendar, "Testing" mode, 100 test-user cap) is **staff-only**;
  clients never enter it, so the client portal can never consume a test-user slot or affect staff
  Google access. Do **not** offer "Sign in with Google" on the client portal.
> Superseded first-gen rules: "Sheet is the source of truth," "never write the Outstanding
> column," "never touch the Zapier Lookup tab," "dashboard behavior is frozen." Supabase is now
> truth; Zapier writes to a webhook; the dashboard data layer is intentionally swapped in Phase 3.
