# RM117 BMS — User Test / UX Findings

**Date:** 2026-06-28 · **Run by:** Claude (acting as a staff user) · **Scope this round:** the areas Ray
flagged — (1) creating a new job, (2) client-portal access + a staff-editable version, (3) billing —
plus friction spotted along the way. Grounded in the live app + the real form/portal code.

**How to use:** each finding has an effort tag and a suggested fix. "Quick wins" are self-contained and
need no one else; "needs a decision" items have an open question for Ray/Ang. This is a living backlog.

---

## 1) Creating a new job — the biggest friction area

Today the New Job drawer asks for: **Job ID** (free text), Client name, Address, Phase, Job total,
Forefront toggle + commission, Notes. Required = Job ID + Client name. Findings:

- **🔴 [Quick win] Job ID is fully hand-typed with no help.** You must type `26_012_Smith` and *know* the
  next sequential number (`NNN`) yourself. The app already holds every job, so it can **auto-suggest the
  next free number for the year** and assemble the ID from parts: year (auto), number (suggested/editable),
  last name (typed), `FF_` toggle (prepended). → Much less error-prone; removes the "what number are we on?"
  lookup. _Effort: small._
- **🔴 [Quick win] No live validation/preview.** A malformed ID only fails *after* you hit Create (server
  400). Show a live preview of the assembled ID + a green/red valid indicator as you type. _Effort: small._
- **🟠 [Decision] New jobs aren't linked to a client record.** The drawer stores a **free-text client_name**
  only; `client_id` stays null. So a new job has no linked `clients` row — the editable client-contact card
  (added 2026-06-27) starts empty, and you can't reuse an existing client or capture the **referrer**
  (`referred_by_id`). Suggest: a "pick existing client or create new" control that sets `client_id`, plus an
  optional referrer picker. _Effort: medium. Open Q: do you want client-linking required, or optional?_
- **🟡 Forefront state has two sources that can disagree.** The checkbox sets `is_forefront`, but the API
  also infers it from `_FF_` in the Job ID. If they conflict (checked but no `_FF_`, or vice-versa) you can
  get a Job ID that won't match the QuickBooks Display Name. Drive the FF state from **one** control (the
  toggle prepends `FF_` to the ID). _Effort: small; folds into the Job-ID-builder above._
- **🟡 Two "New Job" buttons** (top header + list toolbar) open the same drawer — harmless, just redundant.

## 2) Client portal access + a staff-editable version

- **Today `/portal` ("Client Portal") is a READ-ONLY preview.** Staff pick a client and see the portal
  exactly as that client would (documents vault from Drive + message thread), via `/api/portal/preview`.
  There's no way to *manage* it from there.
- **Ray's idea — "staff has an editable version instead of read-only" — is sound, and half the pieces
  already exist.** "Editable" really means a **staff portal-management surface**:
  - **Publish/remove documents** → the "Send to Drive" feature we just shipped already publishes to the
    client's Files-Sent vault; the planned **"Sent documents view + un-send"** is the remove side. Together
    that's the document half of an editable portal.
  - **Messages** → reply to / start the client thread from the staff side.
  - **Visibility control** → choose what the client sees.
- **Caveat:** the external client portal is currently **deferred** (Ray held it over login-management
  overhead, in favor of the internal Progress Timeline). So "make the portal editable" is partly a question
  of **whether to revive the client-facing portal** vs. just give staff a unified "manage this client's
  documents + comms" view that doesn't require clients to log in yet. _Open Q for Ray/Ang: revive the
  client-facing portal now, or build the staff-side management view first (no client logins needed)?_
- **🟡 The portal also appears twice in navigation** (icon-nav "Portal" + secondary-nav "Client Portal",
  both → `/portal`). Minor cleanup.

## 3) Billing through the app (Ang's ask)

- Angelena wants to **bill through the app** → this is the **QuickBooks two-way sync** already planned in
  `QBO_INTUIT_PLAN.md`. The UI trigger to design: a **"Create invoice / Send to QuickBooks"** action on a
  job (JobEditor), with a dedupe guard on `qbo_invoice_id`. No new research needed — it's gated on the
  Intuit production credentials. _Effort: medium (the planned build)._

## Other friction spotted

- **🟡 Table view truncates the "Last comm" column** ("LAST CO…" cut off at the right edge). Worth a
  responsive tweak so the most-recent-note column is readable. _Effort: small._
- **(Positive) The grouped-by-phase board + Table toggle, pipeline filter, Forefront/Bill-flag filters,
  and the "money left" per job read well** — this matches how Ang thinks (phase sections, daily Forefront
  tracking, outstanding-at-a-glance).

---

## Suggested priority order
1. **New-job quick wins** (auto Job-ID builder + next-number suggestion + live validation) — self-contained,
   directly addresses Ray's "information to create a new job" concern, no one else needed. **Best tonight task.**
2. **Client linking on new job** (pick/create client, capture referrer) — medium; needs the required-vs-optional decision.
3. **Sent-documents view + un-send** — the document half of the "editable portal," and closes today's
   stale-`file_records` gap.
4. **QBO billing** — the planned big build (gated on Intuit creds).
5. **Polish:** table "Last comm" column, dedupe the two New-Job buttons + two Portal nav entries.

## Decisions (Ray, 2026-06-28)
- **New job — client-linking is OPTIONAL** (offer it, don't force it).
- **Portal — build the staff-only "manage client docs + comms" view FIRST**, intending a client-facing portal
  later. Ray wants an **easier way to organize everything** on the firm's end (not just a mirror of the client view).
- **Billing — support BOTH per-job (pay in full) and per-milestone.** Some clients pay the full bill, some pay per
  milestone; the QBO “Send to QuickBooks” UI should handle both modes.

---

# Round 2 — 2026-07-05 · Full staff power-user sweep

**Run by:** Claude (driving Ray's Chrome on live prod `rm117-bms.vercel.app`, signed in as staff) ·
**Scope:** every sidebar tab + the JobEditor (Details / Progress / Payments) deep-dive · **Method:**
click-through of each screen, watching for broken flows, confusing UI, data glitches, and console errors.

**Verdict:** _nothing critical is broken._ All 7 tabs and the JobEditor loaded with **zero console
errors**; core flows (jobs, payments, live QBO invoicing/financials, proposal generator, Forefront) are
polished and coherent. Findings below are gaps/polish, not blockers.

**Purpose of this list:** a complete baseline from internal testing so real end-user feedback (Angelena +
others) can be mapped against it. Each finding has a **stable ID** (`UX2-NN`) — reference the ID when
logging a user's report so we can see overlap vs. new issues.

**Legend:** 🔴 fix soon · 🟠 medium / needs a decision · 🟡 minor polish · 🔵 data/bookkeeping (not an app
bug) · 📈 business signal (surfaced correctly; act on it). Effort: _S/M/L_.

## A) App fixes (in our control)

> **✅ Cleared 2026-07-13 (all the S-effort items).** `UX2-01`, `UX2-02`, `UX2-03`, `UX2-04`, `UX2-06`,
> `UX2-18` fixed; `UX2-05` verified as intentional (no change). **`UX2-17` (dead global search) is the one
> app fix still open** — it's the M-effort build, deliberately left for its own pass. Two findings were
> **misdiagnosed in the original sweep** — corrected below.
>
> - **UX2-01** — proposal picker now lists **PDFs only** and floats a signed/executed contract to the top.
>   New pure helper `api/_lib/drive-docs.js` (`isPdf`/`pdfsOnly`/`rankProposals`), unit-tested.
> - **UX2-02 — ⚠️ the original diagnosis was wrong.** It is **not** an inconsistent street+city join. Addresses
>   are stored as real mailing blocks (`1 Knapp Ave\nFlorham Park, NJ 07932`) — **111 of 117 jobs carry a
>   newline** (verified against prod). A `<div>` collapses that newline to a space (list looks fine); a
>   single-line `<input>` **drops it entirely** → `204 Robinhood RoadMountainside` in the editor. The data is
>   correct, so **no migration** (the multi-line form is what a letterhead wants). Fix = one shared
>   `addressLine()` formatter in `src/lib/format.js`, used by both the BMS list and the JobEditor.
> - **UX2-03** — Client Portal tab now leads with a "Preview only — not live to clients" banner
>   (`.cp-preview-banner`).
> - **UX2-04** — the manual **Log a payment** form is boxed (`.pay-manual`) so the sticky footer button
>   visibly belongs to it, not to the QuickBooks panel above.
> - **UX2-05** — **verified, no change.** Ray confirmed `tom@rm117.com` is the intended letterhead contact
>   (Tom Dores is the RA who signs the documents).
> - **UX2-06** — a phase the job moved past but never dated is now a distinct **`passed`** state (outlined
>   green dot) instead of `done` (filled). Filled now means "we have a date," which is what green implied.
> - **UX2-18** — (a) `CLAUDE.md` now documents **stored key → UI label** (`potential` → "Proposal Sent",
>   `active` → "Outgoing") so the intentional mismatch isn't "fixed" later. (b) Checkset list is **PDFs only**
>   (same `drive-docs` helper). **Known limit:** the `05.26.26 Zoom Meeting.pdf` example *is* a PDF, so it
>   still shows — deliberately **not** hidden by a filename heuristic, because a false negative would hide a
>   real drawing set, which is far worse than showing one stray file.
>
> Tests **148 green** (+13: `tests/drive-docs.test.js`, `tests/format.test.js`), clean build.

| ID | Sev | Location | Finding | Suggested fix | Effort |
|----|-----|----------|---------|---------------|--------|
| **UX2-01** | 🔴 | JobEditor → Payments → "Signed Proposal" | Lists **every** file in the Drive "Proposal" folder — including `plot.log` (372 B), `.docx`, and `CONSTRUCTION ESTIMATE_….xlsx`. Presenting a `plot.log` as "the contract on file / your source for the fee schedule" is confusing/noisy. | Filter the list to the actual contract — PDFs only, or rank the signed proposal first and collapse the rest. | S |
| **UX2-02** | 🟡 | JobEditor → Details → Address | Field renders `204 Robinhood RoadMountainside` — street + city concatenated with no space/comma. BMS list shows it *with* a space, so it's an inconsistent join in the edit field. | Normalize address display/storage (single formatter shared by list + editor). | S |
| **UX2-03** | 🟠 | Client Portal tab | Page is a preview-only tool (external portal deferred) but gives **no status** that it isn't live to clients — reads as ambiguous ("is this on?"). | Add a one-line banner: "Preview only — the client portal is not live to clients yet." | S |
| **UX2-04** | 🟡 | JobEditor → Payments | The sticky **"Log payment"** footer button stays visible while you're in the "Send to QuickBooks" section (which has its own "Create QBO invoice" button) → slight mis-click risk. | Scope the footer button to the active section, or visually separate the two forms more. | S |
| **UX2-05** | 🟡 | Templates → Proposal PDF | Letterhead footer reads `Email: tom@rm117.com`. Confirm that's the intended contact on outgoing proposals (vs. Ray's / another principal's). | Verify + make the contact configurable if needed. | S |
| **UX2-06** | 🟡 | JobEditor → Progress | Phase ladder shows green "reached" dots for phases with **no date filled** (Proposal Sent, Survey, CD Phase) — green implies reached, so it's inconsistent. | Only fill/greens a phase dot once it has a date (or clarify the states). | S |

## B) Data quality / bookkeeping (🔵 — mostly Angelena in QBO / client records)

| ID | Where | Finding | Action |
|----|-------|---------|--------|
| **UX2-07** | Financial → Top invoices | **"Mickael Avedissian"** still shows as a QBO customer (person name, not a Job ID) — the known un-reconciled invoice. | Ang renames the QBO customer → `25_031_FF_Avedissian`. |
| **UX2-08** | Financial → Top expenses | **#1 expense = "Ask Client" $14,773** — an uncategorized/placeholder QBO bucket sitting as the single biggest "expense," skewing the expense picture. | Categorize those transactions in QBO. |
| **UX2-09** | Client Portal → client picker | Several client records are **named with Job IDs**, not people: `25_052_FE_Mendham`, `25_054_Malanga_Subdivide`, `26_004_Easton PA Fire Escapes` (likely auto-created on import). | Backfill real contact names on those client rows. |
| **UX2-10** | Client records | **Dunn `24_008` pair** persists — two separate client records (Craig Fritchey + Jeff Dunn) sharing job #. | Ray's parked data decision (merge vs. renumber). |

## C) Business signals (📈 — app surfaces these correctly; worth acting on)

| ID | Where | Signal |
|----|-------|--------|
| **UX2-11** | Financial → A/R | **$281,500 outstanding, $0 "current"** — everything is past due, and **$176,300 (62%) is 90+ days** across 56 invoices. A real collections story, not an app issue. |
| **UX2-12** | Dashboard → Outstanding card | Headlines **$102,500** but shows **$326,300 on completed/on-hold** underneath — the larger receivable is the secondary number. Consider whether that hierarchy matches how you read it. |

## D) Untested flows — walked in a follow-up pass (2026-07-05)

| ID | Flow | Result |
|----|------|--------|
| **UX2-13** | **New job** creation (north-star: Job ID → Drive provisioning) | ✅ **PASS — verified end-to-end.** Created a throwaway `26_999_ZZTestDelete`; the **Drive folder tree auto-provisioned** (parent + "Files Sent" subfolder id persisted to the row) and the job appeared in BMS under "Proposal Sent". Confirmed via a script (`findJobFolder` returned the folder). **Also: the New-Job drawer's Round-1 findings are FIXED** — Job-ID builder (Year/Number/Last name), "Next available: 043" auto-suggest, live ID preview + "✓ available" validation, FF toggle. **Correction to memory:** New-job creation does **not** create a QBO customer (only the Drive folder); the QBO customer is created lazily on first invoice. Throwaway fully cleaned up (row deleted + Drive folder trashed). |
| **UX2-14** | **Send to QuickBooks** invoice / **Correct Job ID** rename | ⏸️ **Not run** — these write real records to production QuickBooks (an invoice/customer) and rename a Drive folder. Deferred to avoid QBO cruft; can be exercised on a throwaway job later if you want it verified. |
| **UX2-15** | **Checksets** AI analyze / review screen | ✅ **PASS.** Job picker (`26_011_Kuhn`) → drawing-set list from Drive → **REVIEW** opened the zoom/pan sheet viewer (A.100 site plan) with the AI analysis rendered (9 SITE items: 8 Pass / 1 Review, per-item verdicts + Pass/Review/Fail override dropdowns + check-offs; model `claude-sonnet-5`). **The "flash away" tldraw regression is FIXED in prod** — sheet stayed rendered & stable past 9s. |
| **UX2-16** | **Global search** (top bar "Search jobs, clients, invoices…") | 🔴 **FAIL — see UX2-17.** |

## E) New findings from the follow-up pass

| ID | Sev | Location | Finding | Suggested fix | Effort |
|----|-----|----------|---------|---------------|--------|
| **UX2-17** | 🔴 | Top bar global search (every page) | **Non-functional.** Typing a query + Enter produces no dropdown, no results, no navigation; the DOM has a bare `<input type=search>` with no results listbox. A prominent, always-visible element that does nothing → users will try it first and hit a dead end. | Wire it to a results dropdown (jobs/clients/invoices) or remove it until built. | M |
| **UX2-18** | 🟡 | BMS phase labels / Checksets folder list | (a) Phase **display labels differ from stored values** — `potential → "Proposal Sent"`, `active → "Outgoing"`; CLAUDE.md's phase list is stale on labels (intentional relabel, not a bug — just update docs). (b) The Checksets **drawing-set list dumps the whole Drive folder** (e.g. "05.26.26 Zoom Meeting.pdf" shows among drawing sets) — same folder-noise family as UX2-01. | Refresh CLAUDE.md phase labels; optionally filter the checkset list. | S |

