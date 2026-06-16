# RM117 BMS — Next Session Start Here
**Last updated:** 2026-06-15 (Visual refresh + mobile responsive shipped)

---

## ✅ Shipped & live (2026-06-15, latest)

**Visual refresh — "Architectural" direction (desktop + mobile).** Recreated the design handoff
(`~/Desktop/design_handoff_rm117_visual_refresh/`) in the live codebase: warm-paper palette,
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
| JobEditor — edit/save jobs | ⬜ Not started |
| Per-job payment history view | ⬜ Not started |
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

## Next big feature: JobEditor (Phase 3 completion)

After QBO cleanup, the next thing that unblocks Ang for daily use is being able to
**edit jobs and log payments inside the app** instead of just viewing them.

Tasks:
- `api/jobs/update.js` — confirm it saves edits to Supabase correctly
- `api/payments.js` — GET payment history per job
- JobEditor drawer — Payments tab showing history + "Log a payment" button
- Test: Ang edits a job, payment appears, outstanding updates

---

## Vercel / deployment notes

- Project folder: `/Users/raymondarocha/Desktop/RM117-App-handoff copy`
- Vercel project: `rm117-bms` under `rm117-s-projects`
- To deploy: `cd` to project folder, `vercel --prod`
- Folder is linked to Vercel (`.vercel/project.json` now exists)
- Auto-deploys are NOT set up (no git remote) — deploy manually via CLI or push to GitHub
