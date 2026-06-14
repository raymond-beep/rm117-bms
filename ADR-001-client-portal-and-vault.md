# ADR-001: Client Portal, Document Vault & Portal Data Backbone

**Status:** ⚠️ SUPERSEDED (in part) by the second-generation architecture — see addendum below.
**Original status:** Proposed
**Date:** 2026-06-06 · **Superseded:** 2026-06-09
**Deciders:** Ray (builder/maintainer), Ang (principal — final sign-off)

---

## ⚠️ Addendum — Superseded by Second-Generation Architecture (2026-06-09)

The central assumption of this ADR — **"keep the Google Sheet authoritative for job and
billing data" (Decision 1, Option B)** — has been **superseded**. The current architecture of
record is in PLAN.md, SCHEMA.md, VISION.md, and CLAUDE.md. In summary:

- **Supabase is now the single source of truth** for all job, client, financial, and
  correspondence data — not just "portal-only" data. The Google Sheet is the **migration seed**
  and a **read-only fallback through Phase 3**, then archived. This is effectively Decision 1's
  **Option C** (full migration to Postgres), deferred and sequenced rather than rejected.
- **QuickBooks** drops from a record-keeping role to a **payment + invoice-delivery channel**;
  the app creates invoices via the **QBO API** (outbound) and a **Zapier webhook → Supabase**
  records payments (inbound). The Zapier *Lookup tab* approach is retired.
- The **"`rm117-dashboard-v1.jsx` behavior is frozen"** invariant is **lifted**: the dashboard's
  data layer is intentionally swapped Sheet→Supabase in Phase 3 (UX preserved).
- New data-model facts: one `clients` table (investors/contractors/homeowners); each job has
  `client_id` (billed) + `referred_by_id` (inbound referral only); a single `phase` field per
  job (no separate status); `outstanding` is computed, never stored.

**What still holds from this ADR:** Decision 2 (document vault) is unchanged — files stay in
Google Drive and the backend service account brokers all client access (Option 2A). The Clerk
`client` role, the Resend email bridge, DocuSign onboarding, and the Apple/Google calendar
approach all stand. The Job-ID-as-universal-key discipline and the client-isolation invariant
are unchanged. **Phase numbering changed** (billing automation moved from Phase 6 → Phase 8).

Everything below is preserved as the original decision record and its reasoning.

---

## Context

RM117 is moving from a manual workflow (job tracking in a Google Sheet, invoicing
by hand in QuickBooks) toward an all-in-one platform. The employee-facing layer
(dashboard + hosted BMS) already exists. This ADR covers the **new client-facing
layer**: onboarding, a per-project client portal, and a two-way document vault.

The current foundation:

- **Google Sheet** (`Current Job Log`) is the single source of truth for jobs and billing.
- Each job has **two Google Drive folders**: *Files Sent* and *Files Received*.
- **Clerk** is the chosen auth provider (staff only, today).
- **QuickBooks Online** handles invoicing and payment.
- **Vercel** hosts the app; **Zapier** syncs paid invoices back to the Sheet.

Forces at play:

1. **First real permission boundary.** Today all five staff have full edit access.
   External clients are a fundamentally different tier and must only ever see their
   own job(s).
2. **Two-way file exchange.** Clients download from *Files Sent* and upload into
   *Files Received*, mirroring the firm's existing Drive habit. View-only is the
   fallback if uploads get messy.
3. **Persistent messaging with an email bridge.** A portal message must also notify
   the client by email; client email replies must flow back into the portal thread.
4. **Onboarding.** Intake → proposal → e-signature → signed contract → retainer.
   A client portal account is created **at contract signing** (using the buffer
   window before the first site visit to gather preliminary info).
5. **Invariants that must not break:** Job ID format `YY_NNN_[FF_]LastName` must match
   the QuickBooks Customer Display Name; the Zapier Lookup tab (248 flat rows) must
   not be touched; `rm117-dashboard-v1.jsx` behavior must not change.
6. **Cost discipline** (small firm) and the **resale north-star** (eventual multi-tenant).

---

## Decision

**Decision 1 — Portal data backbone:** Keep the **Google Sheet authoritative for job
and billing data**. Add a small managed Postgres datastore (**Supabase**) for
**portal-only data**: client accounts/roles, message threads, file publish/upload
records, and notification state. The Sheet stays the firm's brain; Supabase owns the
client tier.

**Decision 2 — Document vault storage:** Keep files in the **existing Google Drive job
folders**. The firm **backend (service account) brokers all client file access** —
clients never receive Drive permissions. A client request hits the portal → backend
verifies the client owns that Job ID → backend streams the file from that job's
*Files Sent* folder. Client uploads go through the backend into *Files Received*.

**Supporting choices:**
- **Auth:** clients are a scoped `client` role inside the existing Clerk setup.
- **Email bridge:** a transactional email service (Resend or equivalent) for outbound
  notifications + inbound reply parsing.
- **Onboarding e-signature:** DocuSign (Standard plan); retainer collected as a
  normal QuickBooks invoice (no new payment tooling).
- **Calendar:** Ang keeps the Apple Calendar app and adds the shared company Google
  Calendar as an account (native two-way sync); the dashboard reads Google Calendar.

---

## Options Considered

### Decision 1 — Portal data backbone

#### Option A: All-Sheet (extend the Google Sheet with portal tabs)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | $0 |
| Scalability | Poor — Sheets is not built for auth'd concurrent reads/writes |
| Concurrency | Poor — risk of clobbering rows; no row-level access control |
| Multi-tenant path | None |

**Pros:** Nothing new to learn or pay for. **Cons:** A Sheet is the wrong tool for
client accounts and live messaging; no real per-row security; collides with the
"never let Zapier/automation fight human edits" rule.

#### Option B: Sheet (jobs/billing) + Supabase (portal data) — **CHOSEN**
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | ~$25/mo |
| Scalability | Good for RM117 and well beyond |
| Concurrency | Strong — Postgres with row-level security |
| Multi-tenant path | Clear — the database is already the right shape for it |

**Pros:** Preserves every Sheet invariant; gives a proper home for accounts, messages,
and access rules; is the natural seed for the resale north-star. **Cons:** A second
data store to keep coherent; one more service to operate.

#### Option C: Full migration to Postgres now (retire the Sheet)
| Dimension | Assessment |
|-----------|------------|
| Complexity | High |
| Cost | ~$25/mo |
| Scalability | Excellent |
| Concurrency | Excellent |
| Multi-tenant path | Excellent |

**Pros:** One source of truth; cleanest long-term. **Cons:** Throws away a working
system Ang trusts and reads daily; breaks the Zapier flows; large rebuild with no
near-term payoff. Premature.

### Decision 2 — Document vault storage

#### Option A: Surface Drive, backend brokers access — **CHOSEN**
**Pros:** Firm keeps working in Drive exactly as today; **$0 incremental storage**
(already in Workspace); zero external Drive ACLs to manage; per-job scoping enforced
in the app, not in Drive sharing; view-only fallback = just hide the upload button.
**Cons:** Backend must mediate every download/upload (a known, bounded amount of work).

#### Option B: Dedicated object store (Supabase Storage / S3 / R2)
**Pros:** Clean programmatic control. **Cons:** Files now live in two places (Drive +
store); breaks the firm's existing folder habit; new storage bill; sync headaches.

#### Option C: Native Drive sharing to clients' own Google accounts
**Pros:** No backend brokering. **Cons:** Assumes every client has Google; per-folder
external ACLs are fragile and easy to misconfigure (a real client-data-leak risk);
clients see Drive chrome, not your portal. Rejected on security grounds.

---

## Trade-off Analysis

The throughline is **"add a thin client tier without disturbing the firm's working
core."** Option 1B + 2A do exactly that: the Sheet and Drive workflows Ang relies on
stay untouched, while a small database and a brokering backend carry the genuinely new
responsibilities (identity, messaging, scoped file access). Option C in both decisions
is the "do it properly all at once" path — correct someday, wrong now: it trades a
working system and weeks of rebuild for scale RM117 doesn't yet need. The chosen path
keeps the resale door open (the database is the seed of a tenant boundary) without
paying for multi-tenancy before there's a second tenant.

The one accepted cost is **coherence between two stores**. Mitigation: the Job ID is
the shared key across Sheet, Drive folder names, QuickBooks, and now Supabase records —
the same discipline that already makes the Zapier matching reliable.

---

## Cost (monthly, RM117 scale — verified via web, June 2026)

| Service | Role | RM117 cost |
|---------|------|------------|
| Clerk | staff + client auth | **Free** (free tier covers 10,000 monthly active users; then $25/mo + $0.02/MAU) |
| Supabase | portal database | **~$25/mo** (Pro — the free tier pauses after a week of inactivity, unsuitable for a live portal) |
| Google Drive | file storage | **$0 extra** (already in Workspace) |
| Resend (or equiv.) | email bridge | **$0 → ~$20/mo** (free tier = 3,000 emails/mo, 100/day) |
| Vercel | hosting | Free now; ~$20/mo at a production tier — confirm current rate |
| DocuSign | onboarding e-sign | **~$25/mo** (Standard, annual; ~100 envelopes/yr). Personal is $10/mo but caps at 5/mo. NAR members: $20/mo REALTORS plan |
| QuickBooks | retainer payment | already in use — no new cost |

**Total ≈ $50–90/month for the firm. Clients pay nothing** — they log in with the
email on file. Costs stay flat as clients are added; the lines that move only matter on
the multi-tenant resale path (storage if you leave Drive; database/auth at scale).

---

## Consequences

**Becomes easier**
- Clients self-serve documents 24/7; less email back-and-forth and fewer "can you resend" requests.
- A real identity/permission model exists — the foundation for everything client-facing.
- Onboarding is structured and trackable (intake → e-sign → retainer → portal).

**Becomes harder**
- Two data stores to keep coherent (Sheet + Supabase), keyed by Job ID.
- The backend now mediates file access and runs an inbound-email parser — more surface to maintain and secure.
- Per-job access control must be correct on day one (a client must never see another client's files).

**To revisit**
- **Phase 6 billing automation** stays blocked until Ang defines which phase transitions trigger which invoice amounts.
- Inbound-email reply parsing should be validated on the chosen provider before relying on it.
- At the first external firm (resale), reassess Sheet-as-truth and Drive-as-storage.

---

## Action Items

1. [ ] Stand up Supabase (Pro); model `clients`, `client_jobs`, `threads`, `messages`, `file_records`, `notifications`.
2. [ ] Add a `client` role in Clerk; gate every portal route + API call by Job-ID ownership.
3. [ ] Build the file-broker API: list/stream from *Files Sent*, accept uploads into *Files Received*, all scoped by Job ID via the service account.
4. [ ] Wire the email bridge: outbound notification on new message; inbound parse → append reply to the matching thread.
5. [ ] Create the DocuSign account (Standard); define the onboarding sequence intake → proposal → e-sign → signed → portal account → QuickBooks retainer.
6. [ ] Calendar: have Ang add the shared company Google Calendar to her Apple Calendar app; confirm new firm events are created on that calendar.
7. [ ] Keep Job ID as the universal key across Sheet, Drive, QuickBooks, and Supabase. Never write the Sheet's Outstanding column or the Zapier Lookup tab.
8. [ ] (Blocked) Schedule the Phase 6 trigger-map conversation with Ang.
