// Transactional email — used ONLY for portal sign-in codes.
//
// ⚠️ This is NOT the sender for client update emails. Those go out through the staffer's own
// Gmail (see gmail-send.js) and must keep doing so: "Ray Arocha sent you an update" gets
// opened, noreply@ gets ignored, and replies land in a real inbox.
//
// A sign-in code is the one message no human is in the loop for — a client asks for it at
// 11pm and it has to arrive in seconds — so it cannot come from a staffer's mailbox. That is
// the entire reason this file exists.
//
// This was blocked for months: verifying a sending domain needs DNS, and rm117.com's DNS sat
// on a Wix account the firm didn't control. That changed 2026-07-23 — the firm's own Wix
// account owns the domain, so SPF/DKIM for rm117.com can finally be published.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// ⚠️ MUST be a domain verified in Resend, or every send 403s.
//
// The verified domain is **send.rm117.com**, NOT rm117.com — and that is deliberate, not a
// stopgap. Resend's free tier allows exactly ONE domain, and send.rm117.com was already
// registered there (unverified since June). Verifying the existing one costs nothing; adding
// rm117.com as a second domain would force a paid upgrade for no benefit.
//
// It is also the safer choice: the SPF/DKIM records live under send.rm117.com, so rm117.com's
// own SPF and MX are untouched and the firm's Google Workspace mail cannot be affected by
// anything done here. Verified 2026-07-23 (DKIM + both SPF records).
const DEFAULT_FROM = 'Room 117 Architecture & Design <portal@send.rm117.com>';

export const hasResend = () => Boolean(process.env.RESEND_API_KEY);

const isProd = () => process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL_ENV === 'production');

// Send a plain-text email. Resolves { delivered: true } on success.
//
// DEV ESCAPE HATCH: with no RESEND_API_KEY configured, outside production, the message is
// printed to the server console instead of sent. That is what makes the login flow testable
// end-to-end before any DNS exists — you read the code out of the terminal. It is hard-gated
// on NOT production: in production a missing key throws, because a sign-in code that silently
// goes nowhere would look to the client exactly like the app being broken.
export async function sendTransactional({ to, subject, text }) {
  if (!to) throw new Error('recipient required');

  if (!hasResend()) {
    if (isProd()) throw new Error('RESEND_API_KEY not configured');
    console.warn(
      `\n[dev-mail] No RESEND_API_KEY — not sending.\n  to: ${to}\n  subject: ${subject}\n\n${text}\n`,
    );
    return { delivered: false, devLogged: true };
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.PORTAL_FROM_EMAIL || DEFAULT_FROM,
      to: [to],
      subject,
      text,
      // A confused client WILL reply to a sign-in code ("I didn't ask for this"), and
      // portal@send.rm117.com is not a mailbox anyone reads. PORTAL_REPLY_TO points those
      // replies at a real inbox. Omitted entirely when unset — an absent Reply-To is better
      // than one aimed at a black hole.
      ...(process.env.PORTAL_REPLY_TO ? { reply_to: process.env.PORTAL_REPLY_TO } : {}),
    }),
  });

  if (!res.ok) {
    // Resend's body explains the real cause (unverified domain, bad key). Surface it to the
    // server log — but never to the client, who would then learn whether the address exists.
    const body = await res.text().catch(() => '');
    throw new Error(`resend_failed ${res.status}: ${body.slice(0, 300)}`);
  }

  return { delivered: true };
}
