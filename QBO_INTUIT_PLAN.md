# QuickBooks Two-Way Sync — Intuit Production Plan & Checklist

**Created:** 2026-06-28 · **Owner:** Ray · **Status:** ✅ **COMPLETE — QBO TWO-WAY SYNC IS LIVE (2026-06-30).**

### ✅ DONE 2026-06-30 — Phases D + E shipped, live, end-to-end verified
- **Connected to the real company** `Room 117 Architecture & Design LLC` (Realm `193514517070094`).
- **Creds:** uses Intuit's dashboard-"Development" keys (`ABYas…`) — legit for a private single-company app
  (they connect to the production company; verified via CompanyInfo). The "Production"-labeled keys (`AB6whTti…`)
  are only for marketplace publishing — not used. **Minting gotcha:** the OAuth Playground's app labels are
  INVERTED vs the dashboard — use its **"(Production)"** entry (connects to the real company); the "(Sandbox)"
  entry hits a fake sandbox company. Refresh token minted via the Playground (accounting scope), seeded into the
  shared `qbo_tokens` row (migration `0006`); `.env` + Vercel hold `QBO_CLIENT_ID/SECRET/REALM_ID` + `QBO_CONNECT_KEY`.
- **Built:** `api/_lib/qbo-oauth.js` (CSRF state + exchange), `api/qbo/connect.js`/`callback.js`/`status.js`,
  `intuit_tid` capture, `QboInvoicePanel` ("Send to QuickBooks"), `api/jobs/rename.js` + `CorrectJobIdModal`
  (the 3-system "Correct Job ID" rename), migration `0007` (FK ON UPDATE CASCADE). Commits `b601a87`, `13c0c30`,
  `2177307`, `e9016e5`, `86aa9c6`.
- **Verified:** library smoke test (create→read→delete $1 invoice) + a real UI→API→QBO test on `26_042_Gonzalez`
  (invoice #1303 created in QuickBooks, then deleted; customer kept) + a full 3-system rename test (all cleaned up).
- **Reconciliation:** `QBO_JOBID_AUDIT.md` — most jobs already matched once spaces were allowed in Job IDs; the
  only open item is the Dunn `24_008` duplicate pair (a data question for Ray). Inbound payments already flow via Zapier.
- **⚠️ TODO:** rotate the `95YW…` Development secret (shown in a screenshot) — won't break the refresh token.
- **NEXT:** the **Financial tab** (read QBO reports/balances into the app) — now unblocked. See `ROADMAP.md` + `NEXT_SESSION.md`.

---

#### (historical) pre-launch status
Phases B + C were DONE; Phase E code done 2026-06-30; Intuit issued production-capable credentials.

### ✅ DONE 2026-06-30 (Phase E — code, all built/tested/built-green ahead of creds)
The parked outbound (`create-customer`, `create-invoice`) + inbound (`payments/webhook.js`) were already
complete. Added this session:
- **`supabase/migrations/0006_qbo_tokens.sql`** — the singleton `qbo_tokens` rotation store `qbo.js` reads.
  ⚠️ **Apply in Supabase** (along with 0005 if not yet applied) before the app rotates tokens.
- **OAuth connect/reconnect** — `api/_lib/qbo-oauth.js` (signed-state CSRF, authorize-URL, code exchange) +
  `api/qbo/connect.js` (302 → Intuit; localhost-open, prod needs `?key=QBO_CONNECT_KEY`) +
  `api/qbo/callback.js` (verify state → exchange code → persist to `qbo_tokens` → show the refresh token once).
  This is also the **reconnect path** promised in the Compliance questionnaire.
- **`api/qbo/status.js`** — `{ configured, env, realm }` (no secrets) so the UI flag can hide QBO until seeded.
- **`intuit_tid` capture** on every failed QBO call (questionnaire commitment).
- **UI:** `QboInvoicePanel.jsx` ("Send to QuickBooks" — multi-line invoice, bill-in-full or per-milestone,
  optional email) wired into `PaymentsTab`, shown only when `/api/qbo/status` reports configured.
- **Tests:** `tests/qbo-oauth.test.js` (state CSRF round-trip, authorize URL, redirect URI). **75 green; build OK.**
- All routes registered in `server.js`. **NOT yet committed** — held until the live smoke test passes.

### ▶ WHAT RAY DOES NEXT (Phase D — seed creds, then we smoke-test together)
1. **Rotate** the Production client secret (it was visible in a screenshot) → copy the new one.
2. Paste into `.env`: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` (rotated), `QBO_REALM_ID=193514517070094`.
3. In **Supabase**, apply migrations **0006** (and 0005 if pending).
4. In the **Intuit app → Settings → Redirect URIs (Production)**, add BOTH:
   `http://localhost:3001/api/qbo/callback` and `https://rm117-bms.vercel.app/api/qbo/callback`.
5. `npm run dev`, open **http://localhost:3001/api/qbo/connect**, authorize the real company → the page
   prints `QBO_REFRESH_TOKEN` → paste it into `.env`, restart dev.
6. Tell Claude → joint **smoke test** (create one test invoice on a real job, verify in QBO, clean up).
7. Add the 4 `QBO_*` keys (+ `WEBHOOK_SECRET`) to **Vercel** production env, then `git push` (test gate → deploy).

### ✅ DONE 2026-06-29 (Phase C — app assessment + Compliance questionnaire, all SUBMITTED)
- **App details (100%):** EULA URL = `…/terms.html`, Privacy URL = `…/privacy.html`; host domain
  `rm117-bms.vercel.app`; launch/disconnect/connect URLs = `https://rm117-bms.vercel.app`; category = Invoicing
  (+ Project Management); regulated industries = **None of the above**; hosting = United States, IPs
  216.198.79.67 + 64.29.17.67 (Vercel edge; informational for an internal app).
- **Regulated industries — KEY FIX:** the questionnaire first showed a **Payments/Money Movement** section.
  Removed it via Settings → Regulated industries → unchecked Payments + checked "None of the above". The app
  is **accounting/invoicing only** (`com.intuit.quickbooks.accounting`) — it creates invoices/customers and
  reads payment status; it does NOT process cards/ACH or move money. Angelena's "bill from the app" = invoicing
  (Accounting API), NOT payments. (Important distinction for any future review.)
- **Compliance questionnaire answers (as submitted):**
  - *General:* no regulator complaints; no legal counsel engaged; confirmed security-policy compliance;
    app facilitates a business process (syncs QBO data) = Yes; no sanctions; **no generative AI** (verified:
    zero AI deps/usage in the app — using Claude to *build* it doesn't count).
  - *App Information:* built from scratch (own code); platform = **Web/SaaS** (server-side API calls);
    interacts with Intuit data = **reads + writes** (no delete); **private app**; users = **only the QBO
    company admin who connected the app**; integrates with other platforms = **Yes** (listed Supabase, Vercel,
    Clerk, Google, Resend).
  - *Authorization & Auth:* tested connect/disconnect/reconnect = **No** (pre-launch, will test in build);
    refresh tokens refreshed **only when access tokens expire**; retries failed auth = Yes; ask to reconnect
    on auth error = Yes; used discovery doc = No (endpoint hardcoded, fine); handles expired access/refresh
    tokens + invalid_grant + CSRF = **Yes**; relies on OAuth playground = **No** (own OAuth flow).
  - *API Usage:* category = **Accounting API** only; frequency = **Weekly + Monthly**.
  - *Accounting API:* versions = **all four** (Simple Start/Essentials/Plus/Advanced — uses only core
    features); handles version changes = Yes (+ explanatory text); features used = **None** (no multicurrency,
    no sales tax); webhooks = **No** (inbound reconcile is via Zapier, not Intuit webhooks); CDC = **No**.
  - *Error Handling:* tested API-error handling = **No** (pre-launch); capture `intuit_tid` = **No**;
    store errors in logs = **Yes** (Vercel function logs); in-app support contact = **No**.
  - *Security:* breach = No; security team = No; client ID/secret stored securely (server-side env) = **Yes**;
    **MFA = Yes** (Ray enabling Clerk MFA before submit — see below); Captcha = No; WebSocket = No; Intuit data
    used only for the original customer = **Yes** (first option).
- **MFA (Clerk):** answered Q4 = Yes; to make it truthful Ray is enabling **Multi-factor** in the Clerk
  **Development** instance (the live app runs `pk_test` dev keys) — User & authentication → Multi-factor →
  Authenticator app (TOTP) + Backup codes; recommended requiring it for staff + enrolling.
- **BUILD COMMITMENTS captured for Phase E (from honest questionnaire answers):** (1) implement the OAuth
  connect flow with a `state` param (CSRF) + a reconnect path; (2) add `intuit_tid` capture/logging on QBO
  errors; (3) optionally add an in-app "Contact support" link; (4) validate connect/disconnect/reconnect +
  API-error handling during the build (answered No = untested today).

### ✅ DONE 2026-06-29
- **Decisions:** legal/privacy contact = **raymond@rm117.com**; app scope described as an **internal firm tool**
  (staff-only; connects to the firm's own QuickBooks). Entity = "Room 117 Architecture & Design LLC", address
  836 Galloping Hill Road, Roselle Park, NJ 07204, phone 908.451.4633.
- **Phase B — legal docs LIVE** (commit `5d35b45`). Static public pages, served ahead of the SPA catch-all
  (Vercel serves real files before `rewrites`):
  - **Privacy Policy:** https://rm117-bms.vercel.app/privacy.html  (HTTP 200, public, no login)
  - **Terms of Service:** https://rm117-bms.vercel.app/terms.html  (HTTP 200, public, no login)
  - QuickBooks data-handling disclosed (customers + invoices; `com.intuit.quickbooks.accounting` scope only).
- **Verified:** session is connected to the real company via the Intuit MCP — `company_info` returned
  "Room 117 Architecture & Design LLC" (industry 541490). Confirms Realm `193514517070094` is reachable.
- **Sent to Ray:** copy-paste messages for Angelena (entity name/address, authorize app to read/write QBO,
  OK to create real invoices) and Tom (review legal docs / lawyer?, security-questionnaire input).

## Goal
Move the **RM117 App** on developer.intuit.com from **IN DEVELOPMENT** → **production credentials**,
so the already-built-but-dormant QuickBooks code can talk to the real company and we can finish the
**two-way sync**. The 4 `.env` keys (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REFRESH_TOKEN`,
`QBO_REALM_ID`) are all **EMPTY** today — filling them is the whole unlock.

## What already exists (so the build session is short once unblocked)
- Parked code: `api/_lib/qbo.js` (OAuth/token client + refresh-token rotation), `api/qbo/create-customer.js`,
  `api/qbo/create-invoice.js`. Dormant until creds exist (`hasQbo()` returns false while empty).
- Known facts: real company **"Room 117 Architecture & Design LLC"**, **Realm ID `193514517070094`**
  (PRODUCTION, not sandbox). App ID `9864db2…`. `QBO_ENV` defaults to `production`.
- Refresh-token rotation gotcha is already handled in code — needs a tiny `qbo_tokens` table (migration,
  Claude will add during the build session).

---

## THE PLAN (start → finish)

### Phase A — Gather the facts (Ray, with Angelena + Tom)
Nothing on Intuit happens cleanly until these are pinned down. See the **Questions for Angelena / Tom**
sections below. No Claude usage needed.

### Phase B — Create the legal docs (EULA + Privacy Policy) ← the real missing piece
Intuit's production checklist requires **two publicly accessible URLs**: a EULA/Terms and a Privacy
Policy. **You have neither today** (confirmed: not in the app, not on rm117.com, not on the live site).
Plan:
1. **Claude drafts** `public/privacy.html` + `public/terms.html` (static files → served publicly with
   **no login wall**, unlike the auth-gated app routes). URLs become:
   - `https://rm117-bms.vercel.app/privacy.html`
   - `https://rm117-bms.vercel.app/terms.html`
2. **Ray + Tom review** the text (it's boilerplate, not legal advice — a lawyer glance is optional but
   wise for a legal doc).
3. **Push** → URLs go live. Paste them into the Intuit checklist.

### Phase C — Intuit production-keys flow (Ray, on developer.intuit.com)
On the RM117 App → **"Get production keys"** (or **Keys and credentials → Production**). Fill the app
assessment:
- App name, logo, **host domain** (`rm117-bms.vercel.app`), launch/landing URL
- **EULA URL** + **Privacy Policy URL** (from Phase B)
- **Redirect URI(s)** for OAuth (Claude will give the exact value during the build session — likely a
  small one-time `/api/qbo/callback` or a local redirect for the token-mint step)
- Scope: **`com.intuit.quickbooks.accounting`** (read/write invoices + customers)
Then complete **Compliance** (left sidebar) — the security questionnaire (~40 min). Prep answers from
the **Compliance Q&A** section below.

### Phase D — Get the credentials into `.env` (Ray + Claude)
1. Intuit issues **production Client ID + Client Secret** → Ray pastes into `.env`
   (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`) and sets `QBO_REALM_ID=193514517070094`.
2. **Mint the refresh token** (one time): Claude provides a tiny OAuth helper; Ray clicks "Authorize"
   and connects the **real** QuickBooks company; the flow returns `QBO_REFRESH_TOKEN` → paste into `.env`
   (and add the same keys to Vercel env for production).

### Phase E — Build / activate the two-way sync (Claude, the big session)
With creds live (`hasQbo()` → true), the parked code wakes up. Work:
- Add the `qbo_tokens` table (migration) for refresh-token rotation.
- Outbound: app creates QBO **customers + invoices** (Display Name = Job ID invariant).
- Inbound: paid invoice → `payments` row (Zapier webhook path already sketched in CLAUDE.md).
- Wire a UI affordance (e.g. "Create QBO invoice" on a job) + a feature flag.
**This is the meaty session — best done on a fresh Claude budget.**

### Phase F — Test & ship (Claude + Ray)
- Smoke test against the real company (create one test customer/invoice, confirm in QuickBooks, then
  clean up). Verify inbound payment reconciliation. Then push (test gate → deploy).

---

## FLOW CHECKLIST

**Phase A — facts**
- [ ] [Ray] Confirm legal entity name (likely `Room 117 Architecture & Design LLC`) — see Angelena
- [ ] [Ray] Confirm business mailing address (letterhead = 836 Galloping Hill Road, Roselle Park, NJ 07204)
- [ ] [Ray] Decide the privacy/legal **contact email** (raymond@rm117.com or tom@rm117.com?)
- [ ] [Ray] Confirm app is **internal / single-company** (not published to other firms) — affects both
      the legal docs and the Intuit review path

**Phase B — legal docs** ✅ DONE 2026-06-29 (commit `5d35b45`)
- [x] [Claude] Draft `public/privacy.html` + `public/terms.html` (boilerplate tailored to the app's data)
- [ ] [Ray + Tom] Review wording (optional lawyer check) — pages are LIVE; review in parallel, amend anytime
- [x] [Claude] Commit + push → confirmed both URLs load publicly (HTTP 200, no login)

**Phase C — Intuit production keys** ✅ SUBMITTED 2026-06-29 (see the detailed DONE block above)
- [x] [Ray] developer.intuit.com → RM117 App → app assessment
- [x] [Ray] Fill app assessment (name, host domain, launch URL, EULA URL, Privacy URL); redirect URI left for Phase D
- [x] [Ray] Complete the **Compliance** questionnaire (all 7 sections answered)
- [ ] [Ray] Submit (pending Clerk MFA enable) → **WAITING on Intuit review for production keys to be issued**

**Phase D — credentials**
- [ ] [Ray] Paste production `QBO_CLIENT_ID` + `QBO_CLIENT_SECRET` into `.env`
- [ ] [Ray] Set `QBO_REALM_ID=193514517070094`
- [ ] [Claude] Provide OAuth helper to mint the refresh token
- [ ] [Ray] Authorize the real company → paste `QBO_REFRESH_TOKEN` into `.env`
- [ ] [Ray] Add all 4 keys to **Vercel** production env vars

**Phase E — build**
- [ ] [Claude] `qbo_tokens` table migration (refresh-token rotation)
- [ ] [Claude] Outbound customer + invoice create; inbound payment reconcile; UI + feature flag

**Phase F — test & ship**
- [ ] [Claude + Ray] Smoke test vs real company (create + verify + clean up)
- [ ] [Ray] Push → deploy → confirm live

---

## What Claude needs from you to GENERATE the legal docs (Phase B)
Answer these and I can write both pages in one pass:
1. **Legal entity name** as it should appear (e.g. "Room 117 Architecture & Design LLC").
2. **Business address** for the docs (default: 836 Galloping Hill Road, Roselle Park, NJ 07204).
3. **Contact email** for privacy/legal inquiries (raymond@ or tom@rm117.com).
4. **Is the app internal-only** (just RM117 staff use it) or will outside clients/firms use it? (Changes
   the privacy scope.)
5. **Effective date** to stamp (today's date is fine).
6. OK for me to **disclose the sub-processors** the app already uses? (Supabase = database, Vercel =
   hosting, Clerk = staff login, Google = Drive/Calendar, Resend = email, **Intuit/QuickBooks** = accounting.)
   Standard for a privacy policy; just confirming.

## Questions to ask ANGELENA (owner / QuickBooks admin)
- [ ] What is the **exact legal entity name** + registered business address?
- [ ] Confirm the QuickBooks company to connect is the live **"Room 117 Architecture & Design LLC"**
      (Realm ID 193514517070094) and she **authorizes** the app to read/write invoices + customers in it.
- [ ] Which **email** should be the public privacy/legal contact?
- [ ] Is she OK with the app creating **real invoices/customers** in QuickBooks (vs. read-only)?

## Questions to ask TOM (Thomas Dores, RA — partner)
- [ ] **Review the EULA + Privacy Policy** boilerplate once drafted — anything to change, or is a lawyer
      review wanted before publishing?
- [ ] Any **data-handling or security concerns** for the Intuit Compliance questionnaire?
- [ ] Confirm business details (entity name/address) match what's on file with the state / QuickBooks.

## Intuit COMPLIANCE questionnaire — prep (typical questions + our honest answers)
Intuit asks security/data questions. Suggested answers from our actual stack (Ray to confirm/adjust):
- **Where is data stored?** Supabase (Postgres, US) + Google Drive (firm Shared Drive); hosting on Vercel.
- **Is data encrypted in transit / at rest?** In transit: yes (HTTPS/TLS everywhere). At rest: yes
  (Supabase + Google + Vercel encrypt at rest by default).
- **Who can access QuickBooks data?** Only RM117 staff, authenticated via Clerk (email login; staff role
  gate on every internal API). Clients never access it.
- **Do you use MFA / access controls?** Clerk supports it for staff; the backend service-account keys are
  server-side only (never shipped to the browser).
- **How are secrets stored?** Environment variables (Vercel env + local `.env`), never committed.
- **Breach/incident process?** (Ray to state a simple process — e.g. revoke keys, notify Intuit + affected
  parties.)
- **What QuickBooks data do you access and why?** Customers + invoices, to sync RM117 job billing with
  QuickBooks (create invoices, reconcile payments). Scope: `com.intuit.quickbooks.accounting`.

---

## Notes
- None of Phases A–C cost Claude usage except the doc drafting in Phase B (small). The **big** budget item
  is **Phase E** (the sync build) — save it for a fresh Claude budget.
- Refresh tokens rotate (~100-day life, new value on each refresh) — the code persists rotated tokens to a
  `qbo_tokens` table, so once seeded it self-maintains. Just don't let the app sit unused past the token
  lifetime without a refresh.
