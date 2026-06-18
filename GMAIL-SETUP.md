# Priority Inbox — Gmail Setup (Ray's interactive steps)

The app code is **done and deployed-ready**. The Priority Inbox on the dashboard reads each
signed-in user's *own* Gmail (read-only) and surfaces emails from clients. It won't show data
until Google OAuth is connected through Clerk — that part can only be done in the Google Cloud
and Clerk dashboards (clicking, not code). Here's exactly what to do.

Until these steps are done the widget shows a friendly **"Connect your Google account"** prompt —
nothing breaks.

---

## Part A — Google Cloud (create the OAuth app + enable Gmail)
> Use a **personal Gmail** for the Google Cloud project — the rm117.com org blocks some of this
> (same note as in CLAUDE.md).

1. Go to <https://console.cloud.google.com> → create a project (e.g. "RM117 App").
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
   (Optional now, needed later for the Calendar card: also enable **Google Calendar API**.)
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - App name: `RM117`, support email: yours
   - **Scopes** → Add → `https://www.googleapis.com/auth/gmail.readonly`
     (later also `https://www.googleapis.com/auth/calendar.readonly`)
   - **Test users** → add `raymond@rm117.com` and `angelena@rm117.com`
     (External apps in "Testing" only work for listed test users — that's fine for 2 people.)
     > **This 100 test-user cap is STAFF-ONLY.** It applies only to people who connect Gmail/Calendar
     > through this Google OAuth app (i.e. staff using the Priority Inbox). **Future portal clients
     > never enter this app** — they log into the portal via Clerk by email — so they can never use
     > up a test-user slot. The client portal does not affect staff Google access. See CLAUDE.md / VISION.md.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**
   - Authorized redirect URI: **paste the one Clerk gives you in Part B step 2** (do Part B first
     to copy it, then come back here).
   - Save the **Client ID** and **Client secret**.

## Part B — Clerk (switch the existing Google connection to custom credentials)
> Google is ALREADY listed under SSO connections ("Used for sign-in · Shared credentials").
> Do NOT use "Add connection" — Clerk won't add a provider twice. Edit the existing one.
1. Clerk dashboard → **Configure → User & authentication → SSO connections**.
2. **Click the existing `Google` row** to open its settings.
3. Turn ON **Use custom credentials**. Clerk shows a **Redirect URI** — copy it into Part A step 4.
   (Shared credentials can't request gmail.readonly or expose the OAuth token — custom is required.)
4. Paste the **Client ID / Client secret** from Part A.
5. **Scopes** field → add `https://www.googleapis.com/auth/gmail.readonly`
   (and `.../calendar.readonly` later). Save.
6. Custom credentials make Clerk store the provider token so the backend can read it
   (`getUserOauthAccessToken`).

## Part C — Connect each user's Google account
Each person does this once, signed into the app:
- Click **Connect Google** on the Priority Inbox card (opens the Clerk profile), **or**
  UserButton → **Manage account → Connected accounts → Connect Google**.
- Approve the Gmail read-only permission.

## Part D — Tell me, and I'll verify
Once A–C are done, ping me. `CLERK_SECRET_KEY` is already in `.env`/Vercel, so no new env vars
are needed. I'll hit `/api/inbox` to confirm messages come back and tune the client filter.

---

## How it works (for reference)
- Frontend sends your Clerk session token to `GET /api/inbox`.
- `api/_lib/clerk.js` verifies it and pulls **your** Google token from Clerk.
- `api/inbox.js` fetches your last 14 days of inbox mail (read-only) and tags senders that match
  a client, using `api/_lib/client-match.js`.
- **Matching today** is by name/email against the jobs list (the `clients` table is empty). As we
  populate client emails, matching gets sharper. Nothing is stored or sent — read-only display.

## Notes / decisions
- **No shared `projects@rm117.com` mailbox** — Ang declined a jobs email. This is per-user only.
- To publish beyond test users later: submit the OAuth consent screen for verification (only
  needed if you add users beyond the test list, or want to remove the "unverified app" screen).
