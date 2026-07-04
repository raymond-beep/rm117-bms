# Drawing QA tab — status & handoff

> **⚠️ UPDATE 2026-07-04 (eve): tldraw markup REMOVED — Drawing QA is now a pure AI-review tool.**
> tldraw SDK 4.0+ requires a **paid production license** ($6k/yr, no cheap tier); without a key it
> removes its canvas ~5s after mount on any non-localhost HTTPS domain. That was the "sheet renders
> then flashes away" bug — it never showed in localhost dev, only in production. Ray chose to drop
> markup rather than pay/relicense. The sheet is now shown in a zoomable/pannable **`PageViewer`**
> (`react-zoom-pan-pinch`, MIT). Removed: `MarkupOverlay`, `MarkupExporter`, `markup.js`, the
> "Export to Drive" button, and markup save/load. The server `markup`/`export` APIs + `markup` table
> are **dormant** (kept, harmless) so drawing could return later on a free lib (`perfect-freehand`).
> Everything AI (analyze, checklist, overrides, check-offs, overview, batch) is unchanged. The
> sections below describing tldraw markup / Phase C export are **historical**.

The **Drawing QA** tab folds the standalone Checksets drawing-set QA/QC app into this BMS. Reviewers
pick a job → pick a checkset PDF from that job's Google Drive **Checksets** folder → analyze each
sheet against the firm checklist (`api/_lib/checksets/CHECKS.md`, Anthropic vision). *(Formerly: mark
it up with tldraw → save the reviewed PDF back to Drive — removed, see the update note above.)*

**✅ MERGED TO `main` & LIVE IN PRODUCTION (2026-07-04)** — Phases A–C shipped via merge commit
`6c907d7` (feature branch `drawing-qa-merge`); prod deploy Ready, `rm117-bms.vercel.app` serving 200.
Deploy prereqs cleared beforehand: `ANTHROPIC_API_KEY` on Vercel + `CHECKS.md` bundling confirmed.

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

## Post-launch refinements (2026-07-04, shipped to `main`)
- **Searchable job picker** (`JobPicker` in `DrawingQA.jsx`, commit `e42a02d`): replaced the long native
  `<select>` with a type-to-search combobox — filters by Job ID **or** client name, keyboard nav
  (↑/↓/Enter/Esc). Styles: `.dqa-combo*` in `styles.css`.
- **Theme-consistent review chrome** (commit `e42a02d`): the review screen now follows the app theme
  (light + dark). Root cause it was "a separate app": the ported components use a **utilities-only
  Tailwind (no preflight)**, so bare `<button>`/`<input>` fell back to the browser's light control
  backgrounds. Fix = a scoped **`.dqa-review`** CSS layer in `styles.css` that resets those controls and
  remaps the ported Tailwind utilities to the app's CSS variables (accent for primary actions; semantic
  green/amber/red for verdicts). The **tldraw canvas keeps its own surface** (intended). The overlay
  wrapper carries the `dqa-review` class (`DrawingQA.jsx`).
- **Clear loading state** (commit `ec5e08f`): the canvas showed only a faint corner "Rendering sheet…".
  Replaced with a centered, theme-aware **spinner + phase label** (`.dqa-loading`/`.dqa-spinner`):
  "Loading drawing from Drive…" while streaming, "Rendering sheet…" while rasterizing.
- **"White screen" — diagnosed, not a bug.** Reproduced on `26_024_Costello_77 Benjamin St_260702.pdf`:
  the **Drive stream took ~5s** (variable Google-Drive streaming latency through the staff proxy; *not*
  size-correlated). The PDF renders in ~0.4s server-side. The old faint text was invisible in dark
  themes, so a slow fetch looked blank/broken. The loading state above fixes the perception; a future
  speedup lever is caching streamed PDFs. Safety nets also added: a **`ReviewErrorBoundary`** (a real
  crash now shows a message + "Back to files", not a dead screen) + a **pdf.js guard** against NaN/0 page
  dimensions.

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
- Frontend: `src/components/drawing-qa/*.jsx` — `DrawingQA` (job `JobPicker` + file list),
  `ReviewClient`, `MarkupOverlay`, `MarkupExporter`, `ChecklistSidebar`, `SetOverview`,
  `BatchAnalyzeButton` (+ `pdf.js`, `markup.js`, `tailwind.css` utilities-only). Review-chrome theme +
  picker + loader styles live in **`src/styles.css`** (`.dqa-review*`, `.dqa-combo*`, `.dqa-loading*`).
  Route/nav in `src/rm117-app-shell-v1.jsx` (`/drawing-qa`).
- API: `api/checksets/*.js` (sets, analyze, results, markup, overview) + `api/jobs/checkset-files.js`
  (Drive list/stream) + `resolveChecksetsFolderId` in `api/_lib/google-drive.js`. All in `server.js`.
- Shared libs: `api/_lib/checksets/` (checklist + CHECKS.md, naming, anthropic). Reuses `getDb()` +
  `requireStaff()`.
- DB (shared Supabase `mgyebrgdjkxojawmfeyx`): Checksets tables already existed; migration
  `checksets_drive_source` added `drawing_sets.drive_file_id` + made `file_path` nullable.
- Env: needs `ANTHROPIC_API_KEY` (in local `.env`; add to Vercel before any deploy). Optional
  `ANTHROPIC_MODEL` (default `claude-sonnet-5`).
- Deps added: `@anthropic-ai/sdk`, `pdfjs-dist`, `tldraw` (+ dev `tailwindcss`/`postcss`/`autoprefixer`).

## Deploy config (all done 2026-07-04)
- ✅ `ANTHROPIC_API_KEY` on Vercel (Production + Preview `drawing-qa-merge`).
- ✅ `CHECKS.md` bundling verified via `@vercel/nft`.
- ✅ Drive service account is **Content manager** on the Shared Drive (Phase C export works).
- Deploys are the normal BMS flow now: `git push origin main` (test-gated) → prod.

**Canonical plan (full port map, decisions, phases): `MERGE_PLAN.md` in the Checksets repo**
(`~/Desktop/Checksets App/files/MERGE_PLAN.md`).
