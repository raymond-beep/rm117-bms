# Client Reconciliation — QBO ↔ Supabase

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
