# RM117 — QuickBooks vs. App Reconciliation (for Angelena)
**Prepared:** 2026-06-15 · Source: live QuickBooks + app database · Read-only, nothing changed

You mentioned you create every milestone invoice in QuickBooks when a proposal goes out, but
only *send* each one once that part of the contract is met. That single fact explains most of
the scary "outstanding" number. Here's the breakdown.

## The big picture

| | Amount |
|---|---:|
| QuickBooks says is owed (total A/R) | **$377,500** |
| — "Opening Balance" invoices (book-setup leftovers, 44 of them) | −$115,500 |
| **Outstanding excluding those** | **$262,000** |

And the tell: in QuickBooks, **$0 is "current" — 100% shows as "overdue,"** $228K of it 90+ days.
A working firm never looks like that. It happens because milestone invoices get a due date the
day they're created (at proposal time) and then sit unsent for months while the work proceeds.

**So the $262K is mostly future contract milestones you haven't billed yet — not money clients
owe you today.** It's backlog/pipeline, not collections.

## Two things for you to decide

### 1. The "Opening Balance" invoices — $115,500
There are 44 invoices labeled *Opening Balance* (e.g. Avedissian $22,000, Luebenow-Suchy $12,400,
Costello/Tulip $10,500). These are almost always created automatically when books are first set
up in QuickBooks. **Are any of these real money still owed, or are they leftovers that should be
cleared/written off?** This is the single biggest swing in the number.

### 2. Completed jobs still showing a balance
Across jobs marked *Completed*, QuickBooks shows **$105,350** outstanding — but **$52,950 of that
is the Opening-Balance leftovers above.** That leaves ~$52K on finished work, and some of that is
likely milestones that were finished but never sent for billing. The full list is in the CSV
(filter `phase = completed`, look at `qbo_outstanding`).

## Payments that exist in QuickBooks but not in the app
Some clients paid under a QuickBooks name that doesn't match our Job ID, so the payment never
synced. Biggest ones to confirm:

| QuickBooks name | Looks like | Payment in QBO, missing in app |
|---|---|---:|
| Mickael Avedissian | 25_031_FF_Avedissian | $22,400 |
| 24_030_Antunes | 24_030_Antunes | $15,000 |
| Nimchy Regis | 25_024_FF_Regis | $9,600 |
| Nandini Ramesh | 25_030_Ramesh | $4,500 |
| Jeff Dunn / 25_001 Sztyk / Feniak | (see CSV) | $4–5K each |

## Job-number collisions (QBO and app disagree on who a number belongs to)
These need a human ruling — same number, different client:

| QuickBooks | App database |
|---|---|
| 26_025_Samsel_510 Harrison Place | 26_025_Dubleski_Holmdel |
| 25_054_Malanga_Subdivide | 25_054_McCalla |
| 25_052_FE_Mendham | 25_052_DaSilva_Dorian |

## Not in the app at all
- **26_FF_032_Riera** — $5,000 contract, $800 retainer paid. Needs to be added.
- **Nosker Interiors** — $8,250 contract, $5,500 outstanding. No matching job.

---
Full line-by-line detail: `recon-report.csv` (one row per QuickBooks customer).
