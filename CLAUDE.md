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
- **Auth:** Clerk (staff today; `client` role in Phase 7). **Clients authenticate by email
  (magic link / email code) — never "Sign in with Google."** Client auth is entirely separate
  from the Google OAuth app, so the portal does **not** touch the Google "test users" (100) cap.
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
| `src/rm117-app-shell-v1.jsx` | App shell: sidebar, dashboard, calendar, inbox, BMS at `/bms`. Mobile bottom tab bar = `MOBILE_TABS` (Home · Jobs · **Financial** · Portal — Forefront is desktop-sidebar-only) |
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
| `api/jobs/rename.js` | **"Correct Job ID"** — renames a job across App (cascade) + QBO customer + Drive folder together, with dry-run preview + rollback |
| `src/components/job-editor/QboInvoicePanel.jsx` | "Send to QuickBooks" invoice UI (in PaymentsTab; shown only when QBO configured). Shows the job's app-generated proposal fee schedule (via `/api/proposals?job_id=`) as a **contract reference** with one-click "Use" → invoice line |
| `api/jobs/proposal-docs.js` | GET — a job's **signed proposal(s)** from its Drive "Proposal" folder: `?jobId=` lists files; `?jobId=&fileId=` streams a chosen PDF through the app (staff-gated; fileId validated to live in that folder). The contract of record for **existing** jobs (whose proposals are Drive PDFs, not in the `proposals` table) |
| `src/components/job-editor/ProposalDocs.jsx` | **Signed-proposal viewer** in the PaymentsTab — lists proposals + inline iframe viewer (blob fetch carries auth) + "Open full screen"; renders nothing when none on file |
| `src/components/job-editor/CorrectJobIdModal.jsx` | Preview→retype-confirm UI for the 3-system rename (the `✎ ID` button in JobEditor) |
| `api/qbo/financials.js` | GET — **Financial tab** data (staff-gated, read-only): open-invoice A/R + P&L (selected period) + quarter-summarized P&L (6 quarters) + top invoices; reads isolated via `Promise.allSettled`; **`?basis=sent\|cash\|accrual`** (default `sent`), `?ar=recent\|all`, `?start=&end=`, `?fresh=1` (bypass cache). `sent` fetches the invoice book and overlays invoices-sent income (by real send date) on the accrual report's expenses; hides historical quarters with <30% send-date coverage (`sentQuartersHidden`). **90s in-memory TTL cache** (`_cache`, per warm instance, keyed by basis/period/AR; only clean results cached) so repeat loads skip the ~5 live QBO calls |
| `api/_lib/qbo-reports.js` | Pure QBO report/query → normalized-shape transforms (no db/network): `summarizeReceivables` (aging buckets + `minJobYear` filter via `jobIdYear`), `parseProfitAndLoss`, `parseProfitAndLossColumns` (per-quarter), `toTopInvoices`, **`invoiceSendDate` + `sumSentInPeriod`** (invoices *sent* in a period by `DeliveryInfo.DeliveryTime`, with billed/paid/open split) |
| `src/components/financial/Financial.jsx` | **Financial tab** UI (`/financial`): P&L on top with a **`Sent \| Paid \| All invoiced` basis toggle** (default **Sent** = invoices billed for completed work = how the firm tracks income). Sent shows 4 tiles (Total billed · Expenses · Unpaid invoices · Net income) + a **"Billed by quarter" revenue chart** (click a quarter to load it); other bases keep 3 tiles (Income/Expenses/Net). Top invoices + Top expenses, then A/R aging below (sort: Most overdue\|Job ID; scope: 2025+\|All). `.fin-*` styles in `styles.css` |
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
| **Weekly Planner** (`/delegation`) | Sidebar label "Weekly Planner"; route stays `/delegation`. Digital weekly delegation sheet (replaces Ang's paper grid): Mon–Fri × employee ink grid, one board per week (Monday-keyed). Native Pointer-Events → HTML5 canvas ink (**no tldraw**); strokes stored as normalized-0..1 point arrays. **Plus typed per-cell notes** via a `✏ Pen \| ⌨ Type` toggle (one note per employee×weekday). UI `src/components/delegation/Delegation.jsx`; API `api/delegation.js` (GET/POST/DELETE, staff-gated); tables `delegation_members` + `delegation_strokes` + `delegation_notes`. **Row-level write perms enforced server-side** (own row, or admin=Ang) via `canWrite()`/`canDelete()` (unit-tested `tests/delegation-perms.test.js`) — not RLS. Live sync = 4s polling (no Supabase Realtime). Each row is a light "paper" canvas so ink reads in dark mode. Roster (`delegation_members`, live DB is source of truth): Tom·Ray·Nicole·Ang·Dani. Phase 2 (not built) = faint BMS job-reference chips per row |
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

## Job phases (single `phase` field, in order — no separate status)
Potential → Survey/Zoning → Design Phase → CD Phase → Active → On Hold → Completed
"Active" = finishing touches before completion. `phase_override` wins when set.

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
    incl. drafts) and cash (paid). "Sent" dates each invoice by its real send timestamp (`DeliveryInfo.DeliveryTime`),
    not TxnDate. **Caveat: the firm only began emailing invoices through QBO in ~late 2025**, so pre-Q4-2025 invoices
    have no send date — the Sent view hides those quarters (they'd read as phantom losses). Q2 2026 sanity check:
    accrual $188K · sent $106K (≈ Angelena's manual $105.8K) · cash $77K.
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
  is gone from the UI; the server `markup`/`export` APIs + `markup` table are **left dormant** (harmless)
  so drawing could be re-added later on a free lib (e.g. `perfect-freehand`, MIT) if wanted.

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
  primary actions; semantic green/amber/red for verdicts). The **tldraw canvas keeps its own surface**
  (excluded via `.tl-container`); canvas loading state = `.dqa-loading`/`.dqa-spinner`. When editing
  Drawing QA UI, prefer these theme vars over hard-coded Tailwind colors.
- **API** `api/checksets/*.js`: `sets` (find-or-create per job+Drive file), `analyze`, `results`
  (GET + PATCH verdicts/overrides/check-offs), `markup` (GET/PUT + `?all=1` bulk), `overview`, `export`
  (flatten→Drive). Plus `api/jobs/checkset-files.js` (list/stream a job's Checksets PDFs; clones
  `proposal-docs.js`). All also registered in `server.js`.
- **Server libs** `api/_lib/checksets/`: `checklist.js` (parses CHECKS.md → prompt/enum), `naming.js`
  (sheet-number convention → mislabel detection), `anthropic.js`. Reuse `getDb()` + `requireStaff()` +
  `api/_lib/google-drive.js` (`resolveChecksetsFolderId`, `downloadFileBytes`, `uploadToFolder`).
- **⭐ `api/_lib/checksets/CHECKS.md` is the CANONICAL 90-item checklist** (source of truth; keep item
  ids stable; carries each item's `applies to` sheet types). Read at runtime via `import.meta.url`
  (`@vercel/nft` bundles it — verified). Edit THIS copy; the standalone repo's CHECKS.md is a stale fork.
- **Model:** `ANTHROPIC_MODEL` (default `claude-sonnet-5`). **Keep adaptive thinking ON** — disabling it
  hurt vision recall; the analyze speed comes from **type-scoping the checklist**, not from cutting thinking.
- **Coordinate rule (dormant export only):** the old markup stored marks in normalized (÷1000) page
  units and the server export re-inflates + stamps them **rotation-aware** so mixed-`/Rotate` sets (e.g.
  a 270° cover sheet) align. This only matters if the markup/export flow is ever revived — the live UI
  no longer draws. Drive export (if revived) needs the service account = **Content manager** on the
  Shared Drive (confirmed open — the same gate as letters/proposals delivery).
- **Deps for this feature:** `@anthropic-ai/sdk` (server), `pdfjs-dist` + `react-zoom-pan-pinch`
  (client), `pdf-lib` (already present; still used by the dormant server export). `tldraw` was removed.
  Handoff detail: **`DRAWING_QA.md`** at repo root.

## Invariants (do not break)
- Job ID `YY_NNN_[FF_]LastName` must match the QuickBooks Customer Display Name exactly.
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
