# Set Check tab — plan & handoff

> **STATUS 2026-07-23 — Approved by Angelena. Phases 1–2 built + Phase 3a page scorer done; not deployed.**
> This is the canonical plan (same role as `DRAWING_QA.md`). What exists: migration
> `0017` is **applied** (both tables live); the tab picks a job and the three documents
> to compare (`set_check_runs`); the picker suggests a document per role (14 tests);
> **Phase 2 extraction is built + verified on real docs** (window schedule, *both*
> REScheck U-factors, targeted brochure lookup); and the **Phase 3a brochure page
> scorer** is built (`api/_lib/set-check/brochure-pages.js`, 14 tests).
> **Next:** wire the pdfjs text extraction + pdf-lib trim + cache around the scorer, add
> the staff-confirm screen, then **Phase 3b** — compare + confirm end-to-end on the pilot.
> Branch `set-check` (pushed to origin), still unmerged: **do not deploy until Phase 3 is verified.**
>
> This file is the engineering plan. The **business** side of the feature lives in
> `set-check-docs/` (copied into the repo 2026-07-21):
> - `set-check-proposal.html` — the scope + pilot + tiered-pricing + roadmap page
>   Angelena approved. Live: https://claude.ai/code/artifact/baec6eee-9cc0-4c04-99c2-d59211d707b4
> - `set-check-developer-survey.html` — the ~3-minute developer survey (mostly
>   checkboxes, build-difficulty badges) to gather what clients want built first.
>   Live: https://claude.ai/code/artifact/e3b3e12a-8856-4784-b7c2-d7091cdb9089
> - `takeoffs-model-deck.html` — **developer/investor early-look deck** (added 2026-07-22,
>   presented 2026-07-23). Interactive walkthrough of the takeoff demo (windows→Andersen
>   catalog, doors, + trim / drywall / flooring / siding as the full vision) → a single
>   build-difficulty **capability map** → a "would you use it / pay for it" close.
>   Presented from the **local file** (carries `<meta charset>`); no Artifact URL yet.
>   Demo job is now **25_049 DaSilva / 235 Munsee Way** (2026-07-23) — the real Andersen
>   400 window schedule (TW34410, TW3462, CW145, CXW15, P6045…) was pulled from
>   `260212_Permit Set.pdf` p.2 via the app's Drive broker + pdfjs; window units + sizes
>   are real (≈28 openings from the REScheck), per-type quantities are representative.
>
> Open any of these HTML files in a browser to view; all are self-contained.

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

## What it costs (measured 2026-07-21)

Measured with the token-counting endpoint at Opus pricing ($5/M input). Documents run at
a consistent **~1,700 tokens per page**, so cost tracks page count, not file size.

| Document | Size | Tokens | Per read |
|---|---|---|---|
| REScheck | 0.22 MB | 7,061 | **$0.035** |
| Permit set (window schedule) | 5.5 MB | 48,274 | **$0.24** |
| Andersen 400 brochure | 31 MB, ~250-300 pp | ~450,000 *(estimated — too large for the counting endpoint)* | **~$2.40** |

**The catalog is the whole cost.** A day of building this ran ~$13, and ~$8 of that was
putting the full 400 Series brochure through three times while developing. That is a
one-time development cost, not the run rate.

**Adding brochures does NOT scale per-job cost.** A job checks against exactly ONE window
line, so a job on the 100 Series never reads the 400 Series file. Each new brochure is a
**one-time ingest of ~$2.50, paid once ever** — ten brochures is ~$25 total, forever.

**After Phase 3a** (trim ~280 pages to ~40, cache the performance table per brochure):
schedule $0.24 + REScheck $0.04 + trimmed brochure lookup ~$0.35 + output ~$0.30 ≈
**~$0.90 per job**, against a ~$2,000 compliance fee — about 0.05% of revenue. Even
untrimmed at ~$3/job it is worth running; page-trimming is a **cost** decision as much as
a speed one, which is why it leads Phase 3.

⚠️ **Latency is real too:** the untrimmed 31MB brochure takes **~2.5 min** per run and must
go through the **Files API** (inline base64 blows the 32MB request limit). Cache the
uploaded `file_id` and the extracted result per Drive file — the library brochure is the
same file on every job, so it should be paid for once, not once per run.

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

## Data model (see `migrations/0017_set_check.sql`, **applied 2026-07-21**)

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
- **Phase 3a — Brochure ingest (DO THIS FIRST; decided with Ray 2026-07-21).** Point the
  AI at the right pages of each brochure instead of the whole catalog. Per brochure, run
  ONCE and cache: scan the text layer page by page (`pdfjs-dist` — in the repo, client-side
  today but it runs in Node), score pages on the vocabulary that marks what we need
  (`NFRC`, `U-Factor`, `SHGC`, `Rough Opening`, `Unit Dimension`, size-table headers),
  build a trimmed excerpt with `pdf-lib`, and store it with its page list.
  - ✅ **Page scorer built (2026-07-22).** `api/_lib/set-check/brochure-pages.js` — pure,
    14 tests. `scorePage(text)` → `{ score, reasons }`; `selectPages(pageTexts)` →
    `{ pages, keep, scanned }`, over-including neighbours of every strong page and
    returning `keep: []` on a text-less scan so the caller falls back to the full doc.
    Reasons feed the staff-confirm UI. **Next: wire the pdfjs text extraction + pdf-lib
    trim + cache around it, then the confirm screen.** **Deliberately
  over-include** — an extra page costs a little money, a missing page produces a wrong
  answer. Then **show staff the chosen pages for a one-click confirm before that brochure
  goes into service**, same rule as everything else here: a person confirms, the AI never
  decides. Also cache the extracted **performance table per brochure** — it is
  job-independent, so it should be paid for once, not once per job.
  - *Why not the two manual options Ray raised:* a **page-range guide** is a fragile
    artifact pointing into a versioned binary — Andersen reissues the guide, p.203 becomes
    p.211, nothing errors, and we read marketing spreads as spec tables. A **hand-trimmed
    PDF** at least stays internally consistent, but every brochure revision needs redoing
    and a stale trim fails silently. Auto-index + confirm has neither problem, and adding a
    brochure stays "drop a PDF in `Window Specs`".
  - *Known gap:* a scanned brochure with no text layer defeats the keyword scan. Fall back
    to the full document via the Files API (slow but correct), or hand-trim that one — and
    say so rather than guessing.
- **Phase 3b — Compare + confirm.** Match brochure units to schedule tags; produce a
  pass/flag per size and per U-factor; persist findings; render a report where a staffer
  confirms/overrides each (mirror Drawing QA verdicts/overrides). **Verify end-to-end on
  a completed DaSilva / Rodriguez / Costello job — the approved pilot.**
- **Phase 4 — Extend (cheap).** Exterior-door U-factor, fire-rated door rating,
  scheduled fixtures — same pipeline, new rule sets.
- **Phase 5 — Takeoffs (later, big bet).** Counts of scheduled items, then geometric
  area/linear takeoffs (revive the `takeoff-app` Python engine).
  - ⭐ **Window quantity = count each window MARK's block placements across the floor
    plans** (Ray, 2026-07-23, from the 235 Munsee demo build). RM117 places the same
    `W#` block (W1, W2…) on every plan that shows that window, so the per-type ORDER
    quantity is literally how many times that block appears. The window **schedule**
    lists each type ONCE with its Andersen unit + size but carries **no count column**;
    the **REScheck** gives a grouped opening total (235 Munsee ≈ 28) but lumps units by
    energy assembly, not by orderable unit. So neither doc alone yields per-type qty —
    the block-instance count on the plans is the real signal (a text-layer `W#` scan is
    too noisy; needs the CV/block-ref engine).
  - **Doors have no schedule** (owner-selected — the DOOR NOTES say so on 235 Munsee), so
    doors are counted generically off the plans by size, whoever supplies them.

## Deploy notes

- Work on branch **`set-check`**. **Do not deploy until Phase 3 is verified.**
- Deploy = `git push origin main` (test-gated CI). **Never** `vercel --prod`.
- The pilot is retroactive on a **completed** job — zero live-job risk.
