# Redesign — Backend Round (Next Session)

**Created:** 2026-06-19 · **Branch:** `redesign-drafting-data`

The "Drafting + data" UI redesign is **frontend-complete** (Phases 0–5, 7, 8). The next
session is the **backend** for the two features that need new Supabase tables + APIs, plus
one decision blocked on Ang. Everything below is what's left.

---

## ⚠️ Hard constraint — Vercel Hobby = 12 serverless functions, and we are AT 12

Current deployable functions (each `api/*.js`, excluding `_lib/`):
`calendar · clients · forefront · health · inbox · jobs · jobs/create · jobs/update ·
payments · payments/webhook · phase-events · portal/[action]` = **12 / 12**.

**Adding standalone `api/templates.js` and `api/field-notes.js` would be 14 → over the cap.**
Options, in order of preference:
1. **Consolidate via the dispatcher pattern** (same as `api/portal/[action].js`): one new
   `api/data/[resource].js` (or `api/app/[action].js`) that handles `templates` and
   `field-notes` (and is room for future small resources). Net new functions: **+1 → 13**.
   Still over by 1 — so also fold one low-traffic existing route into a dispatcher, OR:
2. **Fold templates + field-notes into the existing `portal/[action].js`** dispatcher
   (rename it to a general app dispatcher). Net new functions: **0**.
3. **Upgrade Vercel** (Pro) to lift the cap — simplest but costs money; confirm with Ray.

Recommended: **option 2** — extend the existing dispatcher into a general
`api/app/[action].js` with actions `templates`, `template-create`, `field-notes`,
`field-note-create`, and migrate the portal actions into it (or keep portal separate and
make ONE new dispatcher = option 1 + fold `health` into another route to get back to 12).
Decide at the top of the session.

---

## 1. Field Notes  ← the README's "main thing to build"

Mobile FAB + capture sheet for on-site notes. **UI not yet built** (deferred with backend);
the prototype's `saveNote()` is a stub. Build both the table/API and the mobile sheet.

### Table: `field_notes`
```
id           uuid pk default gen_random_uuid()
job_id       text  references jobs(job_id)   -- the on-site job
body         text  not null
author_id    text                            -- Clerk user id (staff)
created_at   timestamptz default now()
attachments  jsonb default '[]'   -- [{type:'photo'|'voice', url, name}] — phase 2
location     jsonb                -- {lat, lng} optional — phase 2
```
RLS: staff-only (same posture as the other staff APIs — currently open; see "staff API auth"
in `NEXT_SESSION.md`).

### API (in the chosen dispatcher)
- `GET  field-notes?job_id=…` → notes for a job, newest first
- `POST field-note-create` → `{ job_id, body }` (author_id from the verified Clerk token via
  `getUserId` in `api/_lib/clerk.js`)

### Frontend (mobile)
- A floating **`+` FAB** (56px, accent, above the bottom tab bar) → opens a **bottom sheet**
  (reuse the new `.sheet` / `.sheet-overlay` styles added for the Appearance sheet).
- Sheet: search bar filtering an on-site-relevant job list (Active/CD/Design/Survey-Zoning),
  selectable rows (accent border + filled dot), a note textarea, a Photo/Voice/Location
  affordance row (**visual-only for now** — wire to device APIs later), and a **Save field
  note** button gated on (job selected && note non-empty).
- On save → `POST field-note-create`, then surface the note on the job's Notes/Progress view.

---

## 2. Templates — document library

Category-grouped card grid (already speced; **UI not built**). Currently `/templates` routes
to a "coming in the redesign build" placeholder in `rm117-app-shell-v1.jsx`.

### Table: `templates`
```
id          uuid pk default gen_random_uuid()
name        text not null
category    text  -- 'Proposals' | 'Agreements' | 'CD Sets' | 'Client Letters'
format      text  -- 'PDF' | 'DOCX' | 'DWG'
file_url    text  -- storage/Drive reference
updated_at  timestamptz default now()
use_count   int default 0
```
(CLAUDE.md lists a `templates` table in the schema — **verify it exists / matches** via
`list_tables` before creating; extend if partial.)

### API (in the chosen dispatcher)
- `GET  templates` → all, grouped client-side by category
- `POST template-create` → new template (file upload strategy TBD — Drive vs Supabase Storage)
- (later) increment `use_count` on "Use"

### Frontend
- Replace the `/templates` placeholder with the category card grid (format badge: PDF=bill
  colors, DOCX=accent, DWG=ff colors; name; "Updated … · N uses"; Use + Preview actions).
- "Use" / "Preview" wiring depends on where files live — decide storage first.

---

## 3. Forefront commission structure  ← blocked on Ang

Ray is confirming with Angelena whether Forefront commissions are a **percentage of contract
value** or a **flat fee per project**. The "10%" copy was **neutralized** in the UI meanwhile
(`rm117-forefront-v1.jsx`: header "Commission tracking / Referred & co-brokered work"; booked
card "total commission booked"). The ledger shows the **real stored `total_commission`
amounts**, so figures are correct regardless.
- **If percentage:** consider auto-deriving `total_commission = round(job_total * rate)` and
  restore a rate label.
- **If flat fee:** keep amounts entered per job; label accordingly.
- No code change until Ang confirms.

---

## Redesign frontend — DONE (for context)
P0 Foundation · P1 Dashboard · P2 BMS · P3 Job Editor drawer · P4 Forefront tracker ·
P5 Settings · P7 Client Portal · P8 Mobile dashboard. Commits on `redesign-drafting-data`:
`c808a89` (P0–P3), `1db0057` (P4/P7/P8). Theme system = `src/lib/theme.jsx` + `[data-theme]`
in `styles.css` (5 themes, IBM Plex). See `MEMORY` / git log for specifics.

## Don't forget
- Register every new `api/*` route in **`server.js`** (local Express wrapper) too.
- `ios-frame.jsx` from the handoff is **reference only — do not ship.**
- Keep the client portal **money-free** (no totals/payments reach clients).
