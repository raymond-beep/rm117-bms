# RM117 BMS — Product Roadmap (Ang + Luci feedback)

_Created 2026-06-23 from Ray's revision notes after talking with Angelena and Luci._
_This is the **product/business** direction. The separate `~/Desktop/User Test Results/RM117-Improvement-Plan.md`
is the **code-hardening** plan from the architect test (Phase 1 security ✅ done; Phases 2–4 = neat & durable)._

**How to use this doc:** pick ONE of the two "Build now" features to start a session. Run the Wix/domain
item down in parallel (it's a phone-call/account-access thing, not code). Website + productization are
their own planning sessions. Productization is a *lens* for how we build everything else — read §3.

---

## 🟢 BUILD NOW — unblocked, high daily value

### A. Proposal template + AI auto-fill  _(recommended first — Ang does proposals constantly)_
**Goal:** a reusable proposal template where the contract boilerplate stays fixed, project-specific
fields auto-fill from the job, and Claude drafts the *variable* scope-of-work / fee sections based on
RM117's project-size patterns.

**Why it's ready:** the `templates` table already exists (0 rows); DocuSign is the eventual e-sign
channel; proposals are meant to feed the milestone schedule (already wired in the data model).

**First steps next session:**
1. **Decide the template model with Ray/Ang (15 min):** which sections are fixed boilerplate vs
   AI-variable; what the project-size tiers are (sq ft? fee bands? project type?); 1–2 real past
   proposals as reference samples for Claude.
2. **Schema:** populate/extend `templates` — `{ id, name, firm_type?, body (with {{merge}} tokens),
   variable_sections config, fee_tiers, created_at }`. Update `SCHEMA.md`.
3. **API:** `api/templates.js` (CRUD) + `api/proposals/generate.js` (input: `job_id` + `template_id`
   → fill merge fields from the job, call Claude for the variable narrative, return a draft).
4. **Claude integration:** Anthropic SDK, latest model. **⚠️ READ the `claude-api` skill BEFORE writing
   the API call** (model ids, params, structured output).
5. **UI:** swap the `/templates` placeholder for a template list + editor; add a "Generate proposal"
   action from a job (JobEditor). v1 output = editable draft; v2 = PDF / DocuSign send.

**Effort:** medium. v1 (table + generate endpoint + basic UI) ≈ 1–2 sessions.
**Build it config-driven** (firm_type, configurable section labels) → serves productization (§3).

### B. Two-way QuickBooks sync  _(app → QBO; fixes Ang's manual-invoicing AR mess)_ ← **DECIDED: do this FIRST next session**
**Goal:** create customers/invoices in QBO *from the app*, not just receive paid-invoice webhooks.

**Why it's ready:** `QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REFRESH_TOKEN / QBO_REALM_ID` are already
in local `.env` (set, unused — the long-planned "Stage B outbound QBO").

**PREP FINDINGS (2026-06-23):**
- All 4 QBO creds present in **local `.env`** incl. `QBO_REALM_ID` (a specific company is targeted).
- **Prod `health` = `qbo:false`** → the QBO vars are NOT in Vercel. Must add them to Vercel prod when wiring.
- **Refresh token likely EXPIRED** (Intuit refresh tokens lapse ~100 days unused; these sat untouched)
  → first task is almost certainly re-auth via the **Intuit OAuth 2.0 playground** to mint a fresh token.
- **Confirm sandbox vs real company** from `QBO_REALM_ID` before any create call.
- **Accelerator:** an **Intuit QuickBooks MCP** is connected to Claude's session (create-invoice/customer,
  search-customer, get-invoices, company-info…). Can't run inside the deployed app, but ideal for
  next-session DISCOVERY — confirm the company + inspect real invoice/customer structure before building.

**First steps next session:**
1. **Confirm the QBO connection:** which company (sandbox vs prod)? Is there a `QBO_REALM_ID`? The
   refresh token was set a while ago and unused — **it may have expired** (QBO refresh tokens roll;
   unused ones lapse ~101 days). If so, re-mint via the QBO OAuth playground first.
2. **Build `api/_lib/qbo.js`:** OAuth2 client — access-token refresh + cache, base request helper.
3. **Endpoints:** `api/qbo/create-customer.js` (DisplayName = Job ID, per the hard invariant) +
   `api/qbo/create-invoice.js` (line items from the job/milestones).
4. **Dedupe guard:** never create a second invoice for an existing `qbo_invoice_id`.
5. **Trigger:** start with a manual "Send to QuickBooks" button in JobEditor; milestone-automation later.

**Effort:** medium, more OAuth-finicky than A. First session likely = qbo.js + token refresh + one
test create against sandbox.

---

## 🟡 UNBLOCK FIRST (real-world, not code) — Client portal via the website

**What Ang wants:** clients reach the portal "through" rm117.com. The portal is **already built**
(Clerk email login, live on Vercel). "Through the website" = a **"Client Login" button on the Wix
site → the portal on a branded subdomain** (`portal.rm117.com`), so it feels native.

**Design call:** **link out, do NOT iframe-embed.** Clerk auth breaks inside a third-party (Wix)
iframe (third-party-cookie/session issues). A login button → branded subdomain is the robust pattern.

**THE BLOCKER:** to set up `portal.rm117.com` you need DNS control of rm117.com — and the domain's
DNS lives in a **different Wix account than Ray's** (the same wall that stopped the Resend email
setup, see project memory 2026-06-18). **Step one is account/DNS access, not code.**

**Sequence once unblocked:**
1. Get DNS access (or have the controlling account add records).
2. Add `portal.rm117.com` to the Vercel project → CNAME to `cname.vercel-dns.com`.
3. Add a "Client Login" button/link on the Wix site → `https://portal.rm117.com`.
4. **Natural trigger to also fix the Clerk dev→prod issue** (see project memory): a production Clerk
   instance wants a custom domain anyway, so do the domain + Clerk-prod migration together.

**Effort:** code is small; the gating step is real-world account access.

---

## 🔵 BIG TRACKS — plan separately (but they shape how we build now)

### Website redesign for traction + easy client entry
Mostly a marketing/web track. **Real decision:** stay on Wix, or rebuild the marketing site as a
**Next.js site on Vercel** — which would let you own the domain, fold the portal in cleanly, and
serve the productization goal. Worth a dedicated planning session; not app-codebase work yet.

### §3. Productize / white-label — sell to other design firms  _(explicitly "after we finish")_
**The vision:** package the app to sell to other firms, customizable per type (architecture /
interior design / graphic design). This is a **multi-tenant SaaS pivot** — a v2-product effort
(firm isolation, configurable vocabulary, branding, billing, onboarding), NOT a now-task.

**But make it the LENS for now** so you build *toward* sellable instead of retrofitting:
- **Config-driven vocabulary:** phase names, and note "Forefront" (referral commissions) is
  RM117-specific → it becomes an optional module. Firm-type presets (arch/interior/graphic).
- **Tenant-readiness:** keep new tables/queries tenant-scopable in mind (a `tenant_id` + Supabase
  RLS later); don't hardcode "RM117" into shared logic.
- **Branding:** the existing 5-theme system is already a head start on per-firm branding.
- **The Phase-2 monolith split** (test plan) directly serves this — small, reusable components are
  what you'd template per firm.

---

## Suggested sequence for next sessions
1. **Pick A or B** (Proposal template recommended) and ship a v1 — build it config-driven.
2. In parallel (no code): chase down the **rm117.com DNS/Wix access** so the portal-front-door unblocks.
3. Consider doing **Phase 2 (split the monolith components)** from the test plan before/with big UI
   work — it de-risks the proposal-UI work AND seeds productization.
4. Schedule separate planning sessions for **website redesign** and **productization architecture**.

## Open decisions waiting on Ray/Ang
- Proposal: fixed-vs-variable sections; project-size tiers; sample proposals for Claude.
- QBO: which company (sandbox/prod); is the refresh token still valid.
- Wix: who controls the rm117.com domain/DNS account.
- Website: stay on Wix vs rebuild on Vercel.

---

## Financial tab — "QuickBooks inside the app" (Angelena's ask) — ✅ SHIPPED v1 2026-07-01
**Goal:** give Angelena a Financial tab where she can do most of what she does in QuickBooks, without
leaving the app — including **quarterly reports** and other accounting views. **✅ V1 LIVE 2026-07-01**
(commits `d9dce3a` + `991271c`). Read-only; QBO stays the ledger of record, the app surfaces it via the
QBO Reports/Query API (`api/qbo/financials.js` → pure parsers `api/_lib/qbo-reports.js`). No Supabase
mirror/Cron was needed for v1 — reads QBO live on each tab load.

**Strategy — surface, don't rebuild.** QuickBooks stays the system of record. The Financial tab READS
QBO's own reports via the API and pairs them with the app's job-level data. Far less work than
re-implementing a ledger.

**Shipped in v1:**
- ✅ **Profit & loss** (top): Income / Expenses / Net + margin, reconciled (Income−Expenses=Net, COGS folded
  in); period toggle (This year / quarter / month / last month).
- ✅ **Quarterly comparison:** "Net income by quarter" bar chart, trailing 6 quarters
  (`summarize_column_by=Quarter`), green=good / orange=loss around a zero baseline; **click a quarter to load
  its P&L**.
- ✅ **A/R aging:** outstanding total + buckets (current…90+) + open-invoice list; sort (Most overdue | Job ID),
  scope filter (2025 & newer | All — pre-2025 QBO data is being cleaned up, filtered by Job-ID year, never
  deleted).
- ✅ **Top invoices** (biggest billings in period) + **Top expenses** accounts.

**Not yet (candidate follow-ups, prioritize with Ang's feedback):**
- Export a P&L / A/R statement to PDF/CSV (reuse the `pdf-lib` doc engine).
- Cash flow (QBO cash-flow report API); sales by customer / job type / referrer.
- **Per-job financials** on the JobEditor: contract value, billed, outstanding, payment timeline.
- Forefront commissions roll-up surfaced financially.
- Caching QBO reads (a Supabase mirror + Vercel Cron / "Refresh from QuickBooks") if live reads get slow.

**Notes:** the connected Intuit QuickBooks MCP exposes P&L, balance sheet, AR aging, cash flow, and
sales-by-customer reports — handy to prototype new views' shape before wiring the app's own read.
