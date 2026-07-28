// The demo backend — a router that lives in the browser.
//
// installDemoApi() replaces window.fetch and answers every `/api/*` call from the
// fixtures instead of the network. One hook covers all ~40 endpoints and all ~30
// call sites, whether they go through apiFetch() or a bare fetch(), so NOT ONE
// component file has to know the demo exists. Anything not matched here falls
// through to the real fetch (fonts, source maps, etc.).
//
// Why intercept rather than run the real serverless functions against a demo
// database: this way the deployed demo is a static bundle with no environment
// variables at all. There is no key to leak and no request that could reach
// RM117's Supabase, QuickBooks, Drive or Gmail even if the routing were wrong.

import { db, update, newId } from './store.js';
import { DEMO_TODAY } from './fixtures/jobs.js';
import {
  financials, QBO_STATUS, INBOX, CALENDAR, DRIVE_QUEUE, CHECKSET_FILES,
  CHECKSET_RESULTS, CHECKSET_OVERVIEW, DELEGATION_MEMBERS, DEMO_WEEK_KEY,
} from './fixtures/integrations.js';
import { CLIENT_LADDER } from '../lib/portal-ladder.js';

// The signed-in "staff member" the demo presents as.
export const DEMO_USER = {
  id: 'demo-user',
  name: 'Demo User',
  email: 'demo@rm117.com',
  is_admin: true,
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const notFound = () => json({ error: 'not_found_in_demo' }, 404);

// ------------------------------------------------------------------ helpers

function sumPayments(jobId) {
  return db().payments
    .filter((p) => p.job_id === jobId)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}

// outstanding is computed, never stored — same rule as the real API.
function enrichJobs() {
  const { jobs, clients } = db();
  const byId = new Map(clients.map((c) => [c.id, c]));
  return jobs.map((j) => ({
    ...j,
    outstanding: j.job_total == null ? null : Number(j.job_total) - sumPayments(j.job_id),
    client: j.client_id ? byId.get(j.client_id) || null : null,
  }));
}

// "Next up" derived from the CLIENT ladder — never the internal phase set, and
// never with a date. Mirrors api/_lib/portal-ladder.js so the demo portal shows
// the same thing the real one does.
const OFF_LADDER = new Set(['lead', 'on_hold', 'completed', 'canceled', 'job_dropped']);
function deriveNextUp(job) {
  if (job.next_milestone_label) {
    return { label: job.next_milestone_label, date: job.next_milestone_date || null };
  }
  const phase = job.phase_override || job.phase;
  if (OFF_LADDER.has(phase)) return { label: null, date: null };
  const idx = CLIENT_LADDER.findIndex((s) => (s.phases || []).includes(phase));
  const next = idx >= 0 ? CLIENT_LADDER[idx + 1] : null;
  return { label: next ? next.label : null, date: null };
}

function portalJobsFor(clientId) {
  return db().jobs
    .filter((j) => j.client_id === clientId)
    .map((j) => {
      const total = Number(j.job_total || 0);
      const paid = sumPayments(j.job_id);
      const timeline = db().phaseEvents
        .filter((e) => e.job_id === j.job_id)
        .map((e) => ({ phase: e.phase, at: e.entered_at }));
      const nextUp = deriveNextUp(j);
      return {
        job_id: j.job_id,
        title: j.client_name || j.job_id,
        address: j.address || null,
        phase: j.phase,
        phase_override: j.phase_override || null,
        next_milestone_label: nextUp.label,
        next_milestone_date: nextUp.date,
        last_update: timeline.length ? timeline[timeline.length - 1].at : j.updated_at,
        timeline,
        billing: total > 0
          ? { total, paid, outstanding: total - paid, dueNow: Math.min(total - paid, 7700) }
          : null,
      };
    });
}

// ------------------------------------------------------------- route table
//
// Each entry: [method, pathname, handler(url, body) -> Response]. Matching is on
// the exact pathname; query strings are read off `url` inside the handler.

const routes = {
  // ---- Jobs -------------------------------------------------------------
  'GET /api/jobs': () => json({ source: 'demo', jobs: enrichJobs() }),

  'POST /api/jobs/update': (url, body) => {
    const { job_id, updates = {} } = body || {};
    return update((s) => {
      const job = s.jobs.find((j) => j.job_id === job_id);
      if (!job) return json({ error: 'Job not found' }, 404);
      const phaseChanged = updates.phase && updates.phase !== job.phase;
      Object.assign(job, updates, { updated_at: new Date().toISOString() });
      // The real API stamps a phase event on every phase change — the demo does
      // too, so the Progress tab and the phase clock behave honestly.
      if (phaseChanged) {
        job.phase_since = new Date().toISOString();
        s.phaseEvents.push({
          id: newId('pe'), job_id, phase: updates.phase,
          entered_at: new Date().toISOString(), note: null, created_at: new Date().toISOString(),
        });
      }
      return json({ source: 'demo', persisted: true, job, renamed: null });
    });
  },

  'POST /api/jobs/create': (url, body) => update((s) => {
    const b = body || {};
    const row = {
      job_id: b.job_id || `26_xxx_${(b.client_name || 'New').split(' ').pop()}`,
      client_id: b.client_id || null, referred_by_id: null,
      client_name: b.client_name || null, address: b.address || null,
      phase: b.phase || 'lead', phase_override: null,
      job_total: b.job_total ?? null, amount_billed: 0, bill_flag: false,
      is_forefront: Boolean(b.is_forefront), is_fire_escape: Boolean(b.is_fire_escape),
      ff_commission: b.ff_commission ?? null, ff_commission_paid: null,
      notes: b.notes || null, last_correspondence: null, last_email_date: null,
      last_email_subject: null, import_notes: null, import_needs_review: false,
      next_milestone_label: null, next_milestone_date: null, sub_phase: null,
      design_phase_count: b.design_phase_count ?? null, drive_folder_id: null,
      drive_files_sent_folder_id: null, board_position: 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      phase_since: new Date().toISOString(),
    };
    s.jobs.unshift(row);
    s.phaseEvents.push({
      id: newId('pe'), job_id: row.job_id, phase: row.phase,
      entered_at: row.created_at, note: null, created_at: row.created_at,
    });
    return json({ source: 'demo', persisted: true, job: row, drive: null }, 201);
  }),

  'GET /api/jobs/next-number': (url) => {
    const yy = url.searchParams.get('yy') || '26';
    const used = db().jobs
      .map((j) => /^(\d{2})_(\d{3})_/.exec(j.job_id))
      .filter((m) => m && m[1] === yy)
      .map((m) => Number(m[2]));
    const max = used.length ? Math.max(...used) : 0;
    return json({ yy: Number(yy), driveMax: max, driveNumbers: used.sort((a, b) => a - b), source: 'demo' });
  },

  'POST /api/jobs/rename': (url, body) => {
    const { job_id, new_job_id, dryRun } = body || {};
    if (dryRun) {
      return json({
        dryRun: true, from: job_id, to: new_job_id,
        plan: [
          { system: 'App database', action: `Rename job and cascade ${db().payments.filter((p) => p.job_id === job_id).length} payment(s), phase events and documents`, ok: true },
          { system: 'QuickBooks', action: `Rename customer "${job_id}" → "${new_job_id}"`, ok: true, demo: true },
          { system: 'Google Drive', action: `Rename folder "${job_id}" → "${new_job_id}"`, ok: true, demo: true },
        ],
      });
    }
    return update((s) => {
      const job = s.jobs.find((j) => j.job_id === job_id);
      if (!job) return json({ error: 'Job not found' }, 404);
      for (const p of s.payments) if (p.job_id === job_id) p.job_id = new_job_id;
      for (const e of s.phaseEvents) if (e.job_id === job_id) e.job_id = new_job_id;
      for (const f of s.forefront) if (f.job_id === job_id) f.job_id = new_job_id;
      job.job_id = new_job_id;
      return json({ ok: true, from: job_id, to: new_job_id, job });
    });
  },

  'GET /api/jobs/design-phases': (url) => json({
    jobId: url.searchParams.get('jobId'),
    suggestion: 2,
    confidence: 'high',
    quote: 'The Architect shall provide Design Phase I (schematic) and Design Phase II (design development) services as described herein.',
    fileName: 'Signed Proposal — demo.pdf',
    demo: true,
  }),

  'GET /api/jobs/proposal-docs': (url) => {
    if (url.searchParams.get('fileId')) return json({ error: 'demo_no_file' }, 404);
    return json({
      files: [
        { id: 'demo-prop-1', name: 'Signed Proposal — 2026-06-30.pdf', modifiedTime: '2026-06-30T16:20:00Z', size: 284113 },
      ],
      demo: true,
    });
  },

  'GET /api/jobs/checkset-files': () => json(CHECKSET_FILES),

  // ---- Clients & contacts -----------------------------------------------
  'GET /api/clients': () => json({ source: 'demo', clients: db().clients }),

  'POST /api/clients': (url, body) => update((s) => {
    const b = body || {};
    if (b.id) {
      const c = s.clients.find((x) => x.id === b.id);
      if (!c) return json({ error: 'Client not found' }, 404);
      Object.assign(c, b);
      return json({ source: 'demo', persisted: true, client: c });
    }
    const c = { id: newId('c'), type: 'homeowner', is_active: true, ...b };
    s.clients.push(c);
    return json({ source: 'demo', persisted: true, client: c }, 201);
  }),

  'GET /api/client-contacts': (url) => {
    const clientId = url.searchParams.get('client_id');
    return json({ contacts: db().contacts.filter((c) => c.client_id === clientId && c.is_active) });
  },

  'POST /api/client-contacts': (url, body) => update((s) => {
    const b = body || {};
    if (b.id) {
      const c = s.contacts.find((x) => x.id === b.id);
      if (c) Object.assign(c, b);
      return json({ contact: c });
    }
    const c = { id: newId('cc'), is_primary: false, is_active: true, ...b };
    s.contacts.push(c);
    return json({ contact: c }, 201);
  }),

  'DELETE /api/client-contacts': (url) => update((s) => {
    const id = url.searchParams.get('id');
    const c = s.contacts.find((x) => x.id === id);
    // Deactivates rather than deletes — same as the real endpoint, so the record
    // of what that person was told survives.
    if (c) c.is_active = false;
    return json({ ok: true, deactivated: true });
  }),

  // ---- Payments & Forefront ---------------------------------------------
  'GET /api/payments': (url) => {
    const jobId = url.searchParams.get('job_id');
    const rows = jobId ? db().payments.filter((p) => p.job_id === jobId) : db().payments;
    return json({ source: 'demo', payments: [...rows].sort((a, b) => String(b.paid_date).localeCompare(String(a.paid_date))) });
  },

  'POST /api/payments': (url, body) => update((s) => {
    const b = body || {};
    if (!b.job_id) return json({ error: 'job_id is required' }, 400);
    if (!b.amount || Number(b.amount) <= 0) return json({ error: 'amount must be > 0' }, 400);
    const row = {
      id: newId('p'), job_id: b.job_id, amount: Number(b.amount),
      payment_method: b.payment_method, payment_type: b.payment_type,
      paid_date: b.paid_date, notes: b.notes || null, qbo_invoice_id: null,
      qbo_payment_id: null, payment_type_locked: false,
      import_notes: null, import_needs_review: false, created_at: new Date().toISOString(),
    };
    s.payments.push(row);
    return json({ source: 'demo', persisted: true, payment: row }, 201);
  }),

  'GET /api/forefront': () => json({ source: 'demo', commissions: db().forefront }),

  'POST /api/forefront': (url, body) => update((s) => {
    const { job_id, amount, date, method, notes } = body || {};
    const row = s.forefront.find((f) => f.job_id === job_id);
    if (!row) return json({ error: 'Commission not found' }, 404);
    row.payment_history.push({ amount: Number(amount), date, method, notes: notes || '' });
    row.amount_paid = row.payment_history.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    if (row.amount_paid >= Number(row.total_commission)) row.status = 'paid';
    return json({ commission: row });
  }),

  // ---- Phase events ------------------------------------------------------
  'GET /api/phase-events': (url) => {
    const jobId = url.searchParams.get('job_id');
    const rows = db().phaseEvents.filter((e) => e.job_id === jobId);
    return json({ source: 'demo', events: [...rows].sort((a, b) => a.entered_at.localeCompare(b.entered_at)) });
  },

  'POST /api/phase-events': (url, body) => update((s) => {
    const b = body || {};
    const existing = s.phaseEvents.find((e) => e.job_id === b.job_id && e.phase === b.phase);
    if (existing) {
      existing.entered_at = b.entered_at;
      return json({ event: existing });
    }
    const row = { id: newId('pe'), job_id: b.job_id, phase: b.phase, entered_at: b.entered_at, note: b.note || null, created_at: new Date().toISOString() };
    s.phaseEvents.push(row);
    return json({ event: row }, 201);
  }),

  'DELETE /api/phase-events': (url) => update((s) => {
    const jobId = url.searchParams.get('job_id');
    const phase = url.searchParams.get('phase');
    s.phaseEvents = s.phaseEvents.filter((e) => !(e.job_id === jobId && e.phase === phase));
    return json({ ok: true });
  }),

  // ---- Field notes -------------------------------------------------------
  'GET /api/field-notes': (url) => {
    const jobId = url.searchParams.get('job_id');
    const rows = jobId ? db().fieldNotes.filter((n) => n.job_id === jobId) : db().fieldNotes;
    return json({ source: 'demo', notes: [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)) });
  },

  'POST /api/field-notes': (url, body) => update((s) => {
    const b = body || {};
    const row = {
      id: newId('fn'), job_id: b.job_id, phase: b.phase || null, body: b.body || '',
      author_name: DEMO_USER.name, author_email: DEMO_USER.email,
      attachments: b.attachments || [], latitude: b.latitude ?? null, longitude: b.longitude ?? null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    s.fieldNotes.unshift(row);
    return json({ note: row }, 201);
  }),

  'PATCH /api/field-notes': (url, body) => update((s) => {
    const b = body || {};
    const n = s.fieldNotes.find((x) => x.id === b.id);
    if (n) Object.assign(n, { body: b.body ?? n.body, updated_at: new Date().toISOString() });
    return json({ note: n });
  }),

  'DELETE /api/field-notes': (url) => update((s) => {
    const id = url.searchParams.get('id');
    s.fieldNotes = s.fieldNotes.filter((n) => n.id !== id);
    return json({ ok: true });
  }),

  'POST /api/field-notes/upload': () => json({ path: `demo/uploads/${newId('file')}.jpg`, demo: true }),

  // ---- Saved documents ---------------------------------------------------
  'GET /api/proposals': (url) => {
    const id = url.searchParams.get('id');
    if (id) {
      const p = db().proposals.find((x) => x.id === id);
      return p ? json({ source: 'demo', proposal: p }) : json({ error: 'Proposal not found' }, 404);
    }
    return json({ source: 'demo', proposals: db().proposals });
  },

  'POST /api/proposals': (url, body) => update((s) => {
    const b = body || {};
    if (b.id) {
      const p = s.proposals.find((x) => x.id === b.id);
      if (p) Object.assign(p, { content: b.content, updated_at: new Date().toISOString() });
      return json({ proposal: p });
    }
    const p = { id: newId('pr'), job_id: b.job_id || null, template_id: null, content: b.content || {}, status: 'draft', docusign_envelope_id: null, sent_date: null, signed_date: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    s.proposals.unshift(p);
    return json({ proposal: p }, 201);
  }),

  'DELETE /api/proposals': (url) => update((s) => {
    const id = url.searchParams.get('id');
    s.proposals = s.proposals.filter((p) => p.id !== id);
    return json({ ok: true });
  }),

  'GET /api/letters': (url) => {
    const id = url.searchParams.get('id');
    if (id) {
      const l = db().letters.find((x) => x.id === id);
      return l ? json({ source: 'demo', letter: l }) : json({ error: 'Letter not found' }, 404);
    }
    return json({ source: 'demo', letters: db().letters });
  },

  'POST /api/letters': (url, body) => update((s) => {
    const b = body || {};
    if (b.id) {
      const l = s.letters.find((x) => x.id === b.id);
      if (l) Object.assign(l, { content: b.content, updated_at: new Date().toISOString() });
      return json({ letter: l });
    }
    const l = { id: newId('lt'), job_id: b.job_id || null, content: b.content || {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    s.letters.unshift(l);
    return json({ letter: l }, 201);
  }),

  'DELETE /api/letters': (url) => update((s) => {
    const id = url.searchParams.get('id');
    s.letters = s.letters.filter((l) => l.id !== id);
    return json({ ok: true });
  }),

  // Delivering a generated PDF to Drive needs Drive write access, which the demo
  // has none of — say so plainly rather than faking a success.
  'POST /api/deliver': () => json({
    error: 'Google Drive is not connected in this demo. In the real app this uploads the generated PDF into the job\'s "Files Sent" folder.',
    demo: true,
  }, 503),

  // ---- QuickBooks --------------------------------------------------------
  'GET /api/qbo/status': () => json(QBO_STATUS),

  'GET /api/qbo/financials': (url) => json(financials({
    basis: url.searchParams.get('basis') || 'sent',
    start: url.searchParams.get('start') || '2026-07-01',
    end: url.searchParams.get('end') || '2026-09-30',
  })),

  'POST /api/qbo/create-invoice': (url, body) => json({
    invoice: { Id: newId('inv'), DocNumber: String(1050 + Math.floor(Math.random() * 40)), TotalAmt: Number(body?.amount || 0) },
    demo: true,
    note: 'Demo only — no invoice was created in QuickBooks.',
  }),

  'POST /api/qbo/create-customer': (url, body) => json({
    customer: { Id: newId('cust'), DisplayName: body?.job_id },
    demo: true,
  }),

  // ---- Google: inbox, calendar, drive ------------------------------------
  'GET /api/inbox': () => json(INBOX),
  'GET /api/calendar': () => json(CALENDAR),

  'GET /api/drive/new-folders': () => {
    const dismissed = new Set(db().dismissedDriveFolders);
    return json({ ...DRIVE_QUEUE, queue: DRIVE_QUEUE.queue.filter((f) => !dismissed.has(f.folderId)) });
  },

  'POST /api/drive/import': (url, body) => update((s) => {
    const b = body || {};
    if (b.dismiss) {
      s.dismissedDriveFolders.push(b.folderId);
      return json({ dismissed: true, folderId: b.folderId });
    }
    const folder = DRIVE_QUEUE.queue.find((f) => f.folderId === b.folderId);
    if (!folder) return json({ error: 'Folder not found' }, 404);
    // Imports land with no client and flagged for review — exactly like the real
    // sync, because a folder name carries no client record.
    const row = {
      job_id: folder.name.trim(), client_id: null, referred_by_id: null,
      client_name: folder.lastName, address: null,
      phase: folder.kind === 'lead' ? 'lead' : 'survey_zoning', phase_override: null,
      job_total: null, amount_billed: 0, bill_flag: false,
      is_forefront: false, is_fire_escape: false, ff_commission: null, ff_commission_paid: null,
      notes: null, last_correspondence: null, last_email_date: null, last_email_subject: null,
      import_notes: 'Imported from Google Drive — needs a client and a contract total.',
      import_needs_review: true,
      next_milestone_label: null, next_milestone_date: null, sub_phase: null,
      design_phase_count: null, drive_folder_id: folder.folderId,
      drive_files_sent_folder_id: null, board_position: 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      phase_since: new Date().toISOString(),
    };
    s.jobs.unshift(row);
    s.dismissedDriveFolders.push(folder.folderId);
    return json({ job: row, folderName: folder.name }, 201);
  }),

  // ---- Drawing QA --------------------------------------------------------
  'GET /api/checksets/sets': () => json({ set: CHECKSET_RESULTS.set }),
  'POST /api/checksets/sets': () => json({ set: CHECKSET_RESULTS.set }),
  'PATCH /api/checksets/sets': (url, body) => json({ set: { ...CHECKSET_RESULTS.set, status: body?.status || 'in_review' } }),
  'GET /api/checksets/overview': () => json(CHECKSET_OVERVIEW),
  'GET /api/checksets/results': () => json(CHECKSET_RESULTS),
  'PATCH /api/checksets/results': (url, body) => json({ ...CHECKSET_RESULTS, ...(body || {}), saved: true }),
  'POST /api/checksets/analyze': () => json({
    ...CHECKSET_RESULTS,
    analyzed: true,
    demo: true,
    note: 'Demo result. In the real app this runs the sheet through the 90-item checklist with Claude vision.',
  }),

  // ---- Weekly planner ----------------------------------------------------
  'GET /api/delegation': (url) => {
    const week = url.searchParams.get('week') || DEMO_WEEK_KEY;
    return json({
      source: 'demo',
      members: DELEGATION_MEMBERS,
      strokes: db().delegationStrokes.filter((s) => s.week_key === week),
      notes: db().delegationNotes.filter((n) => n.week_key === week),
      me: { email: DEMO_USER.email, is_admin: DEMO_USER.is_admin },
    });
  },

  'POST /api/delegation': (url, body) => update((s) => {
    const b = body || {};
    if (b.day_index != null) {
      const key = (n) => n.week_key === b.week && n.row_owner_email === b.row_owner_email && n.day_index === b.day_index;
      const existing = s.delegationNotes.find(key);
      if (!b.text || !b.text.trim()) {
        s.delegationNotes = s.delegationNotes.filter((n) => !key(n));
        return json({ source: 'demo', note: null });
      }
      if (existing) {
        Object.assign(existing, { text: b.text, updated_at: new Date().toISOString() });
        return json({ source: 'demo', note: existing });
      }
      const note = { id: newId('dn'), week_key: b.week, row_owner_email: b.row_owner_email, day_index: b.day_index, text: b.text, created_by_email: DEMO_USER.email, updated_at: new Date().toISOString() };
      s.delegationNotes.push(note);
      return json({ source: 'demo', note });
    }
    const stroke = { id: newId('ds'), week_key: b.week, row_owner_email: b.row_owner_email, points: b.points, color: b.color || null, created_by_email: DEMO_USER.email, created_at: new Date().toISOString() };
    s.delegationStrokes.push(stroke);
    return json({ source: 'demo', stroke });
  }),

  'DELETE /api/delegation': (url, body) => update((s) => {
    const b = body || {};
    const week = b.week || url.searchParams.get('week');
    const owner = b.row_owner_email || url.searchParams.get('row_owner_email');
    const strokeId = b.id || url.searchParams.get('id');
    s.delegationStrokes = strokeId
      ? s.delegationStrokes.filter((x) => x.id !== strokeId)
      : s.delegationStrokes.filter((x) => !(x.week_key === week && x.row_owner_email === owner));
    return json({ ok: true });
  }),

  // ---- Client portal -----------------------------------------------------
  // The demo signs in as staff, so /me reports the staff role and the portal is
  // reached through the staff preview — the same path Ang uses.
  'GET /api/portal/me': () => json({ role: 'staff' }),

  'GET /api/portal/preview': (url) => {
    const clientId = url.searchParams.get('client_id');
    const client = db().clients.find((c) => c.id === clientId);
    if (!client) return json({ error: 'client_not_found' }, 404);
    return json({
      role: 'staff', preview: true,
      client: { name: client.name, email: client.email, type: client.type, company: client.company || null },
      jobs: portalJobsFor(client.id),
    });
  },

  'GET /api/portal/files': () => json({ files: [], demo: true }),
  'GET /api/portal/messages': () => json({ messages: [], demo: true }),
  'GET /api/portal/history': () => json({
    history: [
      { id: 'h-1', sent_at: '2026-07-18T16:04:00Z', to: 'a.brenner@rosewooddev.example.com', subject: 'Update on your project', body: 'Hi Alicia — quick update: the drawings for 412–418 Halsey St are moving into Construction Drawings. Next up: Permitting.' },
    ],
    demo: true,
  }),

  'POST /api/portal/draft': (url, body) => json({
    to: ['a.brenner@rosewooddev.example.com'],
    subject: 'Update on your project',
    body: `Hi — a quick update on your project.\n\nWe've moved into the next stage of work. You can see the full status any time in your portal.\n\n— ${DEMO_USER.name}, Room 117 Architecture & Design`,
    jobId: body?.job_id || null,
    demo: true,
  }),

  'POST /api/portal/notify': () => json({
    error: 'Sending is disabled in this demo — no email was sent. In the real app this goes out from the signed-in staff member\'s own Gmail, and the magic link inside it is the client\'s login.',
    demo: true,
  }, 503),

  'POST /api/portal/invite': () => json({ error: 'Disabled in the demo — no link was minted.', demo: true }, 503),
  'GET /api/portal/links': () => json({ links: [], demo: true }),
  'POST /api/portal/revoke': () => json({ ok: true, demo: true }),
  'POST /api/portal/pay': () => json({
    error: 'Payments are disabled in this demo. In the real app this opens Intuit\'s hosted checkout for the invoices actually due.',
    demo: true,
  }, 503),
};

// ------------------------------------------------------------------ install

let installed = false;

export function installDemoApi() {
  if (installed) return;
  installed = true;

  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input?.url || '';
    // Only /api/* is ours. Everything else (assets, fonts) goes to the network.
    if (!raw.includes('/api/')) return realFetch(input, init);

    const url = new URL(raw, window.location.origin);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);

    const method = (init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    let body = null;
    if (init.body) {
      try {
        body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      } catch {
        body = init.body;
      }
    }

    const handler = routes[`${method} ${url.pathname}`];
    // A touch of latency so loading states are visible — a demo where everything
    // is instant hides half the UI work.
    await new Promise((r) => setTimeout(r, 90));

    if (!handler) {
      console.warn(`[demo] unhandled ${method} ${url.pathname}`);
      return notFound();
    }
    try {
      return handler(url, body);
    } catch (err) {
      console.error('[demo] handler threw', err);
      return json({ error: String(err?.message || err) }, 500);
    }
  };
}

export { DEMO_TODAY };
