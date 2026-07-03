# Drawing QA tab — status & handoff

The **Drawing QA** tab folds the standalone Checksets drawing-set QA/QC app into this BMS. Reviewers
pick a job → pick a checkset PDF from that job's Google Drive **Checksets** folder → analyze each
sheet against the firm checklist (`api/_lib/checksets/CHECKS.md`, Anthropic vision) + mark it up with
tldraw → (Phase C) save the reviewed PDF back to the job's Checksets folder.

**On branch `drawing-qa-merge` only — NOT on `main`.** Do not merge to `main` until Phase C is done
and Ray signs off; `main` auto-deploys to production.

## Status (2026-07-03)
- **Phase A ✅** — Drawing QA tab: job dropdown + browse/stream a job's Drive Checksets PDFs.
- **Phase B ✅** — the full review engine ported in (analyze, verdicts/overrides, check-offs, set
  overview, "Analyze all" batch, mis-typed escape hatch, tldraw markup, instant page nav). Verified
  live end-to-end on `26_011_Kuhn` / Permit Set 04.pdf.
- **Phase C ▶ next** — Drive export: flatten markup onto the PDF (`pdf-lib`) → `uploadToFolder` into
  the job's Checksets folder. **Prereq:** the Drive service account must be **Content manager** on the
  Shared Drive (writes 403 until then — same gate as letters/proposals delivery).

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
