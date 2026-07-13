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

- A **lead** carries a placeholder: `YY_xxx_LASTNAME` (e.g. `26_xxx_Smith`).
- The **official sequential number** is assigned when the **proposal is signed** (the job moves to
  Survey/Zoning). So a dropped lead never burns a job number.

*(Not yet built — this is the next slice. Today's New Job flow still assigns a real number up front.)*

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

1. **Lead placeholder Job IDs** + assigning the real number on proposal signing.
2. **AI-assisted `design_phase_count`** — read the signed proposal PDF (the Drive viewer already
   resolves it; the Anthropic vision pipeline already exists for Drawing QA) and **pre-fill** the
   count for staff to confirm. Decided: **suggest, don't auto-apply** — a wrong number silently
   corrupts a client's ladder and nobody would notice.
