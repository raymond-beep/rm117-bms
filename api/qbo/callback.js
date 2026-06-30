// GET /api/qbo/callback — Intuit redirects here after the admin approves.
//
// Query from Intuit: { code, state, realmId }. We verify the signed state (CSRF),
// exchange the code for tokens, persist the seed refresh token to qbo_tokens, and
// render it once so it can also be pasted into .env (QBO_REFRESH_TOKEN) for local
// dev. The realmId is the connected company — we sanity-check it against the known
// production realm and surface a warning on mismatch rather than silently storing
// the wrong company.
import { getDb, hasDb } from '../_lib/db.js';
import { verifyState, exchangeCodeForTokens, callbackUriFromReq } from '../_lib/qbo-oauth.js';

const EXPECTED_REALM = '193514517070094'; // Room 117 Architecture & Design LLC (production)

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

function page(title, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#1a1a1a}
code,pre{background:#f4f4f5;border:1px solid #e4e4e7;border-radius:6px;padding:2px 6px;font-size:13px}
pre{padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.ok{color:#15803d}.warn{color:#b45309}.err{color:#b91c1c}
h1{font-size:20px}</style></head><body>${bodyHtml}</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q = req.query || new URL(req.url, 'http://x').searchParams;
  const get = (k) => (typeof q.get === 'function' ? q.get(k) : q[k]);
  const code = get('code');
  const state = get('state');
  const realmId = get('realmId');
  const errParam = get('error');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (errParam) {
    return res.status(400).send(page('QBO connect failed',
      `<h1 class="err">Authorization denied</h1><p>Intuit returned: <code>${esc(errParam)}</code></p>`));
  }

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(503).send(page('QBO not configured',
      `<h1 class="err">QBO_CLIENT_ID / QBO_CLIENT_SECRET not set</h1>`));
  }

  // CSRF: the state must be one we signed (with the client secret) and still fresh.
  if (!verifyState(clientSecret, state)) {
    return res.status(400).send(page('QBO connect failed',
      `<h1 class="err">Invalid or expired state</h1><p>Start over at <code>/api/qbo/connect</code>.</p>`));
  }
  if (!code) {
    return res.status(400).send(page('QBO connect failed',
      `<h1 class="err">Missing authorization code</h1>`));
  }

  try {
    const redirectUri = callbackUriFromReq(req);
    const tokens = await exchangeCodeForTokens({ clientId, clientSecret, code, redirectUri });
    const refreshToken = tokens.refresh_token;

    // Persist the seed token (+ realm) so the app survives a restart without the
    // env seed. Best-effort: if qbo_tokens doesn't exist yet, fall through.
    let persisted = false;
    if (refreshToken && hasDb()) {
      try {
        const { error } = await getDb().from('qbo_tokens').upsert({
          id: 'singleton',
          refresh_token: refreshToken,
          realm_id: realmId || null,
          updated_at: new Date().toISOString(),
        });
        if (!error) persisted = true;
      } catch { /* table may not exist yet — env seed still works */ }
    }

    const realmWarn = realmId && realmId !== EXPECTED_REALM
      ? `<p class="warn">⚠️ Connected company realm <code>${esc(realmId)}</code> does not match the
         expected production company <code>${EXPECTED_REALM}</code>. Make sure you authorized the right
         QuickBooks company.</p>`
      : '';

    return res.status(200).send(page('QuickBooks connected', `
      <h1 class="ok">✅ QuickBooks connected</h1>
      ${realmWarn}
      <p>Paste these into <code>.env</code> (and Vercel production env), then restart the dev server:</p>
      <pre>QBO_REFRESH_TOKEN=${esc(refreshToken || '')}
QBO_REALM_ID=${esc(realmId || EXPECTED_REALM)}</pre>
      <p>${persisted
        ? '<span class="ok">Also saved to the <code>qbo_tokens</code> table</span> — the app will read the rotated token from there going forward.'
        : '<span class="warn">Not saved to <code>qbo_tokens</code></span> (table missing or DB off) — the env seed above is required.'}</p>
      <p>This refresh token is shown <strong>once</strong>. The app rotates it automatically from here.
      You can close this tab.</p>
    `));
  } catch (err) {
    console.error('[api/qbo/callback]', err);
    return res.status(502).send(page('QBO connect failed',
      `<h1 class="err">Token exchange failed</h1><pre>${esc(err.message)}</pre>`));
  }
}
