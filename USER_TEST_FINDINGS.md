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
  milestone; the QBO "Send to QuickBooks" UI should handle both modes.
