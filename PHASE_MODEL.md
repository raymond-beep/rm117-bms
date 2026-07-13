# RM117 — Job Phase Model

**Source:** Angelena's workflow, mapped out by Ray on a hand-drawn diagram (2026-07-13), clarified
in a working session, then **revised by Angelena after she reviewed the build the same day**. This
file is the canonical record — the diagram is a photo and shouldn't be the only place this lives.

**Implemented by:** migrations `0011_phase_model.sql` + `0012_cd_split_phases.sql`.

> **Ang's revisions (after seeing it):**
> 1. **Permitting moves to In-Construction** — the Pipeline should END with the CD stage.
> 2. **Prep and Outgoing become real phases, not sub-phases** — she works the CD stage as two piles
>    she drags jobs between, so they need to be board sections. `cd_phase` no longer exists; it is
>    `cd_prep` + `cd_outgoing`. Design keeps its sub-phases (they vary per job — see below).

---

## The lifecycle

```
LEAD
  ↓
PROPOSAL SENT ─────────────→ JOB DROPPED      (proposal rejected — never started)
  ↓  (signed)
SURVEY / ZONING                                ← job gets its OFFICIAL Job ID here
  ↓
DESIGN PHASE          sub-phases: DPI · DPII · DPIII   (how many = set by the proposal)
  ↓
CD — PREP             (working on)          ─┐  two REAL phases (own board sections),
  ↓                                          │  not sub-phases: Ang drags jobs between them
CD — OUTGOING         (90% done, wrap up)   ─┘
  ↓
PERMITTING
  ↓
CONSTRUCTION                                   ← change orders live here
  ↓
COMPLETED
```

Off the main line:
- **JOB DROPPED** — the proposal was rejected; work never began. *(No contract, no revenue.)*
- **CANCELED** — a **signed** job terminated early (e.g. Gonzalez `26_042` — the contract allowed
  it and the firm kept the retainer). **Deliberately distinct from Job Dropped**: one is work you
  never won, the other is work you won and then lost, and they read very differently in a win-rate
  or a revenue view.
- **ON HOLD** — paused, will resume.

---

## Sub-phases

Two phases are split internally **so Angelena can manage workload**. They are a staff tool.

**Only Design has sub-phases.**

| Phase | Sub-phases | Meaning |
|---|---|---|
| `design_phase` | `dp1` `dp2` `dp3` → **DPI / DPII / DPIII** | Design iterations. **How many varies per job** — the proposal specifies it (`jobs.design_phase_count`, 1–3). *This* is why they stay sub-phases: a varying count can't be a fixed set of board sections. |

**CD is NOT a sub-phase split — it is two real phases** (`cd_prep`, `cd_outgoing`). Ang works them
as two piles and drags jobs between them, which is what a board section is for.

> ⚠️ **Two retirements.** `active` was never a real phase — it was CD's wrap-up stage under a
> misleading name (`0011`). Then `cd_phase` itself was retired (`0012`), split into `cd_prep` +
> `cd_outgoing`. Live jobs were remapped by both migrations.

### Clients never see sub-phases
The portal shows plain-English phases only. A client doesn't need to know their drawings are "90%
done" — it only invites *"so where's my set?"*. Nor do they need "CD" (reads as a compact disc) or
"Outgoing" (means nothing to a homeowner).

| Staff (BMS) | Client (portal) |
|---|---|
| Proposal Sent | Proposal |
| Survey + Zoning Analysis + Schematics | Survey / Zoning |
| Design Phase (DPII) | Design |
| CD — Prep *or* CD — Outgoing | Construction Drawings *(one step — the split is invisible)* |
| Permitting | Permitting |
| Construction | Construction |
| Completed | Complete |

---

## Board tabs

The BMS board is the **Pipeline**. Leads and construction get their own tabs so they can be
organised without cluttering live design work.

| Tab | Phases |
|---|---|
| **Job Leads** | Lead · Proposal Sent · Job Dropped |
| **Pipeline** *(the working board)* | CD—Outgoing · CD—Prep · Design · Survey/Zoning · On Hold |
| **In-Construction** | Permitting · Construction · Completed · Canceled |

**The Pipeline ends with the CD stage** (Ang). Once drawings go out the door, the job is permitting
/ construction work and belongs in its own tab.

---

## Aging flags

Angelena's two rules, surfaced as a **flag on the job card** + a stalled count on the board:

| Phase | Limit | Rationale |
|---|---|---|
| Proposal Sent | **14 days** | How long a client has sat on a proposal without signing. |
| CD — Prep | **21 days** | "No longer than 3 weeks" — straight from the diagram. |
| CD — Outgoing | **21 days** | Same rule, applied to the second half. |

> ⚠️ **Splitting CD gave each half its own clock** — moving a job Prep → Outgoing restarts the 21
> days, so a job could spend 3 weeks in each without ever flagging. That follows "no longer than 3
> weeks *in this phase*" as drawn, but tighten the numbers if it proves too loose in practice.

Measured from `jobs.phase_since` (stamped on every phase change; backfilled by `0011` from the
phase-event log).

**A flag, never an email.** Ray's explicit call: an automatic client-facing email fired by a phase
change is unrecallable, and phase changes get made for bookkeeping reasons all the time. One bad
batch teaches clients to ignore the emails, which destroys the point.

---

## Job ID lifecycle

**BUILT 2026-07-13.**

- A **lead** carries a placeholder: `YY_xxx_LASTNAME` (e.g. `26_xxx_Smith`). `xxx` is a legal Job ID
  (`JOB_ID_RE` accepts it), but a placeholder job is **never given a Drive folder or a QBO customer**
  — both are named after the Job ID, so provisioning them early would just mean renaming them later.
  The QBO endpoints hard-refuse a placeholder (409).
- **Un-numbered phases:** `lead`, `potential` (Proposal Sent), `job_dropped`. A job may sit in these
  with no number. **Moving it OUT of them is the signing event** → `assignOfficialJobId()`
  (`api/_lib/job-number.js`) fires from `api/jobs/update.js` and:
  1. picks the next free number for the year, checking **both** the app DB and Drive (jobs are still
     filed in Drive by hand, so the DB alone lags and would re-use a number);
  2. renames `jobs.job_id` — every child row follows via `ON UPDATE CASCADE` (migration `0007`);
  3. provisions the Drive folder tree under the **real** id.
- The rename is **not** best-effort: a job that advanced without a number would be invisible to
  QuickBooks and Drive, both of which key off the Job ID. It throws and the save fails.
- The UI says so out loud — the New Job drawer disables the number field for an unwon job, and the
  board shows *"Proposal signed — 26_xxx_Smith is now 26_043_Smith. Drive folder created."* A Job ID
  changing itself silently would be alarming.
- **Verified end-to-end against live data:** a retainer logged against `99_xxx_ZZTestDelete` followed
  the rename to `99_001_ZZTestDelete`, no orphans, Drive folder created under the real id and named
  correctly; all artifacts cleaned up.

---

## Where this is encoded (keep in sync)

| Place | What |
|---|---|
| `api/_lib/db.js` | `PHASES`, `SUB_PHASES`, `isValidSubPhase()` |
| `src/lib/format.js` | `PHASE_LABELS`, `PHASE_ORDER`, `PHASE_LADDER`, `PIPELINE_PHASES`, `BOARD_TABS`, `SUB_PHASE*`, `PHASE_AGE_LIMITS`, `isStalled()` |
| `supabase/migrations/0011_phase_model.sql` | `jobs.phase`, `jobs.sub_phase`, `field_notes.phase` CHECK constraints + `design_phase_count` range |
| `src/rm117-portal-v1.jsx` | the **client-facing** `LADDER` (plain English, no sub-phases) |

`tests/phase-model.test.js` asserts the first three agree — including that every phase has a label,
sits in exactly one board tab, and that no sub-phase can be attached to the wrong phase.

---

## Still to build

1. **AI-assisted `design_phase_count`** — read the signed proposal PDF (the Drive viewer already
   resolves it; the Anthropic vision pipeline already exists for Drawing QA) and **pre-fill** the
   count for staff to confirm. Decided: **suggest, don't auto-apply** — a wrong number silently
   corrupts a client's ladder and nobody would notice.
