# RM117 BMS — Next Session Start Here
**Last updated:** 2026-06-16 (full session: JobEditor verified · client-link · payment-safety · Progress Timeline + editable phase dates · data cleanup)

---

## ▶ RESUME HERE — state as of 2026-06-16 (end of session)

App is live at **rm117-bms.vercel.app**, Supabase-backed, all of today's work **committed to `main`
and deployed to prod**. Latest commit: `b8fb41e`.

**Shipped today (all deployed):**
- **JobEditor** verified end-to-end (edit jobs + log payments against live Supabase).
- **Client-link Details tab** — jobs now linked to `clients` via a picker; portal-visible vs internal field tags.
- **Payment safety** — webhook dedups on `qbo_invoice_id`; manual logging is non-QBO-only with QB-vs-outside badges.
- **Progress Timeline** (the internal alternative to a client portal) — per-job phase ladder with
  reached dates + a "Next milestone" date, surfaced in a dashboard **"Coming up"** strip + card badges.
  **Phase dates are editable** (set "when we surveyed" right on the timeline).
- **Data cleanup** — fixed inbox false-positives, removed debug logs, merged duplicate clients, and
  took job→client coverage from **64 → 126 of 134**. Created the **Williams** job (was Riera; client
  renamed) at `26_032_FF_Williams`.

**Pick up here next (prioritized; most need Ray/Ang input, not code):**
1. **~$80K QBO payment imports** — `CLIENT-RECON.md` has the table. MONEY → confirm job mappings.
   Avedissian $22.4K + Rodriguez $11K are high-confidence and ready on your word.
2. **Client-type reclassification** — 88 of 96 clients defaulted to `homeowner`; reclassify
   contractors/investors (needs your knowledge of who's who).
3. **8 on-hold/completed jobs with $0 total** — likely missing contract values to pull from QBO:
   `25_022_Dunn_Bathroom, 23_007_Dunn_Antique Car, 26_025_Dubleski_Holmdel, 25_016_O'Bagel Wayne,
   26_019_Madden, 25_023_Rodrigues, 25_008_O'Bagel_Stirling, 26_010_Melrose`.
4. **8 unlinked jobs** (blank/commercial names) — type the client in via JobEditor:
   `25_016_O'Bagel Wayne, 25_014_Amato, 24_083_ElHassan_Cafe, 25_007_FE_Sebastian,
   25_019_Antunes_175 E Crescent, 25_009_Samsel_Terry Lane, 24_082_LaRose, 25_053_FE_Mendham`.
5. **Williams** is a Forefront job with no commission row yet — set a commission amount so it shows
   in the Forefront tracker.
6. **Stage B — outbound QBO + DocuSign** (the "create/send milestone invoices from the app" goal):
   `QBO_*` env vars are set but unused. Needs a quick word with Ang on the milestone schedule.
7. **Shared RM117 company calendar** — blocked on Ang (she owns the iCloud one); see item A below.
8. **Client Portal** — deferred by Ray (external-login overhead); the Progress Timeline covers the
   core need for now. All Phase-7 tables + `clients.clerk_user_id` exist if/when revisited.

**Today's commits (on `main`):** `e98877f` client-link + payment-safety · `8a21050` Progress Timeline
· `74673c8` cleanup (inbox/logs/linker) · `766d2b6` bulk client creation · `b8fb41e` editable phase dates
· plus doc commits (`f824ede`, `a4e6af9`, `73410e7`, `badf676`).

**New connection points added today** (also in `CLAUDE.md`):
- Endpoints: `GET /api/clients`, `GET/POST/DELETE /api/phase-events`. Routes registered in `server.js`.
- Table: `job_phase_events`; columns `jobs.next_milestone_label` + `jobs.next_milestone_date` (see `SCHEMA.md`).
- Scripts: `scripts/link-jobs-to-clients.js`, `scripts/create-clients-for-unlinked.js` (both dry-run by default).

---

## ✅ Progress Timeline shipped (2026-06-16)

**Internal job-progress tracker — the no-auth alternative to a client portal.** Ray was wary of
managing external client logins, so instead of the portal we built the *root value* (job phase
progress + dates to follow) as a staff-only feature. New `job_phase_events` table (append-only
phase-reached log; auto-stamped on phase change in `api/jobs/update.js`; 133 jobs seeded a
baseline). New `jobs.next_milestone_label` + `next_milestone_date` ("the one date to follow").
New `GET /api/phase-events`. JobEditor gains a **Progress** tab: phase ladder (done/current/
upcoming with reached dates) + editable next-milestone. Dashboard shows a **"Coming up"** strip
(soonest milestones, overdue in red) + a milestone badge on job cards. Verified vs live Supabase
(phase-change stamping is idempotent on no-op; milestone round-trips); build passes. Committed +
deployed prod. **Decided (Ray): hold the full client portal** (Stage B QBO too) — revisit portal
later; Ang to confirm milestone workflow.

---

## ✅ Client-link + payment-safety shipped (2026-06-16, commit `e98877f`, deployed prod)

**1. Client-link Details tab (portal foundation).** Details tab is now backed by the `clients`
record via `jobs.client_id` instead of free-text. New `GET /api/clients` (picker source);
`GET /api/jobs` now joins each job's `client` object; `client_id` added to the update whitelist
(empty string → null = unlink). Details shows a client picker + a read-only contact card
(type/email/phone/company) and tags fields **👁 client** (portal-visible: client, address, phase)
vs **🔒 internal** (notes). `client_name` kept as the per-job display label. Verified: link → join →
unlink round-trip against live Supabase.

**2. Payment safety (QBO double-entry guard).** Webhook (`api/payments/webhook.js`) now dedups on
`qbo_invoice_id` — Zapier retries/double-fires return `duplicate:true`, no second row (verified).
Manual "Log payment" form drops the `qb` method (QBO syncs automatically) and shows a note; the
Payments list badges each payment **QuickBooks** vs the outside method. `qbo_invoice_id` shown as
`INV …`.

**Architecture decision (Ray, 2026-06-16):** QuickBooks stays the system of record for invoices/AR;
the app is a control surface; `qbo_invoice_id` is the idempotency key. Do payments in two stages —
**Stage A = above (non-QBO logging + dedup), done.** **Stage B (next milestone) = outbound QBO:**
build the QBO API client (`QBO_*` env vars set, unused) so the app can create/send milestone invoices
to QBO (Ang's "create invoice, send when phase met" flow) + optionally record payments to QBO, with
DocuSign proposals feeding the milestone schedule. Stage B may need a quick word with Ang on the
milestone schedule. Bonus: app-driven invoice creation fixes the AR-inflation problem.

---

## ✅ Shipped & live (2026-06-15, latest)

**Visual refresh — "Architectural" direction (desktop + mobile).** Recreated the design handoff
(`design/visual-refresh-2026-06/`) in the live codebase: warm-paper palette,
JetBrains Mono for all data, title-block stat strip, grouped/brass sidebar, eyebrow+greeting headers,
recolored phase bars, refreshed editor drawer. **Functionality unchanged.** Then made it responsive:
sidebar hidden on phones, slim dark top bar (keeps Clerk `UserButton` → sign-out / Connect Google),
bottom tab bar (Home/Jobs/Forefront), 2×2 stats, single-column cards. Fixed a CSS Grid overflow with
`minmax(0,1fr)`; verified at true 390px via CDP emulation (NO OVERFLOW) and on Ray's phone. Touched
`index.html`, `src/styles.css`, `rm117-app-shell-v1.jsx`, `rm117-dashboard-v1.jsx`,
`rm117-forefront-v1.jsx`. Commits `8d0ef17` (desktop) + `fab22e4` (mobile) on `main`; deployed prod.
**Known issue:** inbox surname-fallback tags some non-clients as clients (e.g. "ClickUp Team") — see
`_lib/client-match.js`; low-priority cleanup logged in CHECKLIST.

---

## ✅ Shipped & live (earlier 2026-06-15)

**1. Priority Inbox (Gmail) — WORKING.** Per-user read-only Gmail, filtered to client senders.
The long OAuth fight's root cause was tiny: **Clerk's Google custom-credentials Scopes field had the
bare string `gmail.readonly` instead of the full URL** `https://www.googleapis.com/auth/gmail.readonly`
→ Google `Error 400: invalid_scope`. Google Cloud was fine all along. Correct project = **rm117-bms**
(`starry-tracker-498023-i0`, # `358622628253`) on Ray's **personal** Google acct; OAuth app in Testing,
Ray+Ang test users (do NOT publish — restricted scope). Connect the **work** email (raymond@rm117.com)
in the app. `api/inbox.js`, `_lib/clerk.js`, `_lib/client-match.js` + dashboard widget all live.

**2. Client backbone — built from QuickBooks.** `clients` table went 0 → **64 clients** (46 w/ email),
**64/133 jobs linked** via `jobs.client_id`. Source: QBO "Customer Contact List" CSV →
`scripts/import-clients.js` (idempotent; dedupes by email; one client per email across multiple jobs).
Clients typed: 2 contractor, 8 investor (incl. Monita Sun), rest homeowner. `client-match.js` upgraded
to **email-first + surname fallback** (killed the newsletter false-positives).

**3. Google Calendar widget — live (personal).** `api/calendar.js` + `CalendarWidget` read the user's
primary Google cal + `COMPANY_CALENDAR_ID`. Added `calendar.readonly` to Google consent screen + Clerk
(full URL), enabled Google Calendar API in rm117-bms. Ray's personal cal renders.

---

## 🔵 Open items (pick up here)

**A. Shared RM117 calendar — needs Ang.** The team calendar is Ang's **iCloud** calendar (Ray invited,
not owner); the app reads Google only. Plan: Ang creates a **Google** calendar for RM117 → shares with
all staff → everyone adds it to Apple Calendar (add Google acct) for two-way sync → she sends the
Calendar ID → set `COMPANY_CALENDAR_ID` in `.env` + Vercel → redeploy. Blocked on Ang availability.

**B. Client reconciliation — `CLIENT-RECON.md`.** 12 QBO customers couldn't auto-link (job-number
conflicts + legacy names, incl. `26_FF_032_Riera` still missing from Supabase entirely). Fix names in
QBO/Supabase, then re-run `node scripts/import-clients.js`. Overlaps the QBO name-mismatch list below.

**C. QBO reconciliation — waiting on Ang.** Full recon done; see `scripts/recon/`. Ang's workflow
(create milestone invoices upfront, send when phase met) explains the inflated AR. QBO A/R $377.5K =
$115.5K Opening-Balance artifacts + ~$262K mostly unbilled backlog. Blocked on Ang: (a) are the 44
Opening Balances real? (b) rename QBO customers to Job-ID format / use Estimates. Forward
`scripts/recon/RECON-SUMMARY-for-Ang.md`. **Did NOT change app data.**

**D. Cleanup chores.** (i) Merge duplicate no-email client rows (Gabe DaSilva ×2, Josh Russo ×2).
(ii) Remove the diagnostic `console.log`s in `api/_lib/clerk.js` + `api/inbox.js`. (iii) **Inbox
false-positives:** surname-only fallback in `_lib/client-match.js` tags automated/SaaS senders as
clients (e.g. **"ClickUp Team"**) — skip no-reply/team addresses + known SaaS domains, require an
email-domain match before flagging. (iv) ~~Git hygiene~~ ✅ done — repo now matches production
(commits through `fab22e4`); deploys remain working-dir `vercel deploy --prod`, NOT git push.

**E. (Optional, discussed) Redesign the app layout in Claude design** before building the Client Portal,
so the portal is built on the final shell. Design files staged in `~/Desktop/RM117 App Design/`.

---

## Where we are

The app is live at **rm117-bms.vercel.app** and fully backed by Supabase. Payments are now
accurate — every paid QBO invoice auto-syncs via Zapier, and the full payment history has been
imported. Job totals match QBO invoice data.

| What | Status |
|------|--------|
| Supabase schema + 133 jobs imported | ✅ Done |
| Vercel deployment (rm117-bms.vercel.app) | ✅ Done |
| Clerk auth (Ray + Ang invited) | ✅ Done |
| Forefront commissions view | ✅ Done |
| QBO Zapier webhook (future payments) | ✅ Live |
| Historical QBO payments imported (131) | ✅ Done |
| Job totals corrected from QBO (77 jobs) | ✅ Done |
| Priority Inbox (Gmail, per-user) | ✅ Live (2026-06-15) |
| Client backbone from QBO (64 clients, typed) | ✅ Done (2026-06-15) |
| Google Calendar widget (personal) | ✅ Live (2026-06-15) |
| Visual refresh — Architectural (desktop) | ✅ Live (2026-06-15) |
| Mobile responsive (sidebar→tab bar, 2×2 stats) | ✅ Live (2026-06-15) |
| Shared RM117 company calendar | ⬜ Needs Ang |
| JobEditor — edit/save jobs | ✅ Verified vs live Supabase (2026-06-16) |
| Per-job payment history + log payment | ✅ Verified vs live Supabase (2026-06-16) |
| DocuSign proposals | ⬜ Not started |
| Client Portal | ⬜ Not started (backbone ready) |

---

## Immediate QBO cleanup (start here next session)

### 1. Add missing job — `26_FF_032_Riera`
Exists in QBO (retainer $800 paid 2026-06-11) but not in Supabase. Need to create the job
and add the payment. Invoice total in QBO: $5,000 ($800 retainer + $1,400 DP1 + $1,400 DP2
+ $1,400 CDs). Payment already received: $800 retainer.

### 2. Resolve QBO/Supabase name mismatches
These customers have payments in QBO that weren't imported because the job ID in QBO doesn't
exactly match Supabase. **Ray needs to confirm the correct Supabase job_id for each before
we auto-map them.** Payments to insert after confirmation:

| QBO Customer Name | Likely Supabase job_id | Payments to add |
|---|---|---|
| `25_052_FE_Mendham` | `25_053_FE_Mendham` (?) | $1,800 + $1,500 |
| `25_054_Malanga_Subdivide` | `25_053_Malanga_Subdivide` (?) | $1,200 |
| `26_025_Samsel_510 Harrison Place` | `26_022_Samsel_510 Harrison. Place` (?) | $4,000 |
| `Mickael Avedissian` | `25_031_FF_Avedissian` (?) | $4,800 + $1,200 + $7,600 + $8,800 |
| `Jay Rodriguez` | `25_028_Rodriguez_1 Noe` (?) | $1,200 + $9,800 |
| `Nimchy Regis` | `25_024_FF_Regis` (?) | $3,400×2 + $1,400×2 |
| `Nandini Ramesh` | `25_030_Ramesh` (?) | $1,000 + $1,000 + $2,500 |
| `Nosker_Interiors` | unknown | $2,750 |
| `Luis Correia` | unknown | $5,200 + $5,800 |
| `Mike Costello` | unknown | $1,200 + $9,300 |

### 3. Review outstanding on completed jobs — RECONCILED 2026-06-15
Built a full QBO↔Supabase reconciliation. See `scripts/recon/` (run `build-recon.py`, output
`recon-report.csv`, and `RECON-SUMMARY-for-Ang.md` to forward to Ang). Key findings:
- **Ang's workflow explains it:** she creates all milestone invoices in QBO at proposal time,
  sends each only when that contract phase is met. Created-but-unsent invoices post to AR and
  age into "overdue" — so QBO's $377.5K A/R is mostly *unbilled backlog*, not collections.
- QBO total A/R **$377,500**; of that **$115,500 is 44 "Opening Balance" invoices** (book-setup
  artifacts — Ang must confirm if real or write off). Outstanding ex-OB: **$262,000**.
- Completed-phase QBO outstanding **$105,350**, of which **$52,950 is Opening Balance**.
- **Blocked on Ang:** (a) are Opening Balances real? (b) rename QBO customers to Job-ID format,
  or switch to Estimates-for-contract / Invoices-when-billable to stop inflating AR.

### 3b. Payments in QBO missing from app (name mismatches) — confirm mapping then import
Avedissian $22,400, 24_030_Antunes $15,000, Regis $9,600, Ramesh $4,500, Sztyk/Feniak ~$4-5K.
Job-number collisions to resolve: 26_025 (Samsel vs Dubleski), 25_054 (Malanga vs McCalla),
25_052 (Mendham vs DaSilva). Full list in recon-report.csv (`paid_delta(qbo-app)` column).

---

## Scripts available (in `scripts/`)

| Script | What it does | How to re-run safely |
|---|---|---|
| `import-payments.js` | Imports QBO payments from CSV | `node scripts/import-payments.js --dry-run` first |
| `sync-job-totals.js` | Updates job_total from QBO invoice data | `node scripts/sync-job-totals.js --dry-run` first |
| `import-sheet.js` | One-time Google Sheet → Supabase import | Already run — don't re-run |
| `update-billing.js` | Updates job_total from Sheet billing tabs | Superseded by sync-job-totals.js |

To re-run payment import with a new QBO export: drop new CSV in Downloads, update `CSV_PATH`
in the script, run with `--dry-run` first.

---

## Key env vars (all set in `.env` and Vercel)

| Var | Value / Location |
|---|---|
| `WEBHOOK_SECRET` | `rm117-qbo-webhook-2026` |
| `SUPABASE_URL` | `https://mgyebrgdjkxojawmfeyx.supabase.co` |
| `VITE_CLERK_PUBLISHABLE_KEY` | in `.env` |
| `CLERK_SECRET_KEY` | in `.env` |

---

## JobEditor (Phase 3/4) — ✅ DONE & VERIFIED (2026-06-16)

The JobEditor was already fully built (Details edit/save + Payments history + log-payment)
and is now **verified end-to-end against live Supabase production**:
- `api/jobs/update.js` — saves whitelisted edits; rejects invalid phase (400). ✅ persists.
- `api/payments.js` — GET history per job ✅; POST validates method/type/amount/date,
  rejects bad input (400) ✅; real insert persists and appears in GET ✅.
- JobEditor drawer (`rm117-dashboard-v1.jsx`): Details tab → `saveJob` (optimistic + rollback);
  Payments tab → loads history, "Log payment" form; `onPaymentLogged` → `loadJobs()` refresh.
- `outstanding` recomputes correctly after a payment (verified, test row cleaned up).

Verification used a marked `$0.01` test payment on `25_001_Sztyk`, deleted afterward via
Supabase — production data untouched.

**Optional follow-ups (not blocking):** expose `amount_billed` in the Details tab; add a
delete/void-payment action (no endpoint yet — corrections require direct Supabase); browser
click-through with Ang for final UX sign-off.

---

## Vercel / deployment notes

- Project folder: `/Users/raymondarocha/Desktop/RM117 App` (renamed 2026-06-16 from `RM117-App-handoff copy`)
- Vercel project: `rm117-bms` under `rm117-s-projects`
- To deploy: `cd` to project folder, `vercel --prod`
- Folder is linked to Vercel (`.vercel/project.json` now exists)
- Auto-deploys are NOT set up (no git remote) — deploy manually via CLI or push to GitHub
