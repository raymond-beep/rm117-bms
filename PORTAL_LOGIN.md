# Client Portal Sign-In — canonical doc

**Status: LIVE in production at https://portal.rm117.com (2026-07-23).**
Everything below is built, deployed and verified. The one remaining task is **Phase C — the
"Client Login" button on the Wix marketing site**, which cannot be automated and is written up
step by step at the bottom of this file.

---

## Why this exists

Until now the magic link **was** the login: staff press "✉ Notify client", the client gets an email
with a link, and clicking it signs them in. That works beautifully right up until the client deletes
the email — after which the only way back in is phoning the office.

This adds a **front door**. A client goes to `portal.rm117.com`, types their email, receives a
6-digit code, and lands in the same portal.

**Deliberately NOT passwords.** Ray asked for "a username and password like QuickBooks" (2026-07-23);
the substance of that request — a visible login, the client proves who they are, they see their
projects — is delivered by a mailed code without a Clerk production instance, a sign-up flow, a reset
flow, or Angelena becoming the password-reset desk. A homeowner won't keep a password and a
developer won't tolerate one.

## ⚠️ Two doors, one session — do not "fix" this

| Door | How | Verifies identity? |
|------|-----|--------------------|
| **Magic link** | Rides in the client update email; one click | **No** — possession of the email is the credential |
| **Email + code** | `portal.rm117.com`, type email → 6-digit code | **Yes** — must control the inbox |

Both call the same `signSession()`, so there is only ever one authorization path to maintain.

**The magic link stays.** Killing "any update?" emails is the portal's entire purpose, and making a
client type a code to read an update you just sent them is exactly the friction that stops a portal
being used. State the consequence plainly rather than pretending otherwise: **while both doors are
live, the link is the weaker one and it sets the security bar.** That is an accepted trade (Ray,
2026-07-13, reaffirmed when asked directly). **Do not put a code in front of the update link.**

## Files

| File | Purpose |
|------|---------|
| `api/_lib/portal-login-code.js` | Pure crypto + policy: mint/hash/verify codes, expiry, attempt cap, throttle, email wording. Unit-tested (`tests/portal-login-code.test.js`, 32 tests) |
| `api/_lib/resend-send.js` | Transactional sender — **sign-in codes ONLY** |
| `api/portal/[action].js` | `request-code` + `verify-code` handlers (both PUBLIC — they're how identity is created) |
| `src/components/shell/portal-login.jsx` | The sign-in screen + `shouldShowClientLogin` / `readStaffOverride` |
| `src/rm117-app-shell-v1.jsx` | Chooses which door renders, above the Clerk gate |
| `migrations/0018_portal_login_codes.sql` | The `portal_login_codes` table — **APPLIED** |

## ⚠️ Security details that are easy to break

- **The code is stored as an HMAC keyed by the server secret, NOT a plain digest.** `portal_links`
  can use `sha256` because its token is 256 bits. A 6-digit code has only 1,000,000 possibilities, so
  a bare digest of one falls to exhaustive search instantly from a DB dump. Never "simplify" this.
- **Six digits is not what makes it safe — the 5-attempt cap and 10-minute expiry are.** If you ever
  relax the cap, lengthen the code to match.
- **`request-code` always returns 200**, known address or not. Anything else turns the endpoint into
  an oracle for "is this person an RM117 client?".
- **The contact lookup escapes LIKE wildcards and re-checks equality in JS.** `_` is legal in an email
  local-part *and* is a single-character SQL wildcard — unescaped, `first_last@x.com` would also match
  `firstXlast@x.com`, i.e. one client could be mailed another client's code. The JS check is the authority.
- **Codes are single-use**, and requesting a new one supersedes any outstanding code for that address.

## ⚠️ Which sign-in renders (staff vs client)

Staff and clients share **one Vercel deployment**. Before this existed, a client arriving at
`portal.rm117.com` landed on the staff Google sign-in with no way forward.

- Hostname decides: `portal.rm117.com` → client login. The Vercel URL → Clerk, unchanged.
- `/login` also forces the client door, so it's reachable in local dev.
- **`?staff=1` is the staff escape hatch, and it persists in `sessionStorage`** — the query string is
  gone after the first click, so without persistence a signed-in staffer would be thrown back to the
  client login on their next navigation.

## Infrastructure (all done)

| Thing | Value |
|-------|-------|
| Domain | `portal.rm117.com` → Vercel project `rm117-bms`, A record `76.76.21.21` in Wix DNS |
| TLS | Let's Encrypt, auto-renewing |
| `PORTAL_BASE_URL` | `https://portal.rm117.com` (Production) — without it, emailed links read `rm117-bms.vercel.app`, which looks like phishing |
| `PORTAL_REPLY_TO` | `raymond@rm117.com` (Production) |
| Sending domain | **`send.rm117.com`**, verified in Resend (DKIM + both SPF) |
| Sender | `portal@send.rm117.com` (`DEFAULT_FROM`; `PORTAL_FROM_EMAIL` deliberately unset so there's one source of truth) |
| Resend key | The **send-only** key. Production never needs more than that |

**Why `send.rm117.com` and not `rm117.com`:** Resend's free tier allows exactly one domain, and
`send.rm117.com` was already registered there (unverified since June). Verifying the one that existed
cost nothing; adding `rm117.com` as a second domain would have forced a paid upgrade for no benefit.
It is also safer — the SPF/DKIM records sit under `send.rm117.com`, so **rm117.com's own SPF and MX
are untouched** and the firm's Google Workspace mail cannot be affected.

## Local development

With **no `RESEND_API_KEY`**, outside production, the sender prints the email to the server console
instead of sending it. That makes the whole flow testable with no DNS and no email:

```
npm run dev  →  localhost:5173/login  →  enter a real client contact's email
             →  read the code out of the terminal  →  signed in
```

⚠️ A **dead** key throws; only an **absent** key triggers the console fallback.

---

# ▶ PHASE C — add the "Client Login" button to rm117.com

**This is the only thing left, and it must be done by hand in the Wix Editor.** Wix exposes no REST
API for adding a button, page, or navigation item to a classic Editor site (searched 2026-07-23 —
the only hits were Wix Restaurants menus and Headless checkout redirects, neither applicable). DNS is
writable via API; the site's visual structure is not.

### ⚠️ Add a BUTTON, not a menu item

The site nav is already `HOME · ABOUT US · DESIGN SERVICES · DESIGN EDUCATION · HUMANITARIAN WORK ·
**More**`, and that "More" overflow appears even on a 1600px-wide screen. **A 7th menu item would be
swallowed into the More dropdown**, where no client will ever find it — which is the same as not
having one. A button also reads as an *action* rather than a page, which is what this is.

### Step by step

1. Go to **manage.wix.com** → select **Room 117 Design** → **Edit Site**.
2. In the editor, click anywhere in the **header strip** (the white band holding "ROOM 117", the
   search box, and the menu) so the header is the selected section.
3. Left toolbar → **Add Elements** (the `+`) → **Button** → choose a plain **text or outlined**
   button (not a big filled one — see styling below).
4. **Drag it into the header**, to the right of "More". Wix will show alignment guides; line its
   vertical centre up with the menu text.
5. With the button selected, click **Change Text** and set it to:
   ```
   Client Login
   ```
6. Click the **Link** icon (🔗) on the button → **Web Address** → paste:
   ```
   https://portal.rm117.com
   ```
   → set **Opens in: New Tab** → **Done**.
7. **Styling** — keep it quieter than the brand. This serves existing clients, not prospects, so it
   must not compete with the portfolio work for attention. An outlined or plain-text button in the
   site's existing grey (`#6E6E6E`-ish, matching the nav) is right; a filled accent button is not.
   Match the nav's font and letter-spacing so it reads as part of the header.
8. **Check mobile.** Switch to the **mobile view** (phone icon, top bar) and confirm the button is
   visible and not overlapping the logo or hamburger. Wix keeps a separate mobile layout — a change
   on desktop does **not** always carry over, and this is the single most common way a Wix header
   edit goes wrong. Drag it into place there too if needed.
9. Click **Publish**.

### Then also (optional, 2 minutes)

Add a plain text link in the **footer**. The footer currently holds only the Instagram icon and the
copyright line, so there is plenty of room, and a footer is where people instinctively hunt for
account links. Same URL, same "Client Login" wording.

### Verify when done

- Load `https://www.rm117.com/` and click the button → you should land on the RM117-branded
  **"Client sign-in"** card, not the staff Google screen.
- Enter a **real client contact's** email → they receive a code. (Don't test with a random address;
  an unknown address deliberately returns success and sends nothing.)
- The header is a shared element in Wix, so the button appears on **every page** automatically —
  spot-check one interior page.

---

## What's genuinely left after Phase C

1. **"Pay now" in the portal — still blocked on Ray.** Needs (a) confirmation that QuickBooks
   *Payments* is enabled and (b) a decision on ACH (~1%) vs card (~2.9%). `BillingStrip` has a clean
   seam for the button.
2. **The "Next up" milestone is blank on every active job.** It is the one forward-looking thing a
   client sees, so update emails currently read thin. **Data entry for Angelena, not code.**
3. **One address can legitimately belong to two clients** (a PM working for two developers).
   `client_contacts` is unique on `(client_id, lower(email))`, not on email alone. Today the login
   picks deterministically — primary contact first, then oldest — so that person sees one client's
   projects. If it starts happening for real, the fix is a client picker after verification.
