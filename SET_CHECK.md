# Set Check tab — plan & handoff

> **STATUS 2026-07-21 — Approved by Angelena. Scaffold only, no build yet.**
> This is the canonical plan (same role as `DRAWING_QA.md`). What exists tonight:
> the tab is registered and routes to a placeholder page, a **draft** migration is
> written (NOT applied), and this doc. No API, no AI, no real logic. Everything below
> "Build phases" is the plan to continue from — pick up at Phase 1.
>
> This file is the engineering plan. The **business** side of the feature lives in
> `set-check-docs/` (copied into the repo 2026-07-21):
> - `set-check-proposal.html` — the scope + pilot + tiered-pricing + roadmap page
>   Angelena approved. Live: https://claude.ai/code/artifact/baec6eee-9cc0-4c04-99c2-d59211d707b4
> - `set-check-developer-survey.html` — the ~3-minute developer survey (mostly
>   checkboxes, build-difficulty badges) to gather what clients want built first.
>   Live: https://claude.ai/code/artifact/e3b3e12a-8856-4784-b7c2-d7091cdb9089
>
> Open either HTML file in a browser to view; both are self-contained.

## What it is

**Set Check reads RM117's drawing SET and checks what contractors buy, submit, and
count against what we specified.** It is the sibling of Drawing QA and has the same
shape: **pick a job → pick documents from that job's Drive folder → run an AI check →
a person confirms every result.** Staff-only, inside this BMS. No new subscriptions —
it rides the Vercel + Supabase + Anthropic setup Drawing QA already uses (verified
2026-07-21).

**Windows are the first worked example.** When a developer buys their own windows, we
check the contractor's vendor brochure on exactly two attributes:

1. **Size** — the submitted unit vs the size in **our window schedule**.
2. **U-factor** — the submitted unit's U-factor vs the value **our REScheck is based on**
   (U-factor is not on the schedule; it comes out of the REScheck envelope model).

We **deliberately do not check** series / model / grille / color / operation — the
developer's choice, not ours. Narrow scope = low liability, and it holds for every item:
check only what we actually specified.

## Two capability tracks (the roadmap)

- **Compliance** — verify a bought product vs our documents. Cheap, low liability.
  Windows → exterior doors (U-factor) → fire-rated doors (rating) → scheduled fixtures.
  All reuse the same pipeline with different rules.
- **Takeoff** — count / quantify from our set. Higher value, harder, more liability.
  Counts of scheduled items first; **later** the geometric area/linear takeoffs
  (trim / siding / drywall / flooring) — that is where the shelved
  `~/Desktop/takeoff-app` CV engine (pypdfium2) comes back as a Vercel Python function.

**Tiered pricing** (set against Ray's ~$2k windows anchor): compliance ~$2,000,
+ counts ~$3,000, + area/linear ~$5,000 per project.

## Architecture (mirror Drawing QA)

| Piece | Drawing QA | Set Check |
|---|---|---|
| Frontend | `src/components/drawing-qa/` | `src/components/set-check/` (`SetCheck.jsx` entry, lazy) |
| Nav + route | `/drawing-qa` | `/set-check`, label "Set Check" (`src/rm117-app-shell-v1.jsx`) |
| API | `api/checksets/` | `api/set-check/` — **TODO** |
| Lib | `api/_lib/checksets/` | `api/_lib/set-check/` — **TODO** |
| DB | `drawing_sets` + results | `set_check_runs` + `set_check_findings` (`migrations/0017_set_check.sql`, **draft**) |
| Auth | `requireStaff` | `requireStaff` (staff-only, @rm117.com) |
| AI | `ANTHROPIC_API_KEY` (Anthropic vision) | same key, already on Vercel |

## Documents it reads (windows)

- **Window schedule** — a table on the drawings (Drive PDF) → size per tag.
- **REScheck** — separate doc → the required (max) U-factor.
- **Vendor brochure / cut sheet** — contractor-supplied → submitted size + U-factor.

Mapping a brochure unit to a schedule tag: by frame dimension / the manufacturer's
call number (e.g. Andersen `TW2842` encodes width×height). Nail this mechanic in Phase 3.

## Data model (draft — see `migrations/0017_set_check.sql`, not yet applied)

- **`set_check_runs`** — one per (job, item type, submitted document). Holds the three
  Drive file ids (bytes streamed on demand, never stored), status, creator.
- **`set_check_findings`** — one row per checked item/attribute (size, u_factor, rating):
  what we specified, what was submitted, verdict (pass/flag), and who confirmed it.

## Build phases (continue here)

- **Phase 0 — Scaffold ✅ (2026-07-21).** Tab registered → placeholder page; draft
  `0017` migration; this doc. Feature branch `set-check`, uncommitted.
- **Phase 1 — DB + read.** Apply `0017`. Build `api/set-check/runs.js` (find-or-create a
  run for a job, mirror `api/checksets/sets.js`). Reuse Drawing QA's `JobPicker`; add a
  Drive document picker for the schedule / REScheck / brochure.
- **Phase 2 — Extract.** `api/_lib/set-check/anthropic.js`: vision-read the window
  schedule (tag → size), the REScheck (U-factor), and a vendor brochure (submitted size
  + U-factor). Return structured JSON.
- **Phase 3 — Compare + confirm.** Match brochure units to schedule tags; produce a
  pass/flag per size and per U-factor; persist findings; render a report where a staffer
  confirms/overrides each (mirror Drawing QA verdicts/overrides). **Verify end-to-end on
  a completed DaSilva / Rodriguez / Costello job — the approved pilot.**
- **Phase 4 — Extend (cheap).** Exterior-door U-factor, fire-rated door rating,
  scheduled fixtures — same pipeline, new rule sets.
- **Phase 5 — Takeoffs (later, big bet).** Counts of scheduled items, then geometric
  area/linear takeoffs (revive the `takeoff-app` Python engine).

## Deploy notes

- Work on branch **`set-check`**. **Do not deploy until Phase 3 is verified.**
- Deploy = `git push origin main` (test-gated CI). **Never** `vercel --prod`.
- The pilot is retroactive on a **completed** job — zero live-job risk.
