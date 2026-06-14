# RM117 — SCHEMA.md
# The Supabase (Postgres) data model for the second-generation BMS.
# Read with PLAN.md (build order), CLAUDE.md (context), and ADR-001 (the decision).
# This is the single source of truth for table shape. Built in Phase 1; populated in Phase 2.

## Conventions
- **Primary keys:** `id` is `uuid` (default `gen_random_uuid()`) unless noted. `jobs` uses
  the human-readable Job ID as its key (see below).
- **Job ID** is the universal key across Sheet (during migration), Drive, QBO, and Supabase.
  Format: `YY_NNN_[FF_]LastName` — must match the QuickBooks Customer Display Name exactly.
- **Money** is stored as `numeric(12,2)`. **Timestamps** are `timestamptz`, default `now()`.
- **`outstanding` is never stored** — it is computed `job_total - sum(payments.amount)`.
- Enumerated fields are written as Postgres `check` constraints (simple, no separate enum types).

---

## Relationships at a glance
- `clients` 1 ──< `jobs`  via `jobs.client_id`  (who is billed)
- `clients` 1 ──< `jobs`  via `jobs.referred_by_id`  (who referred the work IN — nullable)
- `jobs` 1 ──< `payments`, `invoices`, `proposals`, `forefront_commissions`, `threads`, `file_records`
- `threads` 1 ──< `messages`
- `staff` and `clients` are the two identity tables (Clerk-backed).

> **Inbound referrals only.** `referred_by_id` records the contractor/partner who brought us
> the job. We do NOT track outbound referrals (clients we send to contractors) — once we refer
> a client out, that thread is not followed. There is intentionally no outbound-referral field.

---

## Core tables

### `clients`
Everyone external who is connected to a job: investors, contractors who refer work, homeowners.
One record per person/company; all their jobs hang off it. Portal login (Phase 7) attaches here.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `name` | text | person or company display name |
| `type` | text | `check in ('investor','contractor','homeowner','other')` |
| `email` | text | the email on file — used for portal magic-link login (Phase 7) |
| `phone` | text | nullable |
| `company` | text | nullable |
| `clerk_user_id` | text | nullable until the client activates a portal account |
| `notes` | text | nullable |
| `is_active` | boolean | default `true` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `jobs`
The heart of everything. One row per job.
| Field | Type | Notes |
|-------|------|-------|
| `job_id` | text PK | format `YY_NNN_[FF_]LastName`; matches QBO Customer Display Name |
| `client_id` | uuid FK → clients.id | who is billed for this job |
| `referred_by_id` | uuid FK → clients.id | nullable — contractor/partner who brought the job in |
| `client_name` | text | denormalized for display/search (kept in sync with `clients.name`) |
| `address` | text | |
| `phase` | text | single lifecycle field, Ang's vocabulary: `check in ('potential','survey_zoning','design_phase','cd_phase','active','on_hold','completed')`. "Active" = finishing touches before completion (a late phase, not a status). |
| `phase_override` | text | nullable — manual phase label that wins over the derived phase |
| `job_total` | numeric(12,2) | contracted total |
| `amount_billed` | numeric(12,2) | running total invoiced |
| `bill_flag` | boolean | the "ready to bill" flag (was Sheet column P "YES") |
| `is_forefront` | boolean | this job carries a Forefront commission |
| `ff_commission` | numeric(12,2) | nullable — convenience mirror of the commission total |
| `ff_commission_paid` | boolean | nullable — convenience flag |
| `notes` | text | |
| `last_correspondence` | text | nullable |
| `last_email_date` | timestamptz | nullable |
| `last_email_subject` | text | nullable |
| `import_notes` | text | nullable — raw cell content the import script couldn't parse |
| `import_needs_review` | boolean | default `false` — Phase 2 cleanup queue flag |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| *(computed)* `outstanding` | numeric | NOT stored — `job_total - sum(payments.amount)` |

> **No separate job `status` field.** RM117 tracks a single `phase` per job (Ang sets one value
> from the list above). "Potential," "On Hold," and "Completed" are phase values, not a separate
> status axis. A job that goes on hold does not retain which phase it paused at — use `notes` or
> `phase_override` if that ever matters.

### `payments`
Every payment event. Replaces the narrative financial text in the Sheet and drives the
quarterly billing view automatically.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `job_id` | text FK → jobs.job_id | |
| `amount` | numeric(12,2) | |
| `payment_method` | text | `check in ('check','venmo','zelle','qb','cash','other')` |
| `payment_type` | text | `check in ('retainer','dp1','dp2','dp3','cd','final','other')` |
| `paid_date` | date | |
| `qbo_invoice_id` | text | nullable — set when this payment came from a QBO invoice |
| `notes` | text | nullable |
| `import_notes` | text | nullable |
| `import_needs_review` | boolean | default `false` |
| `created_at` | timestamptz | |

### `invoices`
Invoices created from the app (Phase 5). Created in QBO via API; `qbo_invoice_id` ties the
record back so the Phase 4 Zapier webhook can match payment.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `job_id` | text FK → jobs.job_id | |
| `template_id` | uuid FK → templates.id | nullable |
| `line_items` | jsonb | array of `{description, qty, rate, amount}` |
| `total` | numeric(12,2) | |
| `status` | text | `check in ('draft','sent','paid','void')` |
| `qbo_invoice_id` | text | nullable — the QBO invoice this maps to |
| `sent_date` | timestamptz | nullable |
| `due_date` | date | nullable |
| `created_at` | timestamptz | |

### `proposals`
Proposals created from templates (Phase 5). Tracked through DocuSign.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `job_id` | text FK → jobs.job_id | |
| `template_id` | uuid FK → templates.id | |
| `content` | jsonb | filled-in proposal structure (scope, fees, milestones, terms) |
| `status` | text | `check in ('draft','sent','signed')` |
| `docusign_envelope_id` | text | nullable |
| `sent_date` | timestamptz | nullable |
| `signed_date` | timestamptz | nullable |
| `created_at` | timestamptz | |

### `templates`
Reusable templates for proposals, invoices, and emails. Stored in the DB so they can be
iterated without a code change.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `type` | text | `check in ('proposal','invoice','email')` |
| `name` | text | |
| `description` | text | nullable |
| `content` | jsonb | structured for proposal/invoice; html/markdown body for email |
| `is_active` | boolean | default `true` |
| `created_at` | timestamptz | |

### `forefront_commissions`
Replaces the Forefront Commissions tab. One row per Forefront job.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `job_id` | text FK → jobs.job_id | |
| `total_commission` | numeric(12,2) | |
| `amount_paid` | numeric(12,2) | default `0` |
| `payment_history` | jsonb | array of `{amount, date, method}` |
| `status` | text | `check in ('active','completed','closed')` |
| `notes` | text | nullable |
| `import_notes` | text | nullable |
| `import_needs_review` | boolean | default `false` |
| `created_at` | timestamptz | |

### `staff`
Internal users (Clerk-backed).
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `clerk_user_id` | text | |
| `name` | text | |
| `email` | text | |
| `role` | text | `check in ('admin','staff')` — admin = Ray & Ang; staff = everyone else |
| `is_active` | boolean | default `true` |
| `created_at` | timestamptz | |

---

## Client-tier tables (built/used from Phase 7)

### `threads`
One message thread per job.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `job_id` | text FK → jobs.job_id | |
| `subject` | text | nullable |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | bumped on each new message |

### `messages`
Individual messages within a thread. Authored by staff or client; mirrored over the email bridge.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `thread_id` | uuid FK → threads.id | |
| `sender_type` | text | `check in ('staff','client')` |
| `sender_id` | uuid | staff.id or clients.id (not a hard FK — polymorphic) |
| `body` | text | |
| `via` | text | `check in ('portal','email')` — how the message arrived |
| `created_at` | timestamptz | |

### `file_records`
Metadata only — the files themselves stay in Google Drive (*Files Sent* / *Files Received*
per job). The backend service account brokers every access; clients get no Drive permissions.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `job_id` | text FK → jobs.job_id | |
| `drive_file_id` | text | the Google Drive file ID |
| `filename` | text | |
| `folder` | text | `check in ('files_sent','files_received')` |
| `direction` | text | `check in ('to_client','from_client')` |
| `uploaded_by` | text | nullable |
| `created_at` | timestamptz | |

### `notifications`
Email-bridge state for outbound notifications + inbound reply matching.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `job_id` | text FK → jobs.job_id | |
| `thread_id` | uuid FK → threads.id | nullable |
| `type` | text | `check in ('new_message','file_published','invoice_sent','login_invite')` |
| `channel` | text | default `'email'` |
| `status` | text | `check in ('pending','sent','failed')` |
| `provider_message_id` | text | nullable — Resend/Postmark message ID for inbound matching |
| `created_at` | timestamptz | |

---

## Row-level security (RLS)

**Staff (`staff.role in ('admin','staff')`):**
- Full read/write on all tables **except** `staff` itself.
- `staff` table: read/write restricted to `admin` (Ray & Ang).
- (Field-level financial restriction for non-admin staff is architected for later, not enforced in V1.)

**Client (`client` role, Phase 7+):**
- Read-only, scoped by Job-ID ownership, on **only**: `jobs`, `file_records`, `threads`, `messages`
  for jobs where `jobs.client_id` matches the logged-in client.
- Write access limited to: posting `messages` to their own threads, and (stretch) creating
  `file_records` for uploads into their own job's *Files Received*.
- No access to `payments`, `invoices`, `proposals`, `forefront_commissions`, `templates`, `staff`,
  or any other client's rows.

> A client must NEVER access another client's jobs, files, or messages. Every client-facing
> API call verifies Job-ID ownership server-side before returning anything.

---

## Migration fields (Phase 2 only)
`import_notes` (text) and `import_needs_review` (boolean) appear on `jobs`, `payments`, and
`forefront_commissions`. The import script writes raw, unparseable cell content into
`import_notes` and sets `import_needs_review = true`. Phase 2 cleanup works this queue to zero
before the Sheet is retired at the end of Phase 3. These fields can be dropped once migration
is permanently closed out.
