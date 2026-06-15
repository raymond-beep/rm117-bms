#!/usr/bin/env python3
"""
RM117 QBO <-> Supabase reconciliation report.

Explains the AR discrepancy created by Ang's workflow (milestone invoices created
upfront at proposal time, sent only when the contract phase is met). Cross-references
live QBO invoices against the Supabase jobs table.

Outputs: recon-report.csv (one row per QBO customer) + a printed summary.
No data is written back to QBO or Supabase. Read-only.
"""
import json, csv, re, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
QBO_FILE = os.environ.get("QBO_FILE")  # path to saved qbo_sales_get_invoices result
JOBS_FILE = os.path.join(HERE, "jobs.json")
OUT_CSV = os.path.join(HERE, "recon-report.csv")

if not QBO_FILE or not os.path.exists(QBO_FILE):
    sys.exit("Set QBO_FILE env var to the saved qbo invoices JSON file.")

with open(QBO_FILE) as f:
    qbo = json.load(f)
invoices = qbo["data"]

with open(JOBS_FILE) as f:
    jobs = json.load(f)

# ---- index Supabase jobs --------------------------------------------------
def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

JOBID_RE = re.compile(r"^(\d{2})_(\d{3})_")

jobs_by_id = {j["job_id"]: j for j in jobs}
jobs_norm = {norm(j["job_id"]): j for j in jobs}
# map of last-name token -> list of jobs (token = each alpha word in the name part)
token_index = {}
for j in jobs:
    name_part = JOBID_RE.sub("", j["job_id"])
    for tok in re.findall(r"[a-z]+", name_part.lower()):
        if tok in ("ff", "fe", "lot", "st", "rd", "ave", "lane", "place", "road"):
            continue
        token_index.setdefault(tok, []).append(j["job_id"])

# manual mapping hints carried over from NEXT_SESSION.md (Ray to confirm)
HINTS = {
    "mickael avedissian": "25_031_FF_Avedissian",
    "jay rodriguez": "25_028_Rodriguez_1 Noe",
    "nimchy regis": "25_024_FF_Regis",
    "nandini ramesh": "25_030_Ramesh",
    "mike costello": None,        # ambiguous - several Costello jobs
    "luis correia": None,         # unknown
    "nosker interiors": None,     # unknown
}

def match_job(cust):
    n = norm(cust)
    # 1. exact job_id
    if n in jobs_norm:
        return jobs_norm[n]["job_id"], "exact", "high"
    # 2. looks like a job id -> match on YY_NNN prefix
    m = JOBID_RE.match(cust.strip())
    if m:
        prefix = f"{m.group(1)}_{m.group(2)}_"
        cands = [jid for jid in jobs_by_id if jid.startswith(prefix)]
        if len(cands) == 1:
            return cands[0], "prefix(YY_NNN)", "high"
        if len(cands) > 1:
            return " | ".join(cands), "prefix-multi", "low"
    # 3. manual hint
    if n in HINTS:
        h = HINTS[n]
        return (h or ""), "hint", ("medium" if h else "none")
    # 4. last-name token
    toks = [t for t in re.findall(r"[a-z]+", n) if len(t) > 2]
    cand = set()
    for t in toks:
        for jid in token_index.get(t, []):
            cand.add(jid)
    if len(cand) == 1:
        return list(cand)[0], "lastname", "medium"
    if len(cand) > 1:
        return " | ".join(sorted(cand)), "lastname-multi", "low"
    return "", "none", "none"

# ---- aggregate QBO invoices by customer -----------------------------------
agg = {}
for inv in invoices:
    name = (inv.get("contact") or {}).get("display_name") or "(no name)"
    amt = float(inv.get("amount") or 0)
    bal = float(inv.get("balance_amount") or 0)
    memo = (inv.get("private_memo") or "")
    is_ob = bool(re.search(r"opening balance", memo, re.I))
    a = agg.setdefault(name, dict(contract=0.0, outstanding=0.0, ob_bal=0.0,
                                  ob_count=0, n=0))
    a["contract"] += amt
    a["outstanding"] += bal
    a["n"] += 1
    if is_ob:
        a["ob_bal"] += bal
        a["ob_count"] += 1

# ---- build rows -----------------------------------------------------------
rows = []
for name, a in agg.items():
    jid, method, conf = match_job(name)
    qbo_paid = a["contract"] - a["outstanding"]
    job = jobs_by_id.get(jid) if jid and "|" not in jid else None
    name_mismatch = "YES" if (method != "exact" and a["ob_count"] < a["n"]) else ""
    rows.append({
        "qbo_customer": name,
        "matched_job_id": jid,
        "match_method": method,
        "match_confidence": conf,
        "phase": job["phase"] if job else "",
        "qbo_contract": round(a["contract"], 2),
        "qbo_paid": round(qbo_paid, 2),
        "qbo_outstanding": round(a["outstanding"], 2),
        "opening_balance_amt": round(a["ob_bal"], 2),
        "n_invoices": a["n"],
        "app_job_total": (job["job_total"] if job else ""),
        "app_paid": (job["paid"] if job else ""),
        "app_outstanding": (round(job["job_total"] - job["paid"], 2) if job else ""),
        "name_mismatch": name_mismatch,
        "paid_delta(qbo-app)": (round(qbo_paid - job["paid"], 2) if job else ""),
    })

rows.sort(key=lambda r: r["qbo_outstanding"], reverse=True)

with open(OUT_CSV, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

# ---- summary --------------------------------------------------------------
tot_out = sum(r["qbo_outstanding"] for r in rows)
tot_ob = sum(r["opening_balance_amt"] for r in rows)
tot_contract = sum(r["qbo_contract"] for r in rows)
tot_paid = sum(r["qbo_paid"] for r in rows)
unmatched = [r for r in rows if not r["matched_job_id"]]
mismatch = [r for r in rows if r["name_mismatch"] == "YES" and r["matched_job_id"]]
real_out = tot_out - tot_ob

print(f"QBO customers:                 {len(rows)}")
print(f"QBO invoices:                  {sum(r['n_invoices'] for r in rows)}")
print(f"Total contract (all invoices): ${tot_contract:,.0f}")
print(f"Total paid (QBO):              ${tot_paid:,.0f}")
print(f"Total outstanding (QBO AR):    ${tot_out:,.0f}")
print(f"  - Opening Balance artifacts: ${tot_ob:,.0f}  ({sum(r['n_invoices'] for r in rows if r['opening_balance_amt']>0)} invoices)")
print(f"  = Outstanding ex-OB:         ${real_out:,.0f}")
print(f"Customers with no Supabase match: {len(unmatched)}")
print(f"Matched but name needs mapping:   {len(mismatch)}")
print()
print(f"Wrote {OUT_CSV}")
print()
print("Top 12 by QBO outstanding:")
print(f"{'customer':<34}{'job_id':<26}{'out':>9}{'OB':>9}  phase")
for r in rows[:12]:
    print(f"{r['qbo_customer'][:33]:<34}{(r['matched_job_id'] or '-')[:25]:<26}"
          f"{r['qbo_outstanding']:>9,.0f}{r['opening_balance_amt']:>9,.0f}  {r['phase']}")
