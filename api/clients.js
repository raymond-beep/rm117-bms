// /api/clients — staff-only client records (shared with the Details tab + portal).
//   GET                 -> list, ordered by name
//   POST { id?, name, type?, email?, phone?, company? }
//                       -> update (id) or create (no id); returns the client
// Read+write so staff can edit a client's contact info (email/phone/etc.).
import { getDb, hasDb } from './_lib/db.js';
import { requireStaff } from './_lib/require-staff.js';

const MOCK_CLIENTS = [
  { id: 'mock-c1', name: 'Frank Chou', type: 'homeowner', email: 'frank@example.com', phone: null, company: null, is_active: true },
  { id: 'mock-c2', name: 'Monita Sun', type: 'investor', email: 'monita@example.com', phone: null, company: 'Sun Holdings', is_active: true },
];

const FIELDS = 'id, name, type, email, phone, company, is_active';
const TYPES = ['investor', 'contractor', 'homeowner', 'other'];

export default async function handler(req, res) {
  if (req.method === 'GET') return list(req, res);
  if (req.method === 'POST') return save(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function list(req, res) {
  if (!(await requireStaff(req, res))) return; // 401/403 already sent
  try {
    if (!hasDb()) return res.status(200).json({ source: 'mock', clients: MOCK_CLIENTS });
    const db = getDb();
    const { data, error } = await db.from('clients').select(FIELDS).order('name', { ascending: true });
    if (error) throw error;
    res.status(200).json({ source: 'supabase', clients: data || [] });
  } catch (err) {
    console.error('[api/clients GET]', err);
    res.status(500).json({ error: err.message });
  }
}

async function save(req, res) {
  if (!(await requireStaff(req, res))) return;
  const { id, name, type, email, phone, company } = req.body || {};
  if (type && !TYPES.includes(type)) return res.status(400).json({ error: `Invalid type: ${type}` });

  // Only set the fields the caller sent; trim strings, empty → null.
  const clean = (v) => (typeof v === 'string' ? (v.trim() || null) : v);
  const patch = {};
  if (name !== undefined) patch.name = clean(name);
  if (type !== undefined) patch.type = type;
  if (email !== undefined) patch.email = clean(email);
  if (phone !== undefined) patch.phone = clean(phone);
  if (company !== undefined) patch.company = clean(company);
  patch.updated_at = new Date().toISOString();

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  try {
    const db = getDb();
    if (id) {
      const { data, error } = await db.from('clients').update(patch).eq('id', id).select(FIELDS).single();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Client not found' });
      return res.status(200).json({ source: 'supabase', persisted: true, client: data });
    }
    if (!patch.name) return res.status(400).json({ error: 'name is required to create a client' });
    const { data, error } = await db.from('clients').insert({ type: 'homeowner', ...patch }).select(FIELDS).single();
    if (error) throw error;
    res.status(201).json({ source: 'supabase', persisted: true, client: data });
  } catch (err) {
    console.error('[api/clients POST]', err);
    res.status(500).json({ error: err.message });
  }
}
