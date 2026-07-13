// Everyone attached to a client — the people who get project updates and portal access.
//
// A single `clients.email` never matched reality: the firm's biggest clients are DEVELOPERS
// with teams. Contacts hang off the CLIENT (not the job), so a developer's project manager
// added once is on all of that client's projects.
//
//   GET    ?client_id=…                       -> list
//   POST   { client_id, email, name?, role? }  -> add (or reactivate) a person
//   POST   { id, ... }                         -> edit one
//   DELETE ?id=…                               -> deactivate (never hard-delete: their links
//                                                 and the record of what they were told stay)
import { requireStaff } from './_lib/require-staff.js';
import { getDb, hasDb } from './_lib/db.js';

// Deliberately permissive — real addresses are stranger than any regex. This only catches
// obvious typos ("tyler@", "no-email"), because a bad address here means an update silently
// never arrives.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  if (!(await requireStaff(req, res))) return undefined;
  if (!hasDb()) return res.status(503).json({ error: 'db_not_configured' });
  const db = getDb();

  if (req.method === 'GET') {
    const clientId = new URL(req.url, 'http://localhost').searchParams.get('client_id');
    if (!clientId) return res.status(400).json({ error: 'client_id required' });

    const { data, error } = await db
      .from('client_contacts')
      .select('id, client_id, name, email, role, is_primary, is_active, created_at')
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ contacts: data || [] });
  }

  if (req.method === 'POST') {
    const { id, client_id, name, email, role, is_primary, is_active } = req.body || {};

    // ---- edit an existing contact ----
    if (id) {
      const patch = {};
      if (name !== undefined) patch.name = name || null;
      if (role !== undefined) patch.role = role || null;
      if (is_active !== undefined) patch.is_active = Boolean(is_active);
      if (email !== undefined) {
        if (!EMAIL_RE.test(String(email).trim())) {
          return res.status(400).json({ error: `"${email}" doesn’t look like an email address.` });
        }
        patch.email = String(email).trim();
      }
      patch.updated_at = new Date().toISOString();

      if (is_primary === true) {
        const { data: row } = await db.from('client_contacts').select('client_id').eq('id', id).maybeSingle();
        if (row) {
          // Exactly one primary per client.
          await db.from('client_contacts').update({ is_primary: false }).eq('client_id', row.client_id);
          patch.is_primary = true;
        }
      }

      const { data, error } = await db.from('client_contacts').update(patch).eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      await syncPrimaryToClient(db, data.client_id);
      return res.status(200).json({ contact: data });
    }

    // ---- add someone ----
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    const addr = String(email || '').trim();
    if (!EMAIL_RE.test(addr)) {
      return res.status(400).json({ error: `"${email || ''}" doesn’t look like an email address.` });
    }

    // Adding someone who's already there (perhaps deactivated) reactivates them rather than
    // erroring on the unique index — that's what a human means by "add them back".
    const { data: existing } = await db
      .from('client_contacts')
      .select('id')
      .eq('client_id', client_id)
      .ilike('email', addr)
      .maybeSingle();

    if (existing) {
      const { data, error } = await db
        .from('client_contacts')
        .update({
          is_active: true,
          name: name || null,
          role: role || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ contact: data, reactivated: true });
    }

    // The first contact a client ever gets is their primary.
    const { count } = await db
      .from('client_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client_id);

    const { data, error } = await db
      .from('client_contacts')
      .insert({
        client_id,
        email: addr,
        name: name || null,
        role: role || null,
        is_primary: !count,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await syncPrimaryToClient(db, client_id);
    return res.status(201).json({ contact: data });
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    if (!id) return res.status(400).json({ error: 'id required' });

    // Deactivate, don't delete. Their magic links cascade-revoke on a real delete, and the
    // record of what they were told is worth keeping — "we told your PM on the 4th" only
    // works if the row survives them leaving the firm.
    const { data, error } = await db
      .from('client_contacts')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Someone who's off the project shouldn't keep a working way in.
    await db
      .from('portal_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('contact_id', id)
      .is('revoked_at', null);

    return res.status(200).json({ contact: data, links_revoked: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// `clients.email` stays as a mirror of the primary contact — the portal's legacy Clerk path,
// the client picker and several older screens still read it, and letting the two drift would
// be a slow-burning data bug.
async function syncPrimaryToClient(db, clientId) {
  const { data: primary } = await db
    .from('client_contacts')
    .select('email')
    .eq('client_id', clientId)
    .eq('is_primary', true)
    .eq('is_active', true)
    .maybeSingle();
  if (primary?.email) {
    await db.from('clients').update({ email: primary.email }).eq('id', clientId);
  }
}
