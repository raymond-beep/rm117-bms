# Mail + Correspondence — canonical doc

**Branch `mail-inbox` · 15 commits · NOT merged, NOT deployed · 429 tests green**
Last worked: 2026-07-31.

Read this first when picking the feature back up.

## Verification status (2026-07-31)

| Path | State |
|---|---|
| **Filing a real thread** | ✅ **VERIFIED end to end**, checked against the DB and Drive directly rather than the UI badge |
| **Mark-as-read** | ❌ **BLOCKED** — `gmail.modify` is genuinely not granted (measured, see below) |
| **Sending a reply** | ⏳ still unverified — nothing has left Gmail |

**Filing proof:** DaSilva "235 Munsee Way Rev 3" filed against `25_049_DaSilva_Munsee`
only → `mail_threads` row with 2 messages, both bodies non-blank (4,473 / 5,032
chars), client resolved to Gabe DaSilva, and `235 Munsee Superior Wall Rev3.pdf`
(853,479 bytes) really present in that job's Drive "Files Received" alongside the
firm's own history. **This is real production data — the thread is filed and the
file is in Drive. Leave it; it is a legitimate received file for that job.**

**Mark-as-read is not a code bug.** Querying Google's tokeninfo for the tokens
Clerk holds shows the granted scopes for **both** Ray and Angelena are:
`email profile calendar.readonly gmail.readonly gmail.send userinfo.* openid`
— **no `gmail.modify`**. The endpoint's graceful `{ok:false, reason:'scope_not_granted'}`
is working as designed; unread stays display-only. **Nobody has re-consented yet.**
To re-check: pull the token from Clerk and hit
`https://oauth2.googleapis.com/tokeninfo?access_token=…`. Do not debug the
endpoint before checking the scope list.

---

## Why it exists

The firm's client communication lives **entirely in Gmail**. Measured on the live
database that day:

| System | Rows |
|---|---|
| Gmail | everything (54 threads in Ray's last 30 days) |
| `threads` / `messages` (in-app portal chat) | **0 / 0** |
| `notifications` ("✉ Notify client") | **0** |
| `portal_links` (live) | **0** |

So the app did not have four competing client-comms systems — it had **one that
people use** and three that were built and never entered daily work. The portal
chat is worse than unused: `handleSend` in `api/portal/[action].js` never
notified anyone ("Email notification to the other party is a later slice"), so a
client posting there was announced to nobody and a staff reply likewise. A closed
loop with no doorbell, which is exactly why it has no rows.

⚠️ Caveat on `notifications` = 0: the July cleanup deleted the test contacts and
would have cascaded. It means "not in daily use", **not** "never worked" — the
notify path WAS proven end-to-end in July.

**The conclusion: stop asking anyone to move. Gmail is the transport; the JOB is
where it gets organised.**

---

## What is built and working

Route `/mail`, sidebar "Mail". Reads the **signed-in staffer's own mailbox**
(never a shared one — Ang's call).

- **Threads, not messages**, with SENT mail included, so both halves of a
  conversation are visible.
- **Scopes: Work | Clients | All.** "Work" is the inverted filter — it hides
  known noise (SaaS/bulk/role senders) instead of showing only matched clients.
  The old clients-only filter hid building departments, zoning boards,
  engineers, surveyors, contractors and the firm's own staff, i.e. most of an
  architecture firm's real correspondence.
- **Full body reading.** Quoted history and signatures folded behind a "•••";
  the thread renders as a **conversation** (firm right, client left).
- **Attachments**: in-app PDF/image viewer with ←/→ between them, plus download.
- **Reply / reply-all**, sent as the staffer from their own Gmail, correctly
  threaded. Every recipient shown as a chip; click one to drop it.
- **File to job**: link a thread to one or more jobs, copy the text into
  Supabase, push attachments to the job's Drive "Files Received".
- **Share with client**: whole thread, behind a mandatory preview.

## Files

| File | Purpose |
|---|---|
| `api/inbox.js` | Thread list. Scope filter, thread grouping, unread, `counterparty()` |
| `api/inbox/thread.js` | One full thread — bodies + attachment manifests |
| `api/inbox/attachment.js` | Streams one attachment (proxied so the Google token never reaches the browser) |
| `api/inbox/reply.js` | Reply/reply-all. **Recipients recomputed server-side** |
| `api/inbox/mark-read.js` | Clears Gmail's UNREAD label — needs `gmail.modify` |
| `api/inbox/file.js` | File/unfile a thread against jobs; attachments → Drive |
| `api/inbox/share-preview.js` | "What will the client actually see?" |
| `api/_lib/gmail-read.js` | MIME walking, sanitising, `effectiveMime`, `describePayload` |
| `api/_lib/gmail-send.js` | Send as the staffer; `replySubject`, `buildReferences` |
| `api/_lib/client-match.js` | Sender → client. Now reads `client_contacts` |
| `src/components/mail/Mail.jsx` | The whole page |
| `src/lib/mail-html.js` | Sanitising helpers, `replyRecipients`, `attachmentKind` |
| `src/lib/mail-quote.js` | Splits written text from quoted history/signature |
| `tests/gmail-read.test.js`, `tests/mail-quote.test.js` | 62 tests for the above |

## Migrations — ⚠️ ALREADY APPLIED TO PRODUCTION SUPABASE

Additive only; nothing existing was altered. **Applied 2026-07-30**, so the DB is
ahead of `main` until this branch merges.

- `0020_mail_correspondence.sql` — `mail_threads`, `mail_thread_jobs`,
  `mail_messages`, `mail_attachments`
- `0021_mail_share_with_client.sql` — `mail_messages.hidden_from_client`

---

## Decisions that must not be quietly reversed

- **Filing is ALWAYS a staff action, never a sync.** The Mail page *suggests*
  jobs from the client match; a person confirms. Sender → client → their jobs is
  right often enough to be useful and wrong often enough that it must not
  decide — "Deuel" names five different projects. Same rule the Drive → app sync
  runs on: a wrong link is worse than no link.
- **A thread can belong to SEVERAL jobs** (`mail_thread_jobs`). One developer
  email routinely covers three of their projects; forcing a single job would make
  staff pick a winner and lose the rest.
- **Attachments go to the FIRST job only.** Copying one survey into three
  developer projects would have the app inventing duplicates in the firm's Drive
  that nobody would clean up.
- **Clients see the WHOLE thread, never a filtered slice** (Ray, 2026-07-30).
  Three of seven messages, with replies referencing things they cannot see, reads
  as broken and is worse than showing nothing.
- **…so the safety is a PREVIEW, not a filter.** Ticking "visible to the client"
  loads the preview immediately — sharing cannot be switched on without the real
  conversation in front of you. Messages the client was never on are flagged
  "not sent to them" and can be excluded in one click. Same shape as
  `portal/draft`, which composes the client update email and sends nothing purely
  so the confirm dialog can show the real one.
- **No client linked ⇒ sharing is BLOCKED, not degraded.** With no client we
  cannot say what is new to them; a preview implying everything is safe would be
  worse than none. ~29 Drive-imported jobs are in that state.
- **Reply recipients are recomputed server-side** from the message being
  answered. The UI may DROP recipients (`drop: [email]`) but never add them —
  expressing it as a subtraction makes widening structurally impossible, so no
  staff Gmail account can be used to mail an arbitrary address.
- **Threading needs `In-Reply-To` + `References`, not just Gmail's `threadId`.**
  The threadId only files the sent copy in OUR mailbox; other clients thread on
  the headers. Without them a reply looks right to us and appears as a NEW
  conversation in the client's inbox — a failure invisible from this end.
- **Signature trimming is deliberately conservative** — only markers a client
  actually emits, never "these last lines look like contact details". Hiding
  something the sender wrote is far worse than leaving a signature on screen.
- **Sides in the conversation view are decided by DOMAIN**, not the signed-in
  user: reading a thread, what matters is us vs the client, so a colleague's
  reply sits on your side.

## Gmail's CONCURRENCY limit — the bug that made the list lie

⚠️ **Read this before adding any per-message Gmail call.**

Gmail caps **concurrent** requests per user, separately from any daily quota.
Every fan-out on this page used to be `Promise.all(ids.map(...))` with
`.catch(() => null)`, i.e. one request per message, ~120 at once. Measured on
Ray's mailbox: **5 of 120 metadata reads failed on a cold run and 36 on a second
run moments later** (the first burst still counted against him), all returning
429 `rateLimitExceeded` — and every one was swallowed. A dropped message was
indistinguishable from a message that did not exist.

The visible symptom: the same mailbox reported **20 conversations, then 40, then
36** across consecutive loads, with wrong per-thread message counts, nothing in
the log and nothing on screen. Threads simply went missing from the Mail list —
the exact failure this feature exists to prevent.

**The rule now: never fan out with `Promise.all` over messages.** Use
`mapGmail()` from `api/_lib/gmail-read.js` — six at a time, and it **rejects**
rather than returning a short list, so a hole must be handled instead of
inherited invisibly. `gmailGet()` retries 429/5xx with backoff, jitter and
`Retry-After`; 401/403 still fail fast so a missing scope reports immediately.
After the fix: **120/120 on three consecutive runs, a steady 91 threads in ~2.3s**,
and the page reads 60/60/60. Covered by `tests/gmail-concurrency.test.js`.

Filing (`api/inbox/file.js`) now **aborts** if a body can't be read. It used to
write the blank to Supabase — corrupting the durable record of what a client was
told, which is the whole point of filing.

## Noise: bulk mail is identified by its OWN headers, not a domain list

The "Work" scope was **over half marketing** — 35 of 60 threads on the real
mailbox: Zillow, Autodesk, DealMachine, newsletters from personal-looking
addresses ("AI with Mariah", "Elise Knaack", "Ray Fu"), and the BMS's own portal
sign-in-code emails. `SAAS_DOMAINS` can only catch senders someone thought to
enumerate, and these were precisely the ones nobody would.

`isBulkMail()` (`api/_lib/client-match.js`) keys on **List-Unsubscribe** (RFC
2369/8058), `List-Id`, `Precedence: bulk`, `Auto-Submitted`. A sender must set
these to reach inboxes at scale; a township clerk, engineer or client writing by
hand never does. `api/inbox.js` requests those headers in the metadata call.

Precedence rules, all load-bearing:
- An **exact** client-address match still wins over bulk headers.
- Bulk **beats the surname GUESS** — otherwise a newsletter whose display name
  shares a surname with one of 162 jobs gets promoted to client mail.
- `portal@rm117.com` reads as **automated, not staff** (an automated role address
  at our own domain is still automated).

⚠️ **Deliberately NOT subject/body keyword matching.** A permit expediter chasing
a deadline writes exactly like a marketer, and wrongly hiding one real email
costs far more than showing ten newsletters.

Result: **Work 60 → 13 threads**, with every real correspondent still present
(verified against the full pre-change list). An Anthropic security alert survives
as `project` — it has no List-Unsubscribe, correctly, and hiding security notices
by default would be worse.

## Filing suggests — it does not pre-accept

The File-to-job dialog **starts with nothing ticked**. It used to pre-tick every
suggestion, which made "a person confirms" a rubber stamp: the fastest path
through the dialog accepted all of them. On DaSilva's "235 Munsee Way Rev 3" that
meant filing against four DaSilva jobs and — since **attachments go to the first
job only** — uploading the Munsee drawings into **Florham Park's** Drive folder.
Suggestions are still listed and one click each. Jobs **already filed** do start
ticked; that is recorded state, not a guess.

## Two hard-won bugs worth remembering

1. **The declared MIME type is not trustworthy.** A contractor's drawing set
   arrived as 7 PDFs, every one `application/octet-stream`. Two consequences: the
   preview check saw "not previewable", and the server echoed the generic type
   back, which makes a browser DOWNLOAD regardless of `Content-Disposition`.
   `attachmentKind()` and `effectiveMime()` fall back to the file extension.
2. **Large bodies do not arrive inline.** Above ~a couple hundred KB Gmail omits
   `body.data` and returns an `attachmentId` to fetch separately. Decoding
   `body.data` alone yielded an empty string on exactly the long threads people
   most want to read, and the message rendered blank. `walkParts` records
   `htmlRef`/`textRef` and callers fetch them.

Also: the body was rendered in a sandboxed iframe and is now **inline, sanitised
with DOMPurify**. A separate document cannot flow with the page and its height
had to be negotiated over postMessage, which kept breaking. ⚠️ That trade removed
the origin boundary — DOMPurify is now the only thing between sender HTML and the
page, so its config must stay strict (`style`/`link` blocked so an email cannot
restyle the app; inline `style` attributes kept, which is where email formatting
lives).

---

## ▶ NEXT SESSION — start here

### Must do before merging
1. ~~Remove the local-dev diagnostic in `api/inbox/thread.js`~~ — ✅ done
   (`dc7991d`).
2. **Verify sending a reply** — the last unverified path. See below.
3. Decide whether `scripts/` needs anything; branch is otherwise clean.

### Not yet built
- **Correspondence view in the JobEditor**, replacing the dead `MessagesTab` —
  filed threads + Notify-client sends in one timeline per job. `GET
  /api/inbox/file?jobId=` already returns the filed threads for a job.
- **Client-facing view** of shared threads in the portal (respecting
  `visible_to_client` + `hidden_from_client`).
- **Compose** a new thread from a job/client, contacts pre-filled from
  `client_contacts`, plus **Save as draft** (`gmail.modify` covers drafts).
- **Retire the portal chat**: `MessagesTab` (JobEditor), `MessagesPanel`
  (`src/rm117-portal-v1.jsx`), and the `portal/messages` + `portal/send` actions.
  Ray's call 2026-07-30. Tables stay in the DB, harmless.
- Noise classifier is loose: marketing from real-looking personal addresses
  ("Elise Knaack", "AI with Mariah") lands in Work as `project`.
- No search / no pagination (30 days, 60 threads).

### ⚠️ STILL UNVERIFIED — the one real remaining risk
**Sending a reply.** Nothing has ever left Gmail from this app.

⚠️ **"Email yourself" does NOT work as the test** — it was the recipe here and it
is impossible. A message from you to you has no reply recipient (we filter
ourselves out, correctly), so the composer shows "0 recipients" and Send stays
disabled. Attempting it on 2026-07-31 is what uncovered the "firm spoke last" bug
above, but it cannot exercise the send path.

**The working safe test: send the seed from an address you control that is NOT
`@rm117.com`** (a personal Gmail, or your phone on another account) to
`raymond@rm117.com`. Wait for it in the Mail list, then reply in the app. That
gives a real external recipient without involving a client.

⚠️ **Check the raw headers of the sent copy, not just that it arrived.** Threading
is the part that fails INVISIBLY from this end: a reply missing `In-Reply-To` /
`References` looks perfectly correct in our own mailbox and shows up as a NEW
conversation in the recipient's inbox.

### Re-consent needed for mark-as-read
`gmail.modify` is configured in Google Cloud Console + Clerk but **not granted**
on any live token — every staffer who wants mark-as-read must sign out and back
in and accept the permission. Verified by tokeninfo, not inferred. Nothing else
on the page depends on it.

### Local dev gotcha
`npm run dev` runs the API as plain `node server.js` — **no watch, no reload.**
API edits do nothing until you restart it. This silently wasted a round of
testing: the fixed code was on disk while the browser kept exercising the old
endpoint and still showed unstable thread counts.
