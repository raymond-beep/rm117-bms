// GET /api/qbo/status — is the QuickBooks integration wired up?
// Lets the UI show the "Send to QuickBooks" controls only when creds are present,
// so the feature stays invisible (rather than erroring) until Phase D is done.
// Returns no secrets — just booleans + the non-sensitive realm/env.
import { requireStaff } from '../_lib/require-staff.js';
import { hasQbo, qboConfig } from '../_lib/qbo.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  const configured = hasQbo();
  const { realmId, sandbox } = qboConfig();
  return res.status(200).json({
    configured,
    env: sandbox ? 'sandbox' : 'production',
    realm: configured ? realmId : null,
  });
}
