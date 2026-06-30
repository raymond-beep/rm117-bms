// GET /api/qbo/connect — start the QuickBooks authorization flow.
//
// Redirects the browser to Intuit's consent screen. After the admin approves,
// Intuit redirects back to /api/qbo/callback with an auth code + realmId, which
// we exchange for the seed refresh token. Run once to connect; re-run to reconnect.
//
// Guard: this route initiates an OAuth grant, so it must not be world-open. On
// localhost (the dev-server mint) it's allowed freely; on the deployed app it
// requires ?key=<QBO_CONNECT_KEY>. CSRF for the round-trip is the signed `state`.
import { buildAuthorizeUrl, makeState, callbackUriFromReq, isLocalhostReq } from '../_lib/qbo-oauth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(503).json({ error: 'QBO_CLIENT_ID / QBO_CLIENT_SECRET not set' });
  }

  // Access guard (see header). Localhost is trusted; everything else needs the key.
  if (!isLocalhostReq(req)) {
    const key = (req.query?.key) || new URL(req.url, 'http://x').searchParams.get('key');
    if (!process.env.QBO_CONNECT_KEY || key !== process.env.QBO_CONNECT_KEY) {
      return res.status(403).json({ error: 'Forbidden (set ?key=<QBO_CONNECT_KEY>)' });
    }
  }

  const redirectUri = callbackUriFromReq(req);
  // Sign state with the client secret (a server-only value present whenever this runs).
  const state = makeState(clientSecret);
  const url = buildAuthorizeUrl({ clientId, redirectUri, state });

  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
}
