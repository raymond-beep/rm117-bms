# Drawing QA tab — status & handoff

The **Drawing QA** tab folds the standalone Checksets drawing-set QA/QC app into this BMS. Reviewers
pick a job → pick a checkset PDF from that job's Google Drive **Checksets** folder → analyze each
sheet against the firm checklist (`api/_lib/checksets/CHECKS.md`, Anthropic vision) + mark it up with
tldraw → (Phase C) save the reviewed PDF back to the job's Checksets folder.

**On branch `drawing-qa-merge` only — NOT on `main`.** Do not merge to `main` until Phase C is done
and Ray signs off; `main` auto-deploys to production.

## Status (2026-07-04)
- **Phase A ✅** — Drawing QA tab: job dropdown + browse/stream a job's Drive Checksets PDFs.
- **Phase B ✅** — the full review engine ported in (analyze, verdicts/overrides, check-offs, set
  overview, "Analyze all" batch, mis-typed escape hatch, tldraw markup, instant page nav). Verified
  live end-to-end on `26_011_Kuhn` / Permit Set 04.pdf.
- **Phase C ✅ DONE & verified end-to-end** (commit `5639ead`) — Drive export: flatten markup onto the
  PDF (`pdf-lib`) → `uploadToFolder` into the job's Checksets folder. Rotation-aware stamping (handles a
  set's mixed `/Rotate` pages, e.g. a rotated cover sheet). **Verified live in-browser (2026-07-04):**
  opened `26_011_Kuhn` / Permit Set 04.pdf → drew an X on the 270° cover (A.100) → "Export to Drive" →
  `Permit Set 04 — QA 2026-07-04.pdf` landed in the Checksets folder; rendering its page 1 confirmed the
  X + existing diagonal baked in at the correct position/orientation with the original drawing intact.
  See "Export flow" + "How it was verified" below.
  - **⭐ Drive write gate CONFIRMED OPEN (2026-07-04):** the service account
    (`rm117-sheets-reader@…`) now has **Content manager** on the Shared Drive — proven with a live
    upload+trash into `26_011_Kuhn`'s Checksets folder. This also **unblocks the BMS's own
    letters/proposals Drive delivery** (same gate), which was the other thing waiting on it.

## Export flow (Phase C)
1. `ReviewClient` "⤓ Export to Drive" → `GET /api/checksets/markup?setId=&all=1` (every page's shapes).
2. Marked pages only → `MarkupExporter.jsx` (off-screen tldraw) rasterizes each to a **transparent,
   page-box-aligned PNG** (`toImageDataUrl`, `background:false`, `bounds = (0,0,pageW,pageH)`) — so the
   original PDF vectors stay crisp and only ink is stamped.
3. `POST /api/checksets/export { setId, pages:[{page, pngBase64}] }` → `downloadFileBytes` the source
   PDF → `pdf-lib` `stampFullPage` (rotation-aware) over each marked page → `uploadToFolder(
   resolveChecksetsFolderId(job), …)` named `"<original> — QA <YYYY-MM-DD>.pdf"`.

## How it was verified (server side, 2026-07-04)
- Live Drive upload+trash into the real Checksets folder → **write works** (Content-manager confirmed).
- `stampFullPage` run through synthetic corner-marks (magenta top-left, cyan bottom-right) on the **270°
  cover sheet** and a **0° sheet**, then rendered with pdf.js and pixel-sampled → marks land in the
  correct visible corners/orientation on **both**. (`@napi-rs/canvas` for the raster check.)
- `npm run vercel-build` (vitest + vite build) green.
- **Full in-browser round trip (2026-07-04):** real tldraw markup on the 270° cover → client raster →
  server stamp → Drive upload → re-downloaded + rendered page 1 = marks correct, original intact. ✅

## Remaining before merge to `main`
- ~~Add `ANTHROPIC_API_KEY` to Vercel env~~ ✅ **DONE (2026-07-04)** — set for **Production** + Preview
  (branch `drawing-qa-merge`) on project `rm117-bms`. (The v54.6.1 CLI won't set "all Preview branches"
  non-interactively; toggle in the dashboard if you want it global like the other secrets.)
- ~~Confirm `api/_lib/checksets/CHECKS.md` bundles with the functions~~ ✅ **VERIFIED (2026-07-04)** — ran
  the real `@vercel/nft` tracer (the one the Vercel build uses) against `analyze.js`, `results.js`,
  `overview.js`; **all three include `CHECKS.md`**. The `fs.readFileSync(path.join(path.dirname(
  fileURLToPath(import.meta.url)), 'CHECKS.md'))` pattern is detected — no `includeFiles`/inlining needed.
- **→ `drawing-qa-merge` is ready to merge to `main`** (auto-deploys). Leftover test export was trashed.

## Where things live
- Frontend: `src/components/drawing-qa/*.jsx` (+ `tailwind.css`, utilities-only). Route/nav in
  `src/rm117-app-shell-v1.jsx` (`/drawing-qa`).
- API: `api/checksets/*.js` (sets, analyze, results, markup, overview) + `api/jobs/checkset-files.js`
  (Drive list/stream) + `resolveChecksetsFolderId` in `api/_lib/google-drive.js`. All in `server.js`.
- Shared libs: `api/_lib/checksets/` (checklist + CHECKS.md, naming, anthropic). Reuses `getDb()` +
  `requireStaff()`.
- DB (shared Supabase `mgyebrgdjkxojawmfeyx`): Checksets tables already existed; migration
  `checksets_drive_source` added `drawing_sets.drive_file_id` + made `file_path` nullable.
- Env: needs `ANTHROPIC_API_KEY` (in local `.env`; add to Vercel before any deploy). Optional
  `ANTHROPIC_MODEL` (default `claude-sonnet-5`).
- Deps added: `@anthropic-ai/sdk`, `pdfjs-dist`, `tldraw` (+ dev `tailwindcss`/`postcss`/`autoprefixer`).

## Deploy-time TODO (before merging to main)
- Add `ANTHROPIC_API_KEY` to Vercel env.
- Confirm `api/_lib/checksets/CHECKS.md` is bundled with the `api/checksets/*` functions on Vercel
  (read via `import.meta.url`; verify the file trace includes it, else inline the checklist).
- Grant the Drive service account **Content manager** for Phase C export.

**Canonical plan (full port map, decisions, phases): `MERGE_PLAN.md` in the Checksets repo**
(`~/Desktop/Checksets App/files/MERGE_PLAN.md`).
