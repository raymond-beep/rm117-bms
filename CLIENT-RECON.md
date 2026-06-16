# Client Reconciliation — QBO ↔ Supabase

## 2026-06-16 update — cleanup pass done; payments await Ray's confirmation

**Done this pass (no confirmation needed):**
- Merged 3 duplicate client rows: Chris Madden ×3 → 1 (3 jobs); Gabe DaSilva ×2 → 1 (3 jobs).
  Clients 65 → 62.
- Linked 17 more jobs to clients (64 → **81 linked**, 52 still unlinked) via
  `scripts/link-jobs-to-clients.js` (exact full-name or unique-surname only).
  Resolved several recon rows below: `25_047_Costello_Tulip`, `25_038_FF_Kaden` (+ renamed the
  `25_XXX_FF_Kaden` placeholder client to **Allison Kaden**), `25_031_FF_Avedissian`,
  `25_023_Samsel_Chalimar` (→ Chalimar Frees), the Odunlami/Malanga/Samsel/Costello jobs.

**Resolved by Ray (2026-06-16):**
- **Jeff Dunn** ×2 → merged, kept `jeffreysdunn1@gmail.com`; +3 Dunn jobs linked.
- **Tyler Deuel** ×2 → merged, kept `tyler@breatheeasyremodeling.com`; +1 Deuel job linked (now 4 jobs).
- **Riera job CREATED, then RENAMED → `26_032_FF_Williams`** (Ang: the client renamed the project from
  Riera to Williams; Ray updated the QBO customer to `26_032_FF_Williams`). FF, **design_phase**
  (confirmed by Ray), $5,000 total, $800 retainer logged (paid 2026-06-11) → $4,200 outstanding.
  Client still linked to **Jose Riera** (the customer who renamed it; confirm if the client should be
  renamed too). job_id now matches the QBO Customer Display Name exactly → future payments auto-sync
  via the webhook, no further QBO action needed.

After this pass: **134 jobs, 86 client-linked, 48 unlinked.**

**⏳ Payment imports — need Ray to confirm the job mapping before I apply (MONEY data).**
These QBO customers have payments not yet in Supabase. The linking above corroborates most
mappings, but job-number conflicts + unknown ones still need your call. Confirm and I'll import.

| QBO customer | → Supabase job_id | Payments to add | Confidence |
|---|---|---|---|
| Mickael Avedissian | `25_031_FF_Avedissian` | 4,800 + 1,200 + 7,600 + 8,800 = **$22,400** | high (job now linked to this client) |
| Jay Rodriguez | `25_028_Rodriguez_1 Noe` | 1,200 + 9,800 = **$11,000** | high (job now linked) |
| Nimchy Regis | `25_024_FF_Regis` | 3,400 ×2 + 1,400 ×2 = **$9,600** | med (confirm it's Jennifer Regis' job) |
| Nandini Ramesh | `25_030_Ramesh` | 1,000 + 1,000 + 2,500 = **$4,500** | med |
| `25_052_FE_Mendham` (QBO) | `25_053_FE_Mendham`? | 1,800 + 1,500 = **$3,300** | conflict: 052 vs 053 — which # is right? |
| `25_054_Malanga_Subdivide` (QBO) | `25_053_Malanga_Subdivide`? | **$1,200** | conflict: 054 vs 053 |
| `26_025_Samsel_510 Harrison Place` (QBO) | `26_022_Samsel_510 Harrison. Place`? | **$4,000** | conflict: 025 vs 022 |
| Mike Costello | which Costello job? (25_006 / 25_029 / 25_047) | 1,200 + 9,300 = **$10,500** | needs Ray — 3 Costello jobs |
| Nosker_Interiors | ? (client Patrick Nosker exists, no job) | **$2,750** | needs Ray — is there a job? |
| Luis Correia | ? (no job, no client) | 5,200 + 5,800 = **$11,000** | needs Ray — missing job? |

**⏳ Missing job — `Riera`.** QBO customer `26_FF_032_Riera` (client **Jose Riera** already exists,
`ndiriera@yahoo.com`) but **the job isn't in Supabase**. Need: confirm exact `job_id` (is it
`26_032_FF_Riera` to match the `YY_NNN_FF_Name` convention, or literally `26_FF_032_Riera`?), then
create the job (total $5,000 = $800 retainer + $1,400 DP1 + $1,400 DP2 + $1,400 CDs) + add the
$800 retainer payment (paid 2026-06-11). Once created I'll link it to the Jose Riera client.

---

Generated 2026-06-15 after importing the QBO Customer Contact List into the
`clients` table (`scripts/import-clients.js`).

**Result:** 64 clients created (46 with email), 64 of 133 jobs auto-linked
(exact + safe normalized matches). All 64 clients exist and are usable by the
Priority Inbox right now. The items below are the **12 QBO customers that could
not be safely auto-linked to a job** — they need a human decision because the
job number conflicts or the customer uses a legacy (non Job-ID) name.

## How to fix
The invariant is **QBO Customer Display Name === Supabase `job_id`**. For each
row, either rename the QBO customer to match the job, or fix the Supabase
`job_id`. Then **re-run `node scripts/import-clients.js`** — it's idempotent
(skips clients that already exist by email, links any newly-matching jobs).

---

## High confidence — same job, cosmetic/number difference (just confirm & align names)

| QBO customer | Likely Supabase job | Difference | Action |
|---|---|---|---|
| `25_047_Costello_77 Tulip` | `25_047_Costello_Tulip` | extra "77 " | align names (same #25_047) |
| `25_XXX_FF_Kaden` | `25_038_FF_Kaden` | QBO has placeholder `XXX` | set QBO # to `25_038` |
| `Mickael Avedissian` | `25_031_FF_Avedissian` | legacy name | rename QBO → `25_031_FF_Avedissian` |

## Needs your call — job NUMBER conflicts (don't guess)

| QBO customer | Possible Supabase job | Conflict |
|---|---|---|
| `25_052_FE_Mendham` | `25_053_FE_Mendham` | number 052 vs 053 — which is correct? |
| `25_054_Malanga_Subdivide` | `25_053_Malanga_Subdivide` | number 054 vs 053 |
| `26_025_Samsel_510 Harrison Place` | `26_022_Samsel_510 Harrison. Place` | number 025 vs 022 |
| `26_001_Deuel_544` | `26_001_Deuel_544 Valley_Garage` | is QBO `_544` the same job, or a parent/umbrella? |

## Legacy / non Job-ID customers — decide if they map to a job or are just contacts

| QBO customer | Email | Note |
|---|---|---|
| `26_FF_032_Riera` | ndiriera@yahoo.com | **Not in Supabase at all** — add the job, then it links |
| `Anthony Odunlami` | management@pookshillconstruction.com | contractor? relates to the Odunlami jobs (25_002/25_003/25_025) |
| `Chalimar Frees` | — (phone only) | possibly job `25_023_Samsel_Chalimar`? |
| `Jeff Dunn` | jeffreysdunn1@gmail.com | several Dunn jobs exist; note `26_012_Dunn_Parlin` already uses geocon303@gmail.com — which job is this Jeff? |
| `Nosker_Interiors` | — (Patrick Nosker) | no obvious job — vendor/contact? |

---

## Also worth noting (data hygiene, not blocking)
- **6 clients have no clean person name** (QBO "Full name" was blank) and were
  saved with the QBO customer name + a `name needs review` note. Search
  `clients.notes ilike '%needs review%'`.
- **All clients defaulted to `type = 'homeowner'`.** Reclassify
  developers/contractors (e.g. Deuel, Rodriguez/Champion Estates,
  Russo/Building Abundance) to `investor`/`contractor` when convenient.
- **18 clients have no email** — inbox can't match them by email; they fall back
  to surname matching. Add emails in QBO and re-run the import to improve.
