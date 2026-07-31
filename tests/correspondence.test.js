// Per-job correspondence timeline — pure, no db.
import { describe, it, expect } from 'vitest';
import {
  buildTimeline, summarize, resolveRecipients, formatRecipients,
} from '../api/_lib/correspondence.js';

const thread = {
  id: 't1',
  gmail_thread_id: 'g1',
  subject: '235 Munsee Way Rev 3',
  last_message_at: '2026-07-24T16:49:25Z',
  message_count: 2,
  visible_to_client: false,
  filed_at: '2026-07-31T00:33:27Z',
  mail_thread_jobs: [{ job_id: '25_049_DaSilva_Munsee' }, { job_id: '24_075_DaSilva_Florham Park' }],
  messages: [
    {
      id: 'm2', from_name: 'Tim', from_email: 'tim@x.com', sent_at: '2026-07-24T16:49:25Z',
      body_text: 'second', hidden_from_client: false, attachments: [],
    },
    {
      id: 'm1', from_name: 'Peter', from_email: 'peter@x.com', sent_at: '2026-07-24T16:14:59Z',
      body_text: 'first', hidden_from_client: true,
      attachments: [{ filename: 'Rev3.pdf', mime_type: 'application/pdf', size_bytes: 853479, drive_file_id: 'd1' }],
    },
  ],
};

const notification = {
  id: 'n1', type: 'update', status: 'sent', to_email: 'client@x.com',
  subject: 'Update on your project', body: 'We submitted for permit.',
  sent_by: 'raymond@rm117.com', sent_at: '2026-07-28T12:00:00Z', created_at: '2026-07-28T12:00:00Z',
};

describe('buildTimeline', () => {
  it('merges filed threads and notify sends into one newest-first history', () => {
    const t = buildTimeline({ threads: [thread], notifications: [notification] });
    expect(t.map((e) => e.kind)).toEqual(['notification', 'thread']);
    expect(t[0].subject).toBe('Update on your project');
  });

  it('orders messages WITHIN a thread oldest-first, so it reads top to bottom', () => {
    const [entry] = buildTimeline({ threads: [thread] });
    expect(entry.messages.map((m) => m.text)).toEqual(['first', 'second']);
  });

  it('exposes every job a thread is filed against', () => {
    // A developer's email covering three projects must not look like it belongs
    // to this job alone.
    const [entry] = buildTimeline({ threads: [thread] });
    expect(entry.jobs).toEqual(['25_049_DaSilva_Munsee', '24_075_DaSilva_Florham Park']);
  });

  it('carries the attachment manifest with its Drive id', () => {
    const [entry] = buildTimeline({ threads: [thread] });
    const att = entry.messages[0].attachments[0];
    expect(att).toMatchObject({ filename: 'Rev3.pdf', driveFileId: 'd1', size: 853479 });
  });

  it('keeps hidden_from_client visible to STAFF', () => {
    // Staff must be able to see that a message the client was never on is part of
    // a shared thread — that is what the share preview is warning about.
    const [entry] = buildTimeline({ threads: [thread] });
    expect(entry.messages[0].hiddenFromClient).toBe(true);
  });

  it('flags a FAILED notification instead of hiding it', () => {
    // Believing a client was told something they were not is the expensive
    // mistake, so an error stays on the timeline.
    const [entry] = buildTimeline({
      notifications: [{ ...notification, status: 'error', error: 'invalid recipient' }],
    });
    expect(entry.failed).toBe(true);
    expect(entry.error).toBe('invalid recipient');
  });

  it('sorts a dateless entry last rather than to 1970', () => {
    const undated = { ...thread, id: 't2', last_message_at: null, filed_at: null, messages: [] };
    const t = buildTimeline({ threads: [thread, undated], notifications: [notification] });
    expect(t[t.length - 1].id).toBe('t2');
  });

  it('handles empty input', () => {
    expect(buildTimeline()).toEqual([]);
    expect(buildTimeline({})).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts threads, sends, shares and failures', () => {
    const t = buildTimeline({
      threads: [thread, { ...thread, id: 't3', visible_to_client: true }],
      notifications: [notification, { ...notification, id: 'n2', status: 'error' }],
    });
    expect(summarize(t)).toMatchObject({
      threads: 2, notifications: 2, shared: 1, failedNotifications: 1,
    });
  });

  it('reports the most recent activity date', () => {
    const t = buildTimeline({ threads: [thread], notifications: [notification] });
    expect(summarize(t).lastAt).toBe('2026-07-28T12:00:00Z');
  });

  it('is safe on an empty timeline', () => {
    expect(summarize([])).toMatchObject({ threads: 0, notifications: 0, lastAt: null });
  });
});

// ── Compose recipient resolution ────────────────────────────────────────────
// The security boundary for compose. A reply can only ever DROP recipients
// because the server recomputes them from the message being answered; a new
// message has no such anchor, so if compose took addresses from the request body
// any staff session could send mail as a real person to anywhere. Callers name
// contacts by ID and only this mapping decides who is reachable.
describe('resolveRecipients', () => {
  const contacts = [
    { id: 'c1', name: 'Gabe', email: 'gabe@dev.com', is_active: true },
    { id: 'c2', name: 'Peter', email: 'peter@dev.com', is_active: true },
    { id: 'c3', name: 'Ex-PM', email: 'gone@dev.com', is_active: false },
    { id: 'c4', name: 'No address', email: null, is_active: true },
  ];

  it('resolves the ids it was given', () => {
    expect(resolveRecipients(contacts, ['c1', 'c2']).map((c) => c.email))
      .toEqual(['gabe@dev.com', 'peter@dev.com']);
  });

  it('IGNORES an id that is not a contact of this client', () => {
    // The attack this exists to stop: naming something that isn't on the list.
    expect(resolveRecipients(contacts, ['c1', 'not-a-contact'])).toHaveLength(1);
  });

  it('cannot be used to reach an arbitrary address', () => {
    // Addresses in the request are simply not consulted — only ids are.
    expect(resolveRecipients(contacts, ['attacker@evil.com'])).toEqual([]);
  });

  it('excludes a DEACTIVATED contact even when named explicitly', () => {
    // A PM who left the developer must stop being emailable.
    expect(resolveRecipients(contacts, ['c3'])).toEqual([]);
  });

  it('skips a contact with no email rather than sending to undefined', () => {
    expect(resolveRecipients(contacts, ['c4'])).toEqual([]);
  });

  it('tolerates numeric vs string ids', () => {
    const numeric = [{ id: 7, email: 'a@b.com', is_active: true }];
    expect(resolveRecipients(numeric, ['7'])).toHaveLength(1);
    expect(resolveRecipients(numeric, [7])).toHaveLength(1);
  });

  it('returns nothing for empty or missing input', () => {
    expect(resolveRecipients()).toEqual([]);
    expect(resolveRecipients(contacts, [])).toEqual([]);
    expect(resolveRecipients([], ['c1'])).toEqual([]);
  });
});

describe('formatRecipients', () => {
  it('formats names and falls back to the bare address', () => {
    expect(formatRecipients([
      { name: 'Gabe', email: 'gabe@dev.com' },
      { name: null, email: 'peter@dev.com' },
    ])).toBe('Gabe <gabe@dev.com>, peter@dev.com');
  });
  it('is empty for no recipients', () => {
    expect(formatRecipients([])).toBe('');
  });
});
