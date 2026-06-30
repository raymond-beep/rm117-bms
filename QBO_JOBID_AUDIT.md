# QuickBooks Job ID Audit — correction checklist

_Generated 2026-06-30. 134 app jobs vs 78 QuickBooks customers._

The rule the sync depends on: **a job's App Job ID must equal its QuickBooks Customer "Display Name" exactly.**

## Summary
| Category | Count | Who fixes |
|---|---|---|
| ✅ Ready now (exact match, clean format) | 50 | — |
| 🔴 **Real mismatch — needs a rename decision** | 0 | **Ray/Angelena** |
| 🟠 Possible mismatch — please verify | 2 | **Ray/Angelena** |
| 🟡 Matches QBO but has spaces (blocked only by app format check) | 15 | **Claude (code fix)** |
| ⚪ New job, not in QBO yet, spaced name | 19 | optional |
| ⚪ New job, not in QBO yet, clean name | 48 | none (customer auto-creates) |

---

## 🔴 SECTION 1 — Real mismatches (DO THESE)
These jobs **already have a QuickBooks customer**, but the App Job ID differs from the QBO name (usually spacing). If you invoice as-is, you'd create a **duplicate** customer. Fix = make the two names identical. Decide per row whether to rename in the **App** or rename the **QuickBooks customer** (QBO keeps its invoice history when renamed).

_None._

## 🟠 SECTION 2 — Please verify (possible matches)
These app jobs *might* correspond to an existing QBO customer (fuzzy match on letters/numbers). Confirm whether they're the same job; if so, align the names like Section 1.

| # | App Job ID | Possible QBO customer | Client |
|---|---|---|---|
| 1 | `24_008_Dunn Fritchey` | `24_008_Dunn_Fritchey` | Craig Fritchey |
| 2 | `24_074_Madden_Mantoloking*` | `24_074_Madden_Mantoloking` | Chris Madden |

## 🟡 SECTION 3 — Matches QBO but has spaces (Claude fixes in code, no action for you)
These App Job IDs **already exactly match** their QuickBooks customer — they just contain spaces, which the app's format check currently rejects. Listed for transparency; relaxing the check makes them invoiceable with no data change.

| App Job ID (= QBO customer) | Client |
|---|---|
| `24_071_Madden_Toms River` | Chris Madden |
| `25_002_Odunlami_Lot 2` | Anthony Odunlami |
| `25_051_Rodriguez_779 Lamberts Mill Rd` | Jay Rodriguez |
| `26_002_Deuel_542 Valley` | Tyler Deuel |
| `26_003_Deuel_544 Valley` | Tyler Deuel |
| `26_004_Easton PA Fire Escapes` |  |
| `26_007_Antunes_307 Ann St` |  |
| `26_011_Kuhn_352 Amherst` | Randy Kuhn                                                    |
| `26_014_FF_Jones_365 Webster Ave` | Paul Jones |
| `26_015_Costello_101 Denman Rd` | Mike Costello |
| `26_018_Deuel_197 Grove` | Trish Hannes |
| `26_024_Costello_77 Benjamin St` | Mike Costello |
| `26_026_Abar_Glen Ave` | Ardi Abar |
| `26_030_Rodriguez_1 Knapp Ave` | Jay Rodriguez |
| `26_039_Sun_Middle Patent` | Josh and Monita |

## ⚪ SECTION 4 — New jobs not yet in QuickBooks (spaced names)
No QBO customer exists for these yet, so there's nothing to duplicate. When first invoiced they'll create a customer using this exact name. Optional: standardize the spacing if you want tidy customer names.

| App Job ID | Client |
|---|---|
| `23_007_Dunn_Antique Car*` | Jeff Dunn |
| `23_044_Dunn_Atlantic Highlands` | Jeff Dunn |
| `24_064_FF_Dirt Diva` | Caitlin Francke Boyle |
| `24_075_DaSilva_Florham Park` | Gabe DaSilva Team |
| `25_003_Odunlami_Lot 1` | Anthony Ondulami |
| `25_008_O'Bagel _Stirling` | Michael Chiavetta |
| `25_009_Samsel_Terry Lane` |  |
| `25_010_Malanga_Harrison St.` | Dom Malanga |
| `25_013_Markovitz Sign` | Tetyana Boyko |
| `25_016_O'Bagel Wayne` |  |
| `25_018_Szeles_18 Yale` | John Szeles |
| `25_019_Antunes_175 E Crescent` |  |
| `25_023_Rodrigues_24 Timber` | Isabel Rodrigues |
| `25_026_Anutnes_54 Woodcliff Lake Road` | Helio Antunes |
| `25_028_Rodriguez_1 Noe` | Jay Rodriguez |
| `25_029_Costello_310 Retford` | Mike Costello |
| `26_001_Deuel_544 Valley_Garage` | Tyler Deuel |
| `26_010_Melrose_458 Lenox` | Jerry Sullivan |
| `26_022_Samsel_510 Harrison. Place` | John Samsel |

## ⚪ SECTION 5 — New jobs, clean format (no action)
48 jobs have a valid Job ID and simply aren't in QuickBooks yet — invoicing them just creates the customer. No action needed.

<details><summary>list</summary>

- `23_029_Leidy_Roselle`
- `23_056_Kupper`
- `23_070_FF_Kosuda`
- `24_012_Dunn_Melillo`
- `24_024_Natale`
- `24_030_Antunes*`
- `24_032_FF_Zietlow`
- `24_033_FF_Szeles_Moore`
- `24_034_FF_Wallden`
- `24_045_FF_Sorkin`
- `24_050_FF_Shipper`
- `24_053_FF_McGrath`
- `24_054_FF_Hernandez-Mayer`
- `24_055_Szeles_Finn`
- `24_061_Manginelli`
- `24_063_FF_Garcia`
- `24_064_Leffler`
- `24_067_Hillal`
- `24_070_Kahn`
- `24_076_FF_Kelleher`
- `24_077_Feniak`
- `24_078_FF_Eng`
- `24_082_LaRose`
- `24_083_ElHassan_Cafe`
- `24_084_Geroldi`
- `25_001_Sztyk`
- `25_002_FF_Warmington`
- `25_003_Samsel_Raritan`
- `25_006_Costello`
- `25_007_FE_Sebastian`
- `25_011_FE_Summit`
- `25_014_Amato`
- `25_015_Figdor_Hauptman`
- `25_020_Migueis`
- `25_022_Dunn_Bathroom`
- `25_023_Samsel_Chalimar`
- `25_024_FF_Regis`
- `25_025_Odulami_Brick`
- `25_027_Malanga_Union`
- `25_030_Ramesh`
- `25_031_FF_Avedissian`
- `25_032_FE_Hickson`
- `25_038_FF_Kaden`
- `25_047_Costello_Tulip`
- `25_053_FE_Mendham`
- `25_053_Malanga_Subdivide`
- `25_085_O'Bagel_Montclair`
- `26_040_FE_Philly`

</details>