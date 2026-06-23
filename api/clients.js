// GET /api/clients — list clients for the Details-tab client picker (Phase 7 backbone).
// Read-only; ordered by name. Supabase-backed with a small mock fallback so the UI
// boots clean pre-Phase-1.
import { getDb, hasDb } from './_lib/db.js';
import { requireStaff } from './_lib/require-staff.js';

const MOCK_CLIENTS = [
  { id: 'mock-c1', name: 'Frank Chou', type: 'homeowner', email: 'frank@example.com', phone: null, company: null, is_active: true },
  { id: 'mock-c2', name: 'Monita Sun', type: 'investor', email: 'monita@example.com', phone: null, company: 'Sun Holdings', is_active: true },
];

const FIELDS = 'id, name, type, email, phone, company, is_active';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  try {
    if (!hasDb()) return res.status(200).json({ source: 'mock', clients: MOCK_CLIENTS });
    const db = getDb();
    const { data, error } = await db
      .from('clients')
      .select(FIELDS)
      .order('name', { ascending: true });
    if (error) throw error;
    res.status(200).json({ source: 'supabase', clients: data || [] });
  } catch (err) {
    console.error('[api/clients]', err);
    res.status(500).json({ error: err.message });
  }
}
