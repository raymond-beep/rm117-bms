# Set Check tab — plan & handoff

> **STATUS 2026-07-21 — Approved by Angelena. Phase 1 built; not deployed.**
> This is the canonical plan (same role as `DRAWING_QA.md`). What exists: migration
> `0017` is **applied** (both tables live), the tab picks a job and the three
> documents to compare (saved on a `set_check_runs` row), and the picker suggests a
> document per role. No AI and no comparison yet — pick up at **Phase 2**.
> Branch `set-check`, still unmerged: **do not deploy until Phase 3 is verified.**
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

## What the documents taught us (Phase 2, verified 2026-07-21)

Run against real files, not assumptions. Four things changed the design:

1. **A brochure has no per-unit U-factor.** The Andersen 400 catalog's size tables carry
   model numbers and dimensions only; U-factors live in separate NFRC tables organised by
   **product type × glazing package** (pp. 201-206). "The U-factor of a TW2842" is not a
   question the document answers — "the U-factor of a tilt-wash double-hung with this
   glazing" is.
2. **A catalog has hundreds of sizes**, and asking for all of them returns a
   "representative sample". A sample is worse than useless: a size missing from a partial
   list reads as *not offered* and flags a window that is fine. So `lookupBrochure` is a
   **targeted lookup** — it takes the tags OUR schedule uses and asks about only those.
3. **REScheck states two different U-factors** and conflating them loses the finding that
   matters: the **proposed** value the run was built on (DaSilva: `0.250`) and the **code
   maximum** (`0.300`). A window at 0.28 passes code but invalidates the REScheck we
   submitted. Both are extracted.
4. **Catalog sizes are quoted as both window dimension and rough opening**, and our
   schedules mix them. This is the main source of false mismatches; the prompt makes the
   model say which it matched on.

**A real result, DaSilva vs Andersen 400** (the pilot, end-to-end): all 4 tags checked are
offered, but the line's **worst-case U-factor is 0.31** (tilt-wash double-hung) against a
REScheck built on **0.25** — so the 400 Series only complies on the upgraded glazing
packages, not plain Low-E4. That is exactly the catch the feature is for, and it is a
*pre-purchase* answer.

⚠️ **Cost/latency is real:** the 31MB brochure takes **~2.5 min** and must go through the
**Files API** (inline base64 blows the 32MB request limit). Phase 3 should cache the
uploaded `file_id` and the extracted result per Drive file — the library brochure is the
same file on every job, so this should be paid once, not once per run.

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
| API | `api/checksets/` | `api/set-check/` — `runs.js` (find-or-create + the 3 picks), `files.js` (list/stream the job's Drive PDFs) |
| Lib | `api/_lib/checksets/` | `api/_lib/set-check/` — `doc-roles.js` (which PDF is which; pure + tested) |
| DB | `drawing_sets` + results | `set_check_runs` + `set_check_findings` (`migrations/0017_set_check.sql`, **applied 2026-07-21**) |
| Auth | `requireStaff` | `requireStaff` (staff-only, @rm117.com) |
| AI | `ANTHROPIC_API_KEY` (Anthropic vision) | same key, already on Vercel |

## Documents it reads (windows)

- **Window schedule** — a table on the drawings (Drive PDF) → size per tag.
- **REScheck** — separate doc → the required (max) U-factor.
- **Vendor brochure / cut sheet** — contractor-supplied → submitted size + U-factor.

**⭐ The three live in DIFFERENT subfolders, which is why the picker spans the job's
whole Drive tree** instead of resolving one named folder the way Drawing QA resolves
"Checksets" (`listJobFolderTree` in `api/_lib/google-drive.js`). Probed against real
jobs 2026-07-21:

- REScheck → **Files Sent**. Spelling is inconsistent in the wild (`ResCheck`,
  `Rescheck`, `REScheck`, `260105_Rescheck.pdf`), so match on `/res\s?check/`, never
  an exact name. Some jobs have **two** — take the most recent.
- Window schedule → the issued drawing set, in **Files Sent** or **Checksets**. The
  Checksets folder also holds `TD MARKUPS` and `Prelim` copies; those are working
  copies, and checking windows against a superseded set is the failure mode, so the
  scorer prefers `conformed` / `permit set` and penalises `markup` / `prelim`.
- Brochure → filed under **Reference** at least as often as Files Received
  (`24_010_FF_Kelly-Edleman/Reference/Andersen Windows 400 Series Brochure.pdf`).

**Files Received is a general inbound pile, not a submittals folder** — it holds
`survey.pdf`, `Client Comments_06_20_25.pdf`, `422579-Zoning_Denial.pdf`. An early
rule qualified a submittal on that folder alone and suggested each of those as the
window brochure. Direction is now only a **boost**; a submittal must look like one by
name (manufacturer, or brochure/cut sheet/submittal). Empty is better than wrong here.

⚠️ **Of the pilot jobs probed, none had a contractor window submittal in Drive at all.**
The compliance check has no input until one is filed — worth confirming with Ang how
brochures reach the office (email attachment?) before Phase 3's end-to-end test.

Mapping a brochure unit to a schedule tag: by frame dimension / the manufacturer's
call number (e.g. Andersen `TW2842` encodes width×height). Nail this mechanic in Phase 3.

## Data model (draft — see `migrations/0017_set_check.sql`, not yet applied)

- **`set_check_runs`** — one per (job, item type, submitted document). Holds the three
  Drive file ids (bytes streamed on demand, never stored), status, creator.
- **`set_check_findings`** — one row per checked item/attribute (size, u_factor, rating):
  what we specified, what was submitted, verdict (pass/flag), and who confirmed it.

## Build phases (continue here)

- **Phase 0 — Scaffold ✅ (2026-07-21).** Tab registered → placeholder page; draft
  `0017` migration; this doc.
- **Phase 1 — DB + read ✅ (2026-07-21).** `0017` applied. `api/set-check/runs.js`
  (find-or-create the job's open run; PATCH the three picks) + `api/set-check/files.js`
  (the job's Drive PDFs across its whole tree; streams one, validated to that tree).
  `JobPicker` extracted from Drawing QA → `src/components/ui/JobPicker.jsx` and reused.
  Role suggestions in `api/_lib/set-check/doc-roles.js` (pure, 14 tests) — verified
  against 5 real jobs. **The run is found-or-created only while it is still open**; a
  `confirmed` run is a record of what was checked, so reopening starts a fresh one.
- **Phase 2 — Extract ✅ (2026-07-21).** `api/_lib/set-check/extract.js` —
  `extractWindowSchedule` (tag → size, + manufacturer/series when the set states them),
  `extractRescheck` (**both** U-factors, see below), `lookupBrochure`. Opus by default
  (`SET_CHECK_MODEL`), adaptive thinking, structured outputs, refusal retry, always
  streamed. **Verified on real documents** — see "What the documents taught us".
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
