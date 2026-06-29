# QuickBooks Two-Way Sync — Intuit Production Plan & Checklist

**Created:** 2026-06-28 · **Owner:** Ray · **Status:** IN PROGRESS — Phase B (legal docs) DONE & LIVE
(2026-06-29). Next = Phase C (Ray applies for Intuit production keys using the live URLs below).

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

**Phase C — Intuit production keys**
- [ ] [Ray] developer.intuit.com → RM117 App → "Get production keys" / Keys and credentials → Production
- [ ] [Ray] Fill app assessment (name, logo, host domain, launch URL, EULA URL, Privacy URL, redirect URI)
- [ ] [Ray] Complete the **Compliance** questionnaire (use the Q&A below)
- [ ] [Ray] Submit; wait for production keys to be issued

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
