# RM117 BMS — Next Session Start Here
**Last updated:** 2026-06-28 (end of session)

## ⭐ START HERE NEXT (planned 2026-06-28 for the next session)
- **Repo state:** clean + in sync with origin. Live = commit `704a93a` (latest). Workflow = `git push origin main`
  (test gate runs 50 Vitest, then auto-deploys). Everything below this session is shipped + verified live.
- **▶ PRIMARY TASK — QuickBooks two-way sync, Intuit production unlock.** A full step-by-step plan + checklist
  lives in **`QBO_INTUIT_PLAN.md`** (read it first). The immediate, do-able piece (small Claude budget, no Intuit
  creds needed): **draft the EULA + Privacy Policy** as `public/privacy.html` + `public/terms.html` — Ray confirmed
  he has **neither** today, and Intuit's production checklist requires both as public URLs. Before drafting, Claude
  needs the answers in the plan's "What Claude needs to generate the legal docs" section (entity name, contact
  email, internal-only?, sub-processor disclosure OK). The big sync **build** (Phase E) is gated on Intuit creds —
  save it for a fresh budget.
- **▶ QUEUED (Ray asked to do next session) — New-job creation quick wins.** From the user-test pass (see
  **`USER_TEST_FINDINGS.md`** §1): build the **Job-ID builder** (auto-suggest next free `NNN` for the year +
  assemble `YY_NNN_[FF_]LastName` from parts) + **live format validation/preview** in `NewJobDrawer.jsx`.
  Self-contained, no schema change, no one else needed — good first build of the session. Follow-on:
  **link a new job to a client record** (`client_id` is null today; offer pick-existing-or-create + optional
  referrer) — **DECIDED (Ray 2026-06-28): client-linking is OPTIONAL** (don't force it).
- **OTHER THINGS Ray can also work on (not blocked):**
  - Review/sign-off on letter + proposal output with **Angelena** (Ray already eyeballed; her review is the last gate).
  - More user-test backlog in `USER_TEST_FINDINGS.md`: "Sent documents view + un-send" (also the document half of an
    "editable staff portal"); table "Last comm" column truncation; dedupe the two New-Job buttons / two Portal nav entries.
  - **DECIDED (portal):** build the **staff-only "manage client docs + comms" view FIRST**, with the intention of a
    **client-facing portal later**. Ray likes viewing the portal on the firm's end but wants an **easier way to
    organize everything** — so the staff view should prioritize organization/management, not just mirror the client view.
  - **DECIDED (billing):** invoices support **BOTH per-job (pay in full) AND per-milestone** — some clients pay the
    whole bill, some pay per milestone. Design the QBO "Send to QuickBooks" UI to handle both modes.
  - Field Notes site-report polish, or anything from `ROADMAP.md` (website redesign, etc.).
- **Blocked / parked:** QBO two-way sync **build** (Intuit prod creds — see `QBO_INTUIT_PLAN.md`), Clerk dev→prod
  (pre-launch), portal-via-Wix (DNS).
- **What shipped 2026-06-28 — Drive delivery + proposal/letter formatting (all SHIPPED + LIVE):**
  - **"Send to Drive"** (commit `2d0e5a4`): staff-gated `api/deliver.js` files a generated letter→**Files Sent** /
    proposal→**Proposal** Drive folder + logs to `file_records`. Drive SA is now **Content manager** (write works,
    create-only scope `drive.readonly`+`drive.file`). Migration `0005` applied. **Production-verified** via a real
    UI send on job `26_042_Gonzalez` (PDF landed + row written; cleaned up). Filenames
    `Building Department Letter MM.DD.YY.pdf` / `Proposal MM.DD.YY.pdf` (`dotDate`), no-overwrite ` (2)` suffix.
  - **Proposal/letter PDF formatting** (commit `704a93a`): matched the firm's 3 sample proposals — **letterhead on
    every page**, **signatures kept together**, **fee titles underlined + exclusion titles bold** (new `richText`
    inline writer), **two-column deliverables**, tightened spacing → **3-page** proposal. Verified vs the Knapp
    sample. 50 tests green. (Caveat for a future "unsend": hand-deleting a delivered Drive PDF leaves a stale
    `file_records` row.)
- **(archived) What shipped earlier 2026-06-28 — "Send to Drive" delivery detail:**
  - `api/_lib/google-drive.js`: scope widened to `drive.readonly` + `drive.file` (least-privilege read + create-only
    write — **cannot edit/delete existing firm files**); added `uploadToFolder()` (create-only) + generalized
    `resolveSubfolderId` → `resolveFilesSentFolderId` / `resolveProposalFolderId`.
  - New staff-gated **`api/deliver.js`** (POST `{jobId, kind:'letter'|'proposal', filename, pdf(base64)}` → resolve
    folder → upload → log to `file_records`; 409 if subfolder missing, 502 if Drive denies). Migration `0005`.
  - **"Send to Files Sent" (letter) / "Send to Proposal folder" (proposal) buttons** in both generators (enabled only
    when a job is selected; reuse last-built bytes via a `lastBytes` ref). Shared `src/lib/deliver.js` helper
    (`deliverPdf`) + `bytesToBase64` in `doc-assets.js`.
  - **Filenames (Ray's convention):** clean, date-stamped from the doc's own date — letters
    `Building Department Letter MM.DD.YY.pdf`, proposals `Proposal MM.DD.YY.pdf` (`dotDate` in `doc-format.js`,
    +2 tests). **No overwrite:** a same-name file gets a ` (2)` suffix.
  - **Routing (Ray):** letters → job's **Files Sent**; proposals → job's **Proposal** folder (kept separate; the
    portal vault reads only Files Sent, fine since the portal isn't live).
  - **Verified end-to-end** against job `26_042_Gonzalez`: real letter PDF landed in Files Sent as
    `Building Department Letter 06.28.26.pdf`, `file_records` row written, then all test artifacts cleaned up
    (folder left with only the real `Design iterations 01.pdf`). **Note:** deleting a delivered PDF by hand in Drive
    leaves a stale `file_records` row — a future "unsend" should delete the row too.

---

## ▶ RESUME HERE — 2026-06-27 (latest) — Both generators have Save; Drive "Files Sent" is the next layer

**Letter persistence added (mirrors proposals).** `api/letters.js` (staff-gated GET list/GET ?id/POST/DELETE) +
`letters` table (migration `0004`: id, job_id nullable FK, content jsonb, created_at, updated_at; RLS on,
service-role bypasses). `LetterGenerator` now has Open saved…/New/Save/Delete. Registered in `server.js`. 48 tests.

**KEY DECISION captured — two distinct layers (don't conflate):**
1. **Save (DB, fields-only)** = the *editable recipe* (reopen/revise/regenerate). DONE for both letter + proposal.
   Stored in `letters.content` / `proposals.content` jsonb. Tiny text, no extra cost. Attachments NOT saved.
2. **"Send to Files Sent" (Google Drive)** = the *delivered PDF artifact*, filed in the job's Drive "Files Sent"
   folder (the same one the client-portal Documents vault reads). **NOT BUILT — blocked on Drive WRITE access.**
   - `api/_lib/google-drive.js` is **`drive.readonly`** today (reads vault for portal; can't write).
   - To enable: broaden the service-account Drive scope (e.g. add `drive.file`/`drive`) **+ grant the service
     account content-writer on the shared drive** (Ray-action in Google Cloud/Drive). Then add a "Send to Files
     Sent" button to both generators that uploads the generated PDF to `resolveFilesSentFolderId(jobId)` and
     records it in `file_records` (folder=files_sent, direction=to_client).
   - Caveat: Files-Sent is **per-job**; a **proposal can precede a job** (no folder) → DB fields-save still needed.
   - Portal itself still deferred, but the Drive "Files Sent" folder is already the firm's real filing location.
   - Ray chose: do letters Save now (done), pursue Drive delivery later once he enables write access.

---

## ▶ RESUME HERE — 2026-06-27 (latest) — Proposal generator SHIPPED; next = persistence + AI

**Proposal generator built + live** (`/templates/proposal`, `ProposalGenerator.jsx` + `src/lib/proposal-pdf.js`).
Assembled PDF reusing the shared engine. ~70% boilerplate baked verbatim into the renderer from the 3
samples (scope phases + deliverables, 10 exclusions, payment/meeting notes, binding clause, footer
`M/D/YYYY Proposal`); user fills only the variables.
- **Form fields:** job picker (prefills client/address/title/greeting); date + label (Proposal/Revised);
  title; project type + address; Re:; Attn; greeting; intro; project summary; **scope phase toggles**
  (Survey/Design/CD/CA) + # design meetings; **fee schedule** (per-phase include + amount, total auto-computed,
  amounts→words via `dollarsToWords`); optional **additional services**; **client signer(s)** (firm signers
  Thomas Dores RA + Angelena Hreczny auto-appended); attachments (images / reference PDF, reorder).
- **Shared refactor:** `src/lib/pdf-doc.js` (PAGE geometry, `drawLetterhead`, `embedLogo`, `appendAttachments`,
  `makeWriter` cursor/paginator) now used by BOTH letter + proposal — letterhead/logo stay identical. Logo +
  image helpers moved to `src/lib/doc-assets.js`. `pdf-lib` is in a shared lazy chunk (~436 kB; initial bundle
  unchanged at 327 kB). Helpers added to `doc-format.js`: `numericDate`, `dollarsToWords`. **48 tests green.**
- **Scope of services is now FULLY EDITABLE** (Ray's request 2026-06-27): each phase has an editable title +
  description + deliverables (one bullet per line) seeded from the standard set; add/remove/exclude phases.
  The PDF formats them identically (numbered phase + "Deliverables:" roman list). Dropped the fixed phase
  toggles + meetings field.
- **AI auto-fill = DROPPED for now** (Ang doesn't want to pay for an API key just for proposals; the editable
  scope removes the need). Revisit only if they ask. No `anthropic` dep added.
- **Persistence DONE (fields-only).** `api/proposals.js` (staff-gated GET list / GET ?id / POST create+update /
  DELETE) saves the form state into `proposals.content` jsonb — no files, no extra cost (Supabase Pro, tiny text
  rows). Migration `0003`: `job_id` made nullable (proposals precede jobs) + added `updated_at`. Editor has
  **Open saved… / New / Save / Delete** + a status field (draft|sent|signed). Attachments are NOT persisted
  (re-add on reopen; the PDF regenerates from saved fields). Registered in `server.js`.
- **Ray (+ Ang) to review the proposal output** against the 3 samples (KUHN/Knapp/Troy) and flag tweaks.

---

## ▶ (DONE) Building-Dept Letter generator — assembled-PDF + real logo

---

## ▶ RESUME HERE — 2026-06-27 (latest) — Templates started: Letter DONE (assembled PDF), Proposal NEXT

**Building-department letter generator shipped, then refined per Ray's feedback to a real assembled PDF
(`pdf-lib`).** Read the 6 sample PDFs in `~/Downloads` (3 letters + 3 proposals) to extract the format.
- **`/templates`** is a real category grid (`TemplatesHome.jsx`) — Building-Dept Letter active; Proposal /
  Invoice / Email "Soon". Replaced the old `ComingSoon` placeholder.
- **`/templates/letter`** (`LetterGenerator.jsx`) — form (job picker → prefills project address; date;
  bldg-dept name/street/city-state-zip; reference; project address; body; closing; signer) +
  **attachments** (add images / a reference PDF; reorder ↑↓; remove) + an **inline PDF preview** (iframe,
  debounced rebuild) and **Download PDF**.
- **Output = assembled PDF** via `src/lib/letter-pdf.js` (`buildLetterPdf`): letter drawn in Times (auto-
  paginates), then each attachment in order — **images become pages, a reference PDF's pages are merged in**
  (pdf-lib `copyPages`). NOT browser print anymore. `pdf-lib` bundles only into the letter's lazy chunk
  (~442 kB; initial bundle unchanged).
- **Real logo embedded.** Black PNG at `src/assets/rm117-logo-black.png` (see `[[brand-assets]]` memory; tan
  version kept there too). `LetterGenerator` trims the PNG's transparent padding at runtime, passes bytes to
  `buildLetterPdf` → `drawLetterhead` (logo + firm name centered, address beneath). Vector fallback if missing.
- **Helpers** `src/lib/doc-format.js`: `longDateOnly`, `todayIso`, `parseBodyBlocks`, `wrapText` — 43 tests green.
- **#4 done** — added vertical space between the recipient block and the `Reference:` line.
- **Print-only/not-persisted v1** — letters aren't saved to DB (download the PDF). Bldg-dept address is manual
  (external) — a remembered municipality directory is a nice later add.
- **STATUS: Ray approved the letter generator (logo + compact letterhead look right). Letter is DONE
  pending Angelena's review — if Ang has no comments, it's good to go.** Then start the Proposal generator.

### ▶ NEXT — Proposal generator (bigger), then AI auto-fill
- **Decision locked:** manual fill-in first, **Claude AI drafting as a fast follow** (read `claude-api` skill —
  already loaded once; use `@anthropic-ai/sdk`, model `claude-opus-4-8`, adaptive thinking, stream long output;
  `anthropic` not yet a dep — add it; needs `ANTHROPIC_API_KEY` in .env + Vercel).
- **Proposal anatomy (from the 3 samples) — ~70% fixed boilerplate, ~30% variable:** letterhead (fixed);
  date + "Proposal"/"Revised Proposal"; title (`<NAME> RESIDENCE` / `RESIDENTIAL DEVELOPMENT`); project type +
  address; `Re:` line; `Attn:`; `Dear <first name>,`; intro (fixed); **PROJECT SUMMARY** (free-text);
  **SCOPE OF SERVICES** (Survey / Design / CD / CA phases + deliverables — mostly fixed, only # design meetings
  + which phases vary); **FEE SCHEDULE** (per-phase $ variable, "when due" wording fixed, total from job);
  optional Additional Services (3D render); payment-methods note (fixed); **EXCLUSIONS & LIMITATIONS** (10
  numbered items — $90/hr, $1,200 variance, $5/$2 prints — **identical verbatim across all 3 samples**); binding
  clause + "valid 90 days" + signature lines (client(s), Thomas Dores RA, Angelena Hreczny).
- **Persist proposals** to the existing `proposals` table (job_id, content jsonb, status draft|sent|signed) so
  they can be reopened/revised/re-printed. (If we later persist letters too, add `'letter'` to `templates.type`.)

---

## ▶ RESUME HERE — 2026-06-27 (latest) — Phase 5 Field Notes DONE + LIVE; next is templates

**Phase 5 (Field Notes → site-visit system of record) shipped to prod (commit `af13ae8`, `git push` → live).**
- **Reverse-geocode pins → street address.** `api/_lib/geocode.js` (keyless OSM Nominatim, fail-soft, 4s
  timeout). On save a fresh `{lat,lng}` pin is resolved to `location.address` (inside the existing jsonb —
  no column change). `NoteMedia` + report show the address, fall back to coords.
- **Phase tagging.** New `field_notes.phase` column (migration `0002`, applied to Supabase + in repo).
  Each note auto-stamped with the job's current phase on save (editable via PATCH) → groups the report.
- **Per-job site report.** `/report/:jobId` (`src/components/site-report/SiteReport.jsx`) — standalone,
  chrome-free, staff-gated print page: header (job/client/project address), notes grouped by phase along
  the ladder with photos/voice/location, **Print → Save as PDF**. Opens in a new tab from a "Site report ↗"
  button in JobEditor → Progress tab.
- **Verified:** 30 tests green (+8: `formatAddress`, `sanitizeLocation`); live checks — SiteReport chunk 200,
  `/report/...` 200, health 200, field-notes API still 401 anon. SiteReport is its own 3.83 kB lazy chunk.
- **Note:** the 2 pre-existing field notes have `phase=null` → they show under "Other notes" in the report
  (expected; only notes saved after this ship get auto-stamped). Reverse-geocode runs once per saved pin.

### ▶ NEXT (Ray's call this session) — Proposals + building-department letter templates
Ray wants to do the **proposal feature** AND **building-department letter templates** next. Context:
- The proposal feature was *paused* (Ang/Tom weren't interested) but Ray is reviving it. `templates` table
  (`type proposal|invoice|email`, `name`, `description`, `content` jsonb, `is_active`) + `proposals` table
  both exist, 0 rows. **Read the `claude-api` skill FIRST** for the latest Claude model id + Anthropic SDK
  before building any AI auto-fill.
- "Building-department letter templates" is a NEW ask — letters to municipal building departments (zoning,
  permits, variances). Likely a new `type` value on `templates` (e.g. `letter`) or its own category. The
  `/templates` route is currently a `ComingSoon` placeholder in `rm117-app-shell-v1.jsx` — this is where the
  category card grid + editor goes. Scope/decisions to settle with Ray when starting.

---

## ▶ RESUME HERE — 2026-06-27 — Deploy hygiene done; `git push` is now the only path to prod

**Finding:** Vercel git integration was **already connected** — the live prod deploy serving
`rm117-bms.vercel.app` is a pure git-push deploy (full `githubDeployment`/`branchAlias`/`repoPushedAt`
metadata, no CLI actor). The old notes' "still working-dir `vercel --prod`" described a *habit*, not a
missing integration. Running both meant duplicate prod deploys (e.g. commit `160c90e` shipped twice, 7s apart).

**What changed this session:**
- **Test gate on deploy.** Added `"vercel-build": "vitest run && vite build"` to `package.json`. Vercel
  runs `vercel-build` (over the framework default) so the **22 Vitest tests run first** — a red test fails
  the build and **aborts the deploy**, leaving prod on the last good build. Verified locally end-to-end
  (tests → build, 22 green, ~200ms test overhead). devDeps (vitest) install during Vercel build, so it's available.
- **Workflow is now: `git push origin main` = prod. Do NOT run `vercel --prod`** (causes duplicate deploys).
  Roll back via the Vercel dashboard (every prod deploy is a rollback candidate) or `vercel rollback`.

---

## ▶ RESUME HERE — 2026-06-26 — App hardening DONE + LIVE; pick the next thing

**Last session: the proposal feature was PAUSED and the app-hardening backlog was cleared and shipped.**

### What happened
- **② Proposal template + AI = PAUSED (Ray's call).** Ang & Tom aren't interested right now. The `templates`
  table (`type proposal|invoice|email`, `name`, `description`, `content` jsonb, `is_active`) + a `proposals`
  table (`job_id`, `template_id`, `content` jsonb, `status`, `docusign_envelope_id`) both exist (0 rows) and are
  well-suited to the AI feature whenever it comes back — no rebuild needed. (The old `REDESIGN-BACKEND-NEXT.md`
  §2 "templates = doc library w/ category/format/file_url" spec is WRONG — the real table is the one above.)
- **App hardening (architect's 7/10 user-test, Improvement-Plan Phases 2–4) = DONE + COMMITTED + PUSHED +
  DEPLOYED + verified live.** Commit `160c90e` on `main`, pushed to origin, `vercel --prod` → rm117-bms.vercel.app.
  - **Phase 4 safety net:** Vitest added (`npm test`). **22 tests, all green** in `tests/`: money math
    (`outstanding = job_total − Σpayments`) + `JOB_ID_RE`; the staff auth gate (no token→401, client/non-staff→403,
    staff role-claim fast path, email fallback); the QBO webhook (**dedup on repeated `qbo_invoice_id`**, bad
    secret→401, missing fields→400, job-not-found→404, fresh insert→201).
  - **Phase 2 monolith split (behavior-identical):** `rm117-dashboard-v1.jsx` **1,299→376** and
    `rm117-app-shell-v1.jsx` **1,285→132**, broken into 21 modules under **`src/components/`** (`bms/`,
    `job-editor/`, `shell/` [incl. `auth-gate.jsx`], `dashboard/`, `settings/`, `portal/`, `field-note-sheet/`,
    `ui/`). Shared `fmtDateOnly` moved to `lib/format.js`; duplicate `LADDER` dropped (use `PHASE_LADDER`). The
    entry imports are unchanged (`AppShell` from app-shell; default `BmsDashboard`).
  - **Phase 3 code-splitting:** `React.lazy`+`Suspense` on staff routes, on-demand sheets, and `ClientPortal`
    (lazy in `auth-gate.jsx` + `StaffPortalPreview`). Initial JS **455→327 kB (gzip 134→99)**; a portal client
    downloads the 10 kB portal chunk, **not** the 82 kB staff dashboard.
  - **Verified live:** all 13 split chunks return 200 (no broken lazy import → no route white-screens), 6 staff
    APIs 401 anon + `/api/health` 200 (gate intact). Ray eyeballed on his phone — looks OK.

### ▶ Pick the next thing (nothing is mid-flight)
Open items, all from `ROADMAP.md` / the Improvement-Plan, none blocking each other:
- ~~**Deploy-from-git hygiene**~~ ✅ **DONE 2026-06-27** — git auto-deploy was already wired; added a test
  gate (`vercel-build` runs the 22 tests before building). `git push` = prod; stop running `vercel --prod`.
- **Phase 5 "build forward"** — Field Notes → site-visit system of record (reverse-geocode location→address, link
  notes to phase events, per-job site-report PDF). The differentiator; no external blocker.
- **Two-way QBO sync** — code scaffolded + deployed dormant; **BLOCKED on Intuit production-credential unlock**
  (Compliance ~40min + public EULA/privacy URL). Ray-action at developer.intuit.com. Sandbox keys are instant if
  we just want to prove the code.
- **Proposal template + AI** — paused; revisit if Ang/Tom want it (Ray feeds sample proposals; read `claude-api` skill).
- **Needs Ang:** Forefront commission rate (% vs flat fee); the ~$80K QBO payment imports + $190K completed-A/R
  reconciliation (`CLIENT-RECON.md`).
- **Deferred (pre-launch):** Clerk dev→prod migration (prod runs `pk_test` dev keys — works, but migrate before any
  public client launch); portal-via-rm117.com (blocked on Wix/DNS account access).

---

## ▶ (DONE — historical) 2026-06-23 — Next build was ② Proposal template + AI auto-fill

**Two things shipped to prod tonight; QBO is parked. The clear next build is the proposal template.**

### ✅ Shipped to prod tonight (committed to `main`, `vercel --prod`, rm117-bms.vercel.app)
- **QBO two-way sync — SCAFFOLDED + DEPLOYED but DORMANT (commit `99684c6`).** `api/_lib/qbo.js`
  (OAuth refresh w/ access-token cache + refresh-token rotation → optional Supabase `qbo_tokens` table,
  env fallback; `findOrCreateCustomer`/`createInvoice`/`sendInvoice`) + `api/qbo/create-customer.js`
  + `api/qbo/create-invoice.js` (staff-gated; invoice mirrors into the `invoices` table keyed by
  `qbo_invoice_id`). `health.js` `qbo` flag now uses `hasQbo()`. **Inert until creds exist** — prod
  reads `qbo:false`, so zero behavior change.
- **Drive "Files Sent" self-heal — SHIPPED (commit `99232b4`).** New jobs no longer show an empty vault:
  `resolveFilesSentFolderId(jobId)` in `google-drive.js` (targeted `name contains 'YY_NNN'` Drive search,
  no full-tree walk) + `handleFiles` in `api/portal/[action].js` resolves a null folder id on read,
  persists on a hit, serves the files. Verified end-to-end (resolve→persist→restore, no net change).

### ⏸ QBO is TABLED (Ray's call) — blocked on Intuit's PRODUCTION-credential unlock
The real company (realm `193514517070094`) needs **production** QBO keys, and Intuit gates those behind a
checklist incl. **Compliance (~40 min)** + a public **EULA + privacy-policy URL** + hosting attestation —
too much to stand up for a private 5-person tool right now. **Code is parked & ready** (deployed, dormant).
**To activate later:** developer.intuit.com → app **Keys & credentials** (Production Client ID + Secret)
→ **OAuth 2.0 Playground** mint a refresh token (scope `com.intuit.quickbooks.accounting`, RM117 company,
realmId `193514517070094`) → put all 4 `QBO_*` in `.env` + Vercel → (optional) create the `qbo_tokens`
table (DDL in `qbo.js` header) → test `POST /api/qbo/create-customer {job_id}` then `create-invoice`.
Sandbox keys are issued instantly (no checklist) if we ever want to prove the code without the gate.

### ▶ NEXT BUILD — ② Proposal template + AI auto-fill (HIGH daily value; Ang does proposals constantly)
**Read the `claude-api` skill FIRST** (latest Claude model id + Anthropic SDK), then build:
- The `templates` table exists (0 rows). Populate it + replace the `/templates` placeholder in
  `rm117-app-shell-v1.jsx` with the category card grid (see `REDESIGN-BACKEND-NEXT.md` for the spec).
- Prefixed proposal template: **static contract boilerplate stays fixed**; project-specific fields
  auto-fill from job/client data; **Claude drafts the variable scope/fee sections** from RM117's
  project-size patterns. Ties to `templates` + DocuSign (`docusign:false`) + the milestone schedule.
- **BLOCKED ON RAY:** he will **feed sample proposals** to base the new template on — get those first.
- Decide file storage (Drive vs Supabase Storage) — the Field Notes private-bucket pattern is reusable.

### 🧹 Side items / housekeeping
- **Drive-content gap (no code fixes this):** 48 of 134 jobs still show no files because their Drive
  project folder has **no "Files Sent" subfolder** (e.g. `26_033_Guido`, `25_001_Sztyk`) or is an old
  `24_XXX_…` folder with no Job ID. Create the subfolder in Drive → self-heal maps it on next open.
  Tonight's mapped count: 84→86 (fixed `26_042_Gonzalez`, `23_047_FF_Jones`, `25_054_McCalla`).
- **GitHub token:** Ray was renewing an expiring PAT. The stale cred was cleared from the macOS Keychain
  (`git credential-osxkeychain erase`); next `git push origin main` prompts fresh — username `raymond-beep`,
  password = the **new** token (classic `repo` or fine-grained Contents:write on `raymond-beep/rm117-bms`).
  Local `main` is ~24 ahead of `origin` (prod stays current via CLI deploys; GitHub is housekeeping only).
- Deferred self-heal niceties: best-effort map in `api/jobs/create.js`; a clearer "not set up in Drive yet"
  empty-state in the portal UI.

---

## ▶ (DONE — historical) 2026-06-23 — Security done; pick the next build from ROADMAP.md

> **⚠️ SUPERSEDED by the RESUME-HERE section above.** This block's QBO prep notes are WRONG/outdated —
> there were **no QBO creds in `.env`** (empty placeholders), the company/realm is confirmed
> (`193514517070094`, production), the scaffold is **built + deployed + tabled**, and the next build is
> now **② proposal template**, not QBO. Read the top section; this is kept only for the security history.

**The security pass is fully CLOSED** — staff-API gate + the JWT role-claim upgrade, all committed,
deployed, and verified (anonymous → 401, signed-in staff → token fast-path; Ray confirmed on phone +
desktop). Commits `9ca8f2e`, `523b60c`, `3d7437a`. Full detail in the "(DONE — historical)" section
below and in `User Test Results/RM117-Improvement-Plan.md` (Phase 1 ✅).

### What's next — Ray DECIDED the order (2026-06-23): **① QBO connection, then ② proposal template**
Full detail in **`ROADMAP.md`**.

**① Two-way QBO sync — START HERE.** App→QBO customer/invoice create. **Prep already done:**
- All 4 creds (`QBO_CLIENT_ID/SECRET/REFRESH_TOKEN/REALM_ID`) are in **local `.env`** — but prod
  `health`=`qbo:false`, so they're NOT in Vercel yet (add them when wiring).
- **First task is almost certainly re-minting the refresh token** (likely expired — unused ~months) via
  the Intuit OAuth playground, + confirm `QBO_REALM_ID` = real company vs sandbox.
- **Use the connected Intuit QuickBooks MCP** for discovery first (confirm company + see real
  invoice/customer shape) before building `api/_lib/qbo.js` + `api/qbo/create-*` endpoints.

**② Proposal template + AI auto-fill.** Ray will **feed sample proposals** to base the new template on.
Populate the `templates` table + Claude-drafted variable scope/fee sections, boilerplate fixed.
_(Read the `claude-api` skill before writing the Anthropic call.)_
- **Unblock in parallel (no code):** client portal *through* rm117.com — **blocked on DNS/Wix account
  access** (domain is in a different Wix account; same wall as the email setup). Plan = "Client Login"
  button → `portal.rm117.com` link-out (NOT an iframe — Clerk breaks in third-party iframes).
- **Plan separately:** website redesign (stay on Wix vs rebuild on Vercel) + **productize/white-label**
  (sell to other design firms — multi-tenant; build config-driven NOW so it's not a painful retrofit).

### Hardening backlog (test plan — not urgent): Phases 2–4 in `RM117-Improvement-Plan.md`
Split the two ~1,300-line components (Phase 2 — also de-risks the proposal UI work + seeds
productization), route-level code splitting (Phase 3), smoke tests + deploy-from-git hygiene (Phase 4).
Note: local `main` is ~21 commits ahead of `origin/main` — prod is current via CLI deploys, GitHub is stale.

### ⚠️ Deferred side-finding: prod runs Clerk **DEV** keys (`pk_test`, `known-snake-38.accounts.dev`).
Not a leak (gate works either way), but dev→prod Clerk is a real migration (separate user pool,
custom-domain DNS, redo Google OAuth). Revisit before any public client launch. See project memory.

---

## ▶ (DONE — historical) 2026-06-21 — Deploy the staff-API security gate (+ optional auth upgrade)

> Came out of an architect's "user test" of the whole app (graded 7/10). Full writeup +
> improvement plan live on the Desktop in **`User Test Results/`** (`RM117-User-Test-Review.md`
> + `RM117-Improvement-Plan.md`).

### ⚠️ State of the code: WRITTEN LOCALLY, NOT COMMITTED, NOT DEPLOYED
The Phase-1 fix is implemented in the working tree and the build is green (`npm run build` ✓),
but **nothing is committed or pushed**, so **the live leak is still open until you deploy.**

### The finding (why this matters)
The staff data APIs were **completely unauthenticated in production** — anyone with the URL could
pull the firm's whole book of business anonymously. Verified live 2026-06-21:
`/api/jobs`, `/api/clients`, `/api/forefront`, `/api/payments`, `/api/phase-events` all returned
`200` with no token. (Portal + field notes were already locked.)

### What's been done locally
- **New `api/_lib/require-staff.js`** — shared gate. Returns the user id, or sends `401`
  (no/invalid token) / `403` (valid token but not staff) and returns null. Staff = `@rm117.com`
  email (checked via Clerk `getUserEmail`). Caller pattern: `if (!(await requireStaff(req,res))) return;`
- **Gated 8 endpoints:** `jobs.js`, `jobs/update.js`, `jobs/create.js`, `clients.js`, `forefront.js`,
  `phase-events.js`, `payments.js`, `field-notes/upload.js`.
- **Refactored `field-notes.js`** to use the shared helper (deleted its private copy; this also
  tightened it from any-signed-in-user → staff-only).
- **Left open on purpose:** `health.js` (public, leaks nothing) + `payments/webhook.js`
  (Zapier — guarded by `WEBHOOK_SECRET`). `calendar.js` / `inbox.js` were already gated.
- **Frontend — the essential other half:** the GET *and* write calls sent no token, so gating the
  backend alone would break the app. Added **`src/lib/api.js`** (`apiFetch` — attaches the Clerk
  session token from `window.Clerk`) and routed all **14** call sites through it across
  `rm117-dashboard-v1.jsx` (8), `rm117-app-shell-v1.jsx` (4), `rm117-forefront-v1.jsx` (2).

### Next session — DO THIS
1. **Sanity-test locally signed in with an `@rm117.com` account** (the gate now requires it):
   dashboard loads, jobs/forefront/payments render, a job edit saves, a field note saves.
   *(Heads-up: local uses Clerk **dev** keys — sign in with an @rm117.com dev user or you'll get 403.)*
2. **Commit + deploy** (`vercel --prod`, or push to `main` for auto-deploy).
3. **Verify the leak is closed (anonymous):**
   ```bash
   BASE=https://rm117-bms.vercel.app
   for p in jobs clients forefront phase-events payments; do
     printf "%-14s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/$p"
   done   # every line should now read 401 (health stays 200)
   ```
4. **Then confirm signed-in still works** on your phone (token path can't be tested from CLI).

### Optional but recommended — upgrade the gate to a JWT role claim (perf + cost)
The shipped version makes a Clerk `getUserEmail` API call **per request** (~100–300ms + a hard
dependency on Clerk's API). It's secure and fine for 5 staff, but the better-value fix is to put
the role **in the session token** so the check is token-only (zero network calls, same cost = $0).
Decided this is the **best value option** (graded A+ on perf-vs-price; Organizations was B, ship-as-is
B+). Steps:
1. Set `publicMetadata: { role: 'staff' }` on the 5 staff accounts (Clerk dashboard or a script).
2. Clerk → session token template: add `"role": "{{user.public_metadata.role}}"`.
3. In `require-staff.js`, read `claims.role === 'staff'` from `verifyToken` and drop the
   `getUserEmail` call.
4. Clients get no staff role → denied at the gate, still scoped by `portal-auth.js` (defense in depth).

**Cost note (the whole point of the review's pricing question):** the gate mechanism is ~cost-neutral
— your Clerk bill is driven by **MAUs** (free up to ~10k; Pro ~$25/mo after), and 5 staff + dozens–low-
hundreds of portal clients sits comfortably in the free tier. The JWT-claim upgrade adds **$0**.
Clerk **Organizations** is the only option that could add a line item (gates you to Pro / per-org),
so skip it unless you later want managed team membership. *(Verify Clerk's current pricing page.)*

### After security — back to the feature backlog
**Templates** (table exists, 0 rows) → see the 2026-06-20 section below + `REDESIGN-BACKEND-NEXT.md`.
Then the **Forefront commission-rate** decision (blocked on Ang). Bigger refactors from the review
(split the two ~1,300-line components, route-level code splitting, smoke tests) are Phases 2–4 in
`User Test Results/RM117-Improvement-Plan.md`.

---

## ▶ RESUME HERE — 2026-06-20 — Next = Templates (then Forefront rate, blocked on Ang)

Everything below is **committed to `main` and deployed to prod** (rm117-bms.vercel.app). Working
tree clean. 14 commits today; latest `e50748f`.

**Shipped today:**
- **Vercel Pro** — upgraded; the old 12-function Hobby cap is gone. New APIs are clean standalone
  files. (Watch billing: a "Speed Insights" add-on tried to tack on +$10 — should be $20 Pro only.)
- **Field Notes (the README's mobile feature) — COMPLETE.** New `field_notes` table + standalone
  `api/field-notes.js` (GET/POST/PATCH/DELETE, staff-only, author from Clerk token) +
  `api/field-notes/upload.js` (base64 → private `field-notes` Storage bucket; GET signs 1h URLs).
  Mobile `+` FAB → capture sheet (any job; text + **photo** [camera *or* library/files, multi-select,
  client-downscaled] + **voice** [MediaRecorder] + **location** [GPS]); edit/delete; swipeable photo
  lightbox (`src/lib/note-media.jsx`). Desktop: read/edit/delete list in JobEditor → Progress tab
  (`FieldNotesPanel`). Ray tested photo/voice/location on iPhone — all good.
- **BMS drag-to-organize** (Ang's Google-Sheets workflow). `@dnd-kit/core` + `/sortable` + `/utilities`.
  Drag a card's **grip** to **move between phases** (updates `phase`, stamps a phase event) or
  **reorder within a phase** (persisted via new `jobs.board_position`, fractional midpoint inserts).
  New **Sort** dropdown per the grouped view: Manual / **Most recent (job #)** / Next milestone /
  Contract value / Outstanding / Client name. Works desktop + mobile (press-hold to lift on touch).
- **iOS fixes:** zoom-on-focus (16px form controls <760px), voice mime parsing, recording-button
  label overlap. **App-level `ErrorBoundary`** added — render crashes show a Reload card, not white.

**Next session — Templates (deferred):** the `templates` table already exists in Supabase (0 rows).
Build `api/templates.js` (GET list + POST create) and replace the `/templates` placeholder in
`rm117-app-shell-v1.jsx` with the category card grid. **Decide storage first:** Drive vs Supabase
Storage for the files (we now have a private Storage bucket pattern from Field Notes to copy).
Then the **Forefront commission structure** decision is still blocked on Ang (% of contract vs flat
fee). Full Templates spec in `REDESIGN-BACKEND-NEXT.md`.

**Watch-outs for next session:**
- In `BmsDashboard`, anything computed **during render** (useMemo/derived consts like `baseItems`)
  must be declared **after** the state/memos it depends on (`filtered`, `scopePhases`) — a forward
  ref there throws a temporal-dead-zone error that the build won't catch but blanks the page.
- `.env` has Clerk **dev** keys locally — Calendar/Inbox/field-note auth may differ from prod; not a bug.

---

## ▶ Prior resume — 2026-06-19 — BACKEND for the new mobile feature (DONE — see above)

The **"Drafting + data" UI redesign is frontend-complete.** Next session builds the backend
for the two features that need new Supabase tables + APIs (**Field Notes** — the mobile capture
sheet — and **Templates**), plus the Forefront commission decision (blocked on Ang).

**👉 Full plan + schemas + the Vercel function-cap constraint: see `REDESIGN-BACKEND-NEXT.md`.**

- **Branch:** `redesign-drafting-data` (pushed to `origin`). Commits: `c808a89` (P0–P3),
  `1db0057` (P4/P7/P8), + a docs commit. **Not merged to `main`; prod untouched.**
- **Frontend done:** P0 Foundation (IBM Plex + 5 themes via `src/lib/theme.jsx` + `[data-theme]`,
  light themed sidebar, top header bar) · P1 Dashboard (stat cards w/ sparkline/ring/progress,
  month-grid calendar, inbox avatars) · P2 BMS (header + phase groups; Job ID is the bold primary
  line; `potential`→"Proposal Sent") · P3 Job Editor drawer (payment chips) · P4 Forefront
  commission tracker (status-grouped ledger; "10%" copy neutralized) · P5 Settings (theme picker +
  defaults) · P7 Client Portal (brand colors pinned) · P8 Mobile (Portal tab + Appearance sheet).
- **✅ Vercel Pro (upgraded 2026-06-20)** — the old 12-function Hobby cap is GONE. Build Templates +
  Field Notes APIs as **clean standalone files** (`api/templates.js`, `api/field-notes.js`); no more
  dispatcher gymnastics. Details in `REDESIGN-BACKEND-NEXT.md`.
- **Deferred from the redesign:** Templates (table+API+UI), Field Notes (table+API+mobile FAB sheet),
  Forefront rate/structure (Ang: % of contract vs flat fee per project).
- **Local dev note:** `.env` has Clerk **dev** keys (`pk_test`) — a separate user pool/OAuth from
  prod, so Calendar/Inbox may show "Connect Google" locally; not a bug. Redesign touched no auth/API code.

---

## ▶ Prior resume: 2026-06-18 — Phase 7 portal essentially COMPLETE

App live at **rm117-bms.vercel.app**. Everything is committed to `main`, **pushed to `origin/main`**, and
deployed to prod. Latest commit: `74eed0a`. Today's commits: `a0f5e2f` (portal redesign + vault + phase
reorder + DaSilva) · `0568c98` (staff preview) · `629f518` (Vercel key fix) · `dfe44ad` (audit) ·
`c3de2e5` (messaging) · `b1ca623` (company calendar) · `5d6810a` (email deferred + test data deleted) ·
`74eed0a` (Outstanding display fix) + doc commits.

### ✅ Also shipped late today
- **Company Google Calendar LIVE** — `COMPANY_CALENDAR_ID` set in `.env`+Vercel, deployed (`company_calendar:true`).
- **Outstanding display fix** (`74eed0a`) — dashboard headline now counts ACTIVE-pipeline balance (~$128K)
  not all jobs ($454K); completed ($190K) + on-hold ($136K) phantom QBO A/R shown as a separate hint.
  Non-destructive. The real reconciliation (needs Ang) is logged in memory + `CLIENT-RECON.md`.
- **Reusable design brief** for Claude Design at `~/Desktop/RM117-Design-Brief.md` (Ray's tool, outside repo).

### ✅ Messaging SHIPPED (commit `c3de2e5`)
In-portal, one thread per job (Supabase `threads`/`messages`). Client composes/reads in the portal
Messages panel; staff read/reply from a **Messages tab in the JobEditor** (replies post as RM117).
New dispatcher actions `messages` (GET) + `send` (POST) in `api/portal/[action].js` (per-action method
rules; still one function). Client scoped to own job, staff any job. **Email bridge = deferred**
(Resend key stored; blocked on Wix domain access — see "What's left" below). Verified end-to-end then
the test data was deleted, so threads/messages tables are back to empty.

### ⏭ What's left for the portal
- **Email bridge — DEFERRED (2026-06-18, Ray's call).** `RESEND_API_KEY` is stored in `.env` + Vercel
  (sending-only key, on `raymond@rm117.com`). **Blocker:** rm117.com DNS is hosted on **Wix** but under a
  **different Wix account** than Ray's (his Wix account doesn't list the domain). Decided not worth it now —
  outbound mostly powers messaging, which overlaps the firm's existing Gmail client comms + Priority Inbox.
  To enable later: get into the Wix account that holds rm117.com → add `send.rm117.com` in Resend → paste its
  3 DNS records into Wix → add a Resend notify call in the `send` action. Inbound replies = separate (needs MX).
- **Document uploads** (Files Received) — currently "coming soon"; needs a Drive write-scope + upload action.
- **Portal data refinement** — see CHECKLIST "Portal data refinement" (23_047 Jones correct folder,
  Anutnes→Antunes Job ID typo, McCalla client email, 37 jobs needing a Files Sent subfolder, etc.).
- **Staff data APIs still unauthenticated** (`/api/jobs` etc.) — gate before the portal is truly public.

> **Portal test data DELETED 2026-06-18** (client + `00_99x_PortalTest` jobs + thread). The Clerk login
> `raymond+portaltest@rm117.com` still exists in Clerk (unused) — delete in Clerk dashboard if desired.

### ✅ Shipped today (Phase 7 Client Portal)
- **Portal redesigned to the approved mockup** (`design/visual-refresh-2026-06/`): dark header,
  project switcher cards, **horizontal phase stepper**, two-panel Documents/Messages. `src/rm117-portal-v1.jsx`.
  **Money-free by design** — no totals/payments reach the client (stripped from the API too).
- **Auth/role gate** (`RoleGate` in `src/rm117-app-shell-v1.jsx`): client→portal, staff(@rm117.com)→shell,
  else→no-access. Clients sign in **Clerk email-code only**. Isolation lives in `api/_lib/portal-auth.js`
  (`resolvePortalIdentity`, `getJobForIdentity` — client sees own jobs, staff sees any).
- **Document vault LIVE** — service account (`rm117-sheets-reader@…`, +`drive.readonly`) brokers each job's
  **"Files Sent"** Drive folder. `api/_lib/google-drive.js`; `jobs.drive_files_sent_folder_id`.
  **85 jobs mapped** via `scripts/map-drive-folders.js` (Shared Drive `0AI4YgRkGhLhCUk9PVA`, walks
  "YYYY Jobs" archives, by Job ID, idempotent). Audited with `scripts/audit-drive-mappings.js` → 75 clean.
- **Staff portal preview** — staff `/portal` route → pick a client → see their portal (`preview` action).
- **Vercel key bug FIXED** — `GOOGLE_PRIVATE_KEY` arrived quoted on Vercel (dotenv strips quotes locally,
  Vercel doesn't) → OpenSSL `DECODER unsupported` → every Drive call failed in prod. Fix: strip quotes in
  `google-drive.js` `privateKey()`. **Lesson: SA key only ever ran in local scripts before; this was its
  first runtime use on Vercel.**
- **Portal routes are ONE function** `api/portal/[action].js` (dispatches `me`/`preview`/`files`/
  `download` by path segment). This was originally done to stay under the Hobby 12-function cap.
  **Update (2026-06-20): now on Vercel Pro, the cap is lifted** — the dispatcher can stay (it's a
  coherent group) but new endpoints no longer have to be jammed in; split them out when cleaner.
- **Data fixes:** merged duplicate client Josh/Joshua Russo → **Joshua Russo** (3 jobs). Corrected
  `25_054_McCalla` to the right folder (`25_055` offset). **Unlinked `23_047_FF_Jones`** (was pointing at
  `23_047_Needle_Ripley`). See CHECKLIST → "Portal data refinement" for the long-tail list.

### ⏭ NEXT: build the Messages tab (in-portal; email bridge deferred)
Tables already exist (empty): **`threads`** (id, job_id, subject, created_at, updated_at) and
**`messages`** (id, thread_id, sender_type `staff|client`, sender_id uuid nullable, body, via `portal|email`,
created_at). One thread per job. Build plan:

1. **API — add to the dispatcher `api/portal/[action].js`** (keeps us at one function):
   - The dispatcher currently rejects non-GET at the top (`if req.method !== 'GET' → 405`). **Refactor so
     `send` allows POST** (move the method check per-action).
   - `GET messages?job_id=X` → find-or-create the job's thread, return its messages ascending. Client: own
     job only; staff: any job. Use `getJobForIdentity(identity, jobId)` for the ownership check.
   - `POST send` (body `{job_id, body}`) → resolve identity, verify job ownership, find-or-create thread,
     insert a message: `sender_type` = `client` if role client (sender_id = client.id) else `staff`
     (sender_id null — staff table is empty), `via='portal'`. Bump `threads.updated_at`.
   - **Register `/api/portal/messages` + `/api/portal/send` in `server.js`** (local dev only; Vercel’s
     `[action]` catch-all handles prod automatically). Note: server.js parses JSON via express.json().
2. **Client UI** — `MessagesPanel` in `src/rm117-portal-v1.jsx` is currently a "coming soon" placeholder.
   Replace with: fetch `GET /api/portal/messages?job_id=<selected>` with the Clerk token; render the thread
   as RM117 (left) vs You (right) bubbles (mockup styling: `.cp-msg-*` — see the mockup section in
   `RM117 Mockup.dc.html` lines ~612-636); wire the composer to `POST /api/portal/send` then refetch.
3. **Staff UI** — add a **"Messages" tab** to `JobEditor` in `src/rm117-dashboard-v1.jsx` (alongside
   Details/Progress/Payments — the drawer-tab pattern is at lines ~373-375). Same endpoints with the staff
   token (staff posts as `staff`). Lets the firm read/reply per job.
4. **Email bridge = LATER** (needs Resend, `resend:false`). `notifications` table is ready for it.

**Verify pattern:** all `/api/portal/*` return 401 without a token; client sees only own job's thread;
staff can post to any job; build passes (`npm run build`). Test via the **staff preview** + the test client
`raymond+portaltest@rm117.com` (jobs `00_99{7,8,9}_PortalTest`).

### ✅ Test data cleanup — DONE (2026-06-18)
The "Portal Test Client" + `00_99x_PortalTest` jobs/payments/phase-events/thread were deleted from prod.

---

## ▶ RESUME HERE — 2026-06-17 (short session)

**Done tonight (committed `f2ba7dd`, pushed to `origin/main`):**
- **Resolved the client-portal concern:** clients authenticate through Clerk by **email only**
  (magic link / email code) — **never "Sign in with Google."** They never enter the Google OAuth
  app, so the portal can **not** consume the Google "test users" (100) cap — that cap is **staff-only**
  (Gmail/Calendar Priority Inbox). The portal therefore does **not** affect staff Google access, and
  Clerk's free tier (10,000 MAU) means clients add **$0** auth cost. Recorded as an invariant in
  `CLAUDE.md` and across `VISION.md`, `PLAN.md`, `CHECKLIST.md`, `ADR-001`, `GMAIL-SETUP.md`.
- **Reference doc:** `RM117 Client Portal - Auth Notes.docx` saved on the **Desktop** (outside the repo).
- **Git identity** set globally to `Raymond Arocha <raymond@rm117.com>` — future commits attribute correctly.
- No code or config changes; docs only. Prior priorities below are unchanged.

---

## ▶ RESUME HERE — state as of 2026-06-16 (end of prior session)

App is live at **rm117-bms.vercel.app**, Supabase-backed, all of today's work **committed to `main`
and deployed to prod**. Latest commit: `b8fb41e`.

**Shipped today (all deployed):**
- **JobEditor** verified end-to-end (edit jobs + log payments against live Supabase).
- **Client-link Details tab** — jobs now linked to `clients` via a picker; portal-visible vs internal field tags.
- **Payment safety** — webhook dedups on `qbo_invoice_id`; manual logging is non-QBO-only with QB-vs-outside badges.
- **Progress Timeline** (the internal alternative to a client portal) — per-job phase ladder with
  reached dates + a "Next milestone" date, surfaced in a dashboard **"Coming up"** strip + card badges.
  **Phase dates are editable** (set "when we surveyed" right on the timeline).
- **Data cleanup** — fixed inbox false-positives, removed debug logs, merged duplicate clients, and
  took job→client coverage from **64 → 126 of 134**. Created the **Williams** job (was Riera; client
  renamed) at `26_032_FF_Williams`.

**Pick up here next (prioritized; most need Ray/Ang input, not code):**
1. **~$80K QBO payment imports** — `CLIENT-RECON.md` has the table. MONEY → confirm job mappings.
   Avedissian $22.4K + Rodriguez $11K are high-confidence and ready on your word.
2. **Client-type reclassification** — 88 of 96 clients defaulted to `homeowner`; reclassify
   contractors/investors (needs your knowledge of who's who).
3. **8 on-hold/completed jobs with $0 total** — likely missing contract values to pull from QBO:
   `25_022_Dunn_Bathroom, 23_007_Dunn_Antique Car, 26_025_Dubleski_Holmdel, 25_016_O'Bagel Wayne,
   26_019_Madden, 25_023_Rodrigues, 25_008_O'Bagel_Stirling, 26_010_Melrose`.
4. **8 unlinked jobs** (blank/commercial names) — type the client in via JobEditor:
   `25_016_O'Bagel Wayne, 25_014_Amato, 24_083_ElHassan_Cafe, 25_007_FE_Sebastian,
   25_019_Antunes_175 E Crescent, 25_009_Samsel_Terry Lane, 24_082_LaRose, 25_053_FE_Mendham`.
5. **Williams** is a Forefront job with no commission row yet — set a commission amount so it shows
   in the Forefront tracker.
6. **Stage B — outbound QBO + DocuSign** (the "create/send milestone invoices from the app" goal):
   `QBO_*` env vars are set but unused. Needs a quick word with Ang on the milestone schedule.
7. **Shared RM117 company calendar** — blocked on Ang (she owns the iCloud one); see item A below.
8. **Client Portal** — deferred by Ray; the Progress Timeline covers the core need for now. The
   **staff-impact worry is now resolved** (2026-06-17): clients use Clerk email login, separate from
   the Google OAuth app, so the portal can't touch the 100 test-user cap or affect staff. The only
   remaining reason to defer is onboarding/login-management effort — not any limit or cost. All
   Phase-7 tables + `clients.clerk_user_id` exist if/when revisited.

**Today's commits (on `main`):** `e98877f` client-link + payment-safety · `8a21050` Progress Timeline
· `74673c8` cleanup (inbox/logs/linker) · `766d2b6` bulk client creation · `b8fb41e` editable phase dates
· plus doc commits (`f824ede`, `a4e6af9`, `73410e7`, `badf676`).

**New connection points added today** (also in `CLAUDE.md`):
- Endpoints: `GET /api/clients`, `GET/POST/DELETE /api/phase-events`. Routes registered in `server.js`.
- Table: `job_phase_events`; columns `jobs.next_milestone_label` + `jobs.next_milestone_date` (see `SCHEMA.md`).
- Scripts: `scripts/link-jobs-to-clients.js`, `scripts/create-clients-for-unlinked.js` (both dry-run by default).

---

## ✅ Progress Timeline shipped (2026-06-16)

**Internal job-progress tracker — the no-auth alternative to a client portal.** Ray was wary of
managing external client logins, so instead of the portal we built the *root value* (job phase
progress + dates to follow) as a staff-only feature. New `job_phase_events` table (append-only
phase-reached log; auto-stamped on phase change in `api/jobs/update.js`; 133 jobs seeded a
baseline). New `jobs.next_milestone_label` + `next_milestone_date` ("the one date to follow").
New `GET /api/phase-events`. JobEditor gains a **Progress** tab: phase ladder (done/current/
upcoming with reached dates) + editable next-milestone. Dashboard shows a **"Coming up"** strip
(soonest milestones, overdue in red) + a milestone badge on job cards. Verified vs live Supabase
(phase-change stamping is idempotent on no-op; milestone round-trips); build passes. Committed +
deployed prod. **Decided (Ray): hold the full client portal** (Stage B QBO too) — revisit portal
later; Ang to confirm milestone workflow.

---

## ✅ Client-link + payment-safety shipped (2026-06-16, commit `e98877f`, deployed prod)

**1. Client-link Details tab (portal foundation).** Details tab is now backed by the `clients`
record via `jobs.client_id` instead of free-text. New `GET /api/clients` (picker source);
`GET /api/jobs` now joins each job's `client` object; `client_id` added to the update whitelist
(empty string → null = unlink). Details shows a client picker + a read-only contact card
(type/email/phone/company) and tags fields **👁 client** (portal-visible: client, address, phase)
vs **🔒 internal** (notes). `client_name` kept as the per-job display label. Verified: link → join →
unlink round-trip against live Supabase.

**2. Payment safety (QBO double-entry guard).** Webhook (`api/payments/webhook.js`) now dedups on
`qbo_invoice_id` — Zapier retries/double-fires return `duplicate:true`, no second row (verified).
Manual "Log payment" form drops the `qb` method (QBO syncs automatically) and shows a note; the
Payments list badges each payment **QuickBooks** vs the outside method. `qbo_invoice_id` shown as
`INV …`.

**Architecture decision (Ray, 2026-06-16):** QuickBooks stays the system of record for invoices/AR;
the app is a control surface; `qbo_invoice_id` is the idempotency key. Do payments in two stages —
**Stage A = above (non-QBO logging + dedup), done.** **Stage B (next milestone) = outbound QBO:**
build the QBO API client (`QBO_*` env vars set, unused) so the app can create/send milestone invoices
to QBO (Ang's "create invoice, send when phase met" flow) + optionally record payments to QBO, with
DocuSign proposals feeding the milestone schedule. Stage B may need a quick word with Ang on the
milestone schedule. Bonus: app-driven invoice creation fixes the AR-inflation problem.

---

## ✅ Shipped & live (2026-06-15, latest)

**Visual refresh — "Architectural" direction (desktop + mobile).** Recreated the design handoff
(`design/visual-refresh-2026-06/`) in the live codebase: warm-paper palette,
JetBrains Mono for all data, title-block stat strip, grouped/brass sidebar, eyebrow+greeting headers,
recolored phase bars, refreshed editor drawer. **Functionality unchanged.** Then made it responsive:
sidebar hidden on phones, slim dark top bar (keeps Clerk `UserButton` → sign-out / Connect Google),
bottom tab bar (Home/Jobs/Forefront), 2×2 stats, single-column cards. Fixed a CSS Grid overflow with
`minmax(0,1fr)`; verified at true 390px via CDP emulation (NO OVERFLOW) and on Ray's phone. Touched
`index.html`, `src/styles.css`, `rm117-app-shell-v1.jsx`, `rm117-dashboard-v1.jsx`,
`rm117-forefront-v1.jsx`. Commits `8d0ef17` (desktop) + `fab22e4` (mobile) on `main`; deployed prod.
**Known issue:** inbox surname-fallback tags some non-clients as clients (e.g. "ClickUp Team") — see
`_lib/client-match.js`; low-priority cleanup logged in CHECKLIST.

---

## ✅ Shipped & live (earlier 2026-06-15)

**1. Priority Inbox (Gmail) — WORKING.** Per-user read-only Gmail, filtered to client senders.
The long OAuth fight's root cause was tiny: **Clerk's Google custom-credentials Scopes field had the
bare string `gmail.readonly` instead of the full URL** `https://www.googleapis.com/auth/gmail.readonly`
→ Google `Error 400: invalid_scope`. Google Cloud was fine all along. Correct project = **rm117-bms**
(`starry-tracker-498023-i0`, # `358622628253`) on Ray's **personal** Google acct; OAuth app in Testing,
Ray+Ang test users (do NOT publish — restricted scope). Connect the **work** email (raymond@rm117.com)
in the app. `api/inbox.js`, `_lib/clerk.js`, `_lib/client-match.js` + dashboard widget all live.

**2. Client backbone — built from QuickBooks.** `clients` table went 0 → **64 clients** (46 w/ email),
**64/133 jobs linked** via `jobs.client_id`. Source: QBO "Customer Contact List" CSV →
`scripts/import-clients.js` (idempotent; dedupes by email; one client per email across multiple jobs).
Clients typed: 2 contractor, 8 investor (incl. Monita Sun), rest homeowner. `client-match.js` upgraded
to **email-first + surname fallback** (killed the newsletter false-positives).

**3. Google Calendar widget — live (personal).** `api/calendar.js` + `CalendarWidget` read the user's
primary Google cal + `COMPANY_CALENDAR_ID`. Added `calendar.readonly` to Google consent screen + Clerk
(full URL), enabled Google Calendar API in rm117-bms. Ray's personal cal renders.

---

## 🔵 Open items (pick up here)

**A. Shared RM117 calendar — needs Ang.** The team calendar is Ang's **iCloud** calendar (Ray invited,
not owner); the app reads Google only. Plan: Ang creates a **Google** calendar for RM117 → shares with
all staff → everyone adds it to Apple Calendar (add Google acct) for two-way sync → she sends the
Calendar ID → set `COMPANY_CALENDAR_ID` in `.env` + Vercel → redeploy. Blocked on Ang availability.

**B. Client reconciliation — `CLIENT-RECON.md`.** 12 QBO customers couldn't auto-link (job-number
conflicts + legacy names, incl. `26_FF_032_Riera` still missing from Supabase entirely). Fix names in
QBO/Supabase, then re-run `node scripts/import-clients.js`. Overlaps the QBO name-mismatch list below.

**C. QBO reconciliation — waiting on Ang.** Full recon done; see `scripts/recon/`. Ang's workflow
(create milestone invoices upfront, send when phase met) explains the inflated AR. QBO A/R $377.5K =
$115.5K Opening-Balance artifacts + ~$262K mostly unbilled backlog. Blocked on Ang: (a) are the 44
Opening Balances real? (b) rename QBO customers to Job-ID format / use Estimates. Forward
`scripts/recon/RECON-SUMMARY-for-Ang.md`. **Did NOT change app data.**

**D. Cleanup chores.** (i) Merge duplicate no-email client rows (Gabe DaSilva ×2, Josh Russo ×2).
(ii) Remove the diagnostic `console.log`s in `api/_lib/clerk.js` + `api/inbox.js`. (iii) **Inbox
false-positives:** surname-only fallback in `_lib/client-match.js` tags automated/SaaS senders as
clients (e.g. **"ClickUp Team"**) — skip no-reply/team addresses + known SaaS domains, require an
email-domain match before flagging. (iv) ~~Git hygiene~~ ✅ done — repo now matches production
(commits through `fab22e4`); deploys remain working-dir `vercel deploy --prod`, NOT git push.

**E. (Optional, discussed) Redesign the app layout in Claude design** before building the Client Portal,
so the portal is built on the final shell. Design files staged in `~/Desktop/RM117 App Design/`.

---

## Where we are

The app is live at **rm117-bms.vercel.app** and fully backed by Supabase. Payments are now
accurate — every paid QBO invoice auto-syncs via Zapier, and the full payment history has been
imported. Job totals match QBO invoice data.

| What | Status |
|------|--------|
| Supabase schema + 133 jobs imported | ✅ Done |
| Vercel deployment (rm117-bms.vercel.app) | ✅ Done |
| Clerk auth (Ray + Ang invited) | ✅ Done |
| Forefront commissions view | ✅ Done |
| QBO Zapier webhook (future payments) | ✅ Live |
| Historical QBO payments imported (131) | ✅ Done |
| Job totals corrected from QBO (77 jobs) | ✅ Done |
| Priority Inbox (Gmail, per-user) | ✅ Live (2026-06-15) |
| Client backbone from QBO (64 clients, typed) | ✅ Done (2026-06-15) |
| Google Calendar widget (personal) | ✅ Live (2026-06-15) |
| Visual refresh — Architectural (desktop) | ✅ Live (2026-06-15) |
| Mobile responsive (sidebar→tab bar, 2×2 stats) | ✅ Live (2026-06-15) |
| Shared RM117 company calendar | ⬜ Needs Ang |
| JobEditor — edit/save jobs | ✅ Verified vs live Supabase (2026-06-16) |
| Per-job payment history + log payment | ✅ Verified vs live Supabase (2026-06-16) |
| DocuSign proposals | ⬜ Not started |
| Client Portal | ⬜ Not started (backbone ready) |

---

## Immediate QBO cleanup (start here next session)

### 1. Add missing job — `26_FF_032_Riera`
Exists in QBO (retainer $800 paid 2026-06-11) but not in Supabase. Need to create the job
and add the payment. Invoice total in QBO: $5,000 ($800 retainer + $1,400 DP1 + $1,400 DP2
+ $1,400 CDs). Payment already received: $800 retainer.

### 2. Resolve QBO/Supabase name mismatches
These customers have payments in QBO that weren't imported because the job ID in QBO doesn't
exactly match Supabase. **Ray needs to confirm the correct Supabase job_id for each before
we auto-map them.** Payments to insert after confirmation:

| QBO Customer Name | Likely Supabase job_id | Payments to add |
|---|---|---|
| `25_052_FE_Mendham` | `25_053_FE_Mendham` (?) | $1,800 + $1,500 |
| `25_054_Malanga_Subdivide` | `25_053_Malanga_Subdivide` (?) | $1,200 |
| `26_025_Samsel_510 Harrison Place` | `26_022_Samsel_510 Harrison. Place` (?) | $4,000 |
| `Mickael Avedissian` | `25_031_FF_Avedissian` (?) | $4,800 + $1,200 + $7,600 + $8,800 |
| `Jay Rodriguez` | `25_028_Rodriguez_1 Noe` (?) | $1,200 + $9,800 |
| `Nimchy Regis` | `25_024_FF_Regis` (?) | $3,400×2 + $1,400×2 |
| `Nandini Ramesh` | `25_030_Ramesh` (?) | $1,000 + $1,000 + $2,500 |
| `Nosker_Interiors` | unknown | $2,750 |
| `Luis Correia` | unknown | $5,200 + $5,800 |
| `Mike Costello` | unknown | $1,200 + $9,300 |

### 3. Review outstanding on completed jobs — RECONCILED 2026-06-15
Built a full QBO↔Supabase reconciliation. See `scripts/recon/` (run `build-recon.py`, output
`recon-report.csv`, and `RECON-SUMMARY-for-Ang.md` to forward to Ang). Key findings:
- **Ang's workflow explains it:** she creates all milestone invoices in QBO at proposal time,
  sends each only when that contract phase is met. Created-but-unsent invoices post to AR and
  age into "overdue" — so QBO's $377.5K A/R is mostly *unbilled backlog*, not collections.
- QBO total A/R **$377,500**; of that **$115,500 is 44 "Opening Balance" invoices** (book-setup
  artifacts — Ang must confirm if real or write off). Outstanding ex-OB: **$262,000**.
- Completed-phase QBO outstanding **$105,350**, of which **$52,950 is Opening Balance**.
- **Blocked on Ang:** (a) are Opening Balances real? (b) rename QBO customers to Job-ID format,
  or switch to Estimates-for-contract / Invoices-when-billable to stop inflating AR.

### 3b. Payments in QBO missing from app (name mismatches) — confirm mapping then import
Avedissian $22,400, 24_030_Antunes $15,000, Regis $9,600, Ramesh $4,500, Sztyk/Feniak ~$4-5K.
Job-number collisions to resolve: 26_025 (Samsel vs Dubleski), 25_054 (Malanga vs McCalla),
25_052 (Mendham vs DaSilva). Full list in recon-report.csv (`paid_delta(qbo-app)` column).

---

## Scripts available (in `scripts/`)

| Script | What it does | How to re-run safely |
|---|---|---|
| `import-payments.js` | Imports QBO payments from CSV | `node scripts/import-payments.js --dry-run` first |
| `sync-job-totals.js` | Updates job_total from QBO invoice data | `node scripts/sync-job-totals.js --dry-run` first |
| `import-sheet.js` | One-time Google Sheet → Supabase import | Already run — don't re-run |
| `update-billing.js` | Updates job_total from Sheet billing tabs | Superseded by sync-job-totals.js |

To re-run payment import with a new QBO export: drop new CSV in Downloads, update `CSV_PATH`
in the script, run with `--dry-run` first.

---

## Key env vars (all set in `.env` and Vercel)

| Var | Value / Location |
|---|---|
| `WEBHOOK_SECRET` | `rm117-qbo-webhook-2026` |
| `SUPABASE_URL` | `https://mgyebrgdjkxojawmfeyx.supabase.co` |
| `VITE_CLERK_PUBLISHABLE_KEY` | in `.env` |
| `CLERK_SECRET_KEY` | in `.env` |

---

## JobEditor (Phase 3/4) — ✅ DONE & VERIFIED (2026-06-16)

The JobEditor was already fully built (Details edit/save + Payments history + log-payment)
and is now **verified end-to-end against live Supabase production**:
- `api/jobs/update.js` — saves whitelisted edits; rejects invalid phase (400). ✅ persists.
- `api/payments.js` — GET history per job ✅; POST validates method/type/amount/date,
  rejects bad input (400) ✅; real insert persists and appears in GET ✅.
- JobEditor drawer (`rm117-dashboard-v1.jsx`): Details tab → `saveJob` (optimistic + rollback);
  Payments tab → loads history, "Log payment" form; `onPaymentLogged` → `loadJobs()` refresh.
- `outstanding` recomputes correctly after a payment (verified, test row cleaned up).

Verification used a marked `$0.01` test payment on `25_001_Sztyk`, deleted afterward via
Supabase — production data untouched.

**Optional follow-ups (not blocking):** expose `amount_billed` in the Details tab; add a
delete/void-payment action (no endpoint yet — corrections require direct Supabase); browser
click-through with Ang for final UX sign-off.

---

## Vercel / deployment notes

- Project folder: `/Users/raymondarocha/Desktop/RM117 App` (renamed 2026-06-16 from `RM117-App-handoff copy`)
- Vercel project: `rm117-bms` under `rm117-s-projects`
- To deploy: `cd` to project folder, `vercel --prod`
- Folder is linked to Vercel (`.vercel/project.json` now exists)
- Auto-deploys are NOT set up (no git remote) — deploy manually via CLI or push to GitHub
