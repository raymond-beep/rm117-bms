// Pure-function tests for the Mail page's Gmail read layer.
// No network, no Clerk, no mailbox — MIME trees are fixtures.
import { describe, it, expect } from 'vitest';
import {
  decodeB64Url, headerMap, parseAddress, parseAddressList, walkParts,
  sanitizeEmailHtml, isUnread, threadSubject, effectiveMime,
} from '../api/_lib/gmail-read.js';
import { resolveCidImages, replyRecipients, formatBytes, canPreview, attachmentKind, htmlHasContent } from '../src/lib/mail-html.js';
import { buildMimeMessage, replySubject, buildReferences } from '../api/_lib/gmail-send.js';
import { buildMatcher, classifySender, inScope } from '../api/_lib/client-match.js';
import { counterparty } from '../api/inbox.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('decodeB64Url', () => {
  it('decodes base64url without padding', () => {
    expect(decodeB64Url(b64('hello ünïcode'))).toBe('hello ünïcode');
  });
  it('returns empty string for missing data', () => {
    expect(decodeB64Url(undefined)).toBe('');
    expect(decodeB64Url('')).toBe('');
  });
});

describe('address parsing', () => {
  it('parses a display name + address', () => {
    expect(parseAddress('"John Smith" <John@X.com>')).toEqual({ name: 'John Smith', email: 'john@x.com' });
  });
  it('parses a bare address', () => {
    expect(parseAddress('john@x.com')).toEqual({ name: '', email: 'john@x.com' });
  });
  it('splits a list but not on commas inside quotes or angle brackets', () => {
    const list = parseAddressList('"Smith, John" <j@x.com>, ang@rm117.com');
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ name: 'Smith, John', email: 'j@x.com' });
    expect(list[1].email).toBe('ang@rm117.com');
  });
});

describe('walkParts', () => {
  it('pulls text and html out of nested multipart', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64('plain body') } },
            { mimeType: 'text/html', body: { data: b64('<p>html body</p>') } },
          ],
        },
      ],
    };
    const out = walkParts(payload);
    expect(out.text).toBe('plain body');
    expect(out.html).toBe('<p>html body</p>');
  });

  it('separates real attachments from inline signature images', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('see attached') } },
        {
          mimeType: 'application/pdf', filename: 'permit.pdf',
          body: { attachmentId: 'att1', size: 1234 },
        },
        {
          mimeType: 'image/png', filename: 'logo.png',
          headers: [
            { name: 'Content-Disposition', value: 'inline; filename="logo.png"' },
            { name: 'Content-ID', value: '<logo123>' },
          ],
          body: { attachmentId: 'att2', size: 99 },
        },
      ],
    };
    const out = walkParts(payload);
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0].filename).toBe('permit.pdf');
    // The signature logo must NOT appear as a file the client sent.
    expect(out.inline).toHaveLength(1);
    expect(out.inline[0].contentId).toBe('logo123');
  });

  it('handles a payload with no parts', () => {
    const out = walkParts({ mimeType: 'text/plain', body: { data: b64('flat') } });
    expect(out.text).toBe('flat');
    expect(out.attachments).toEqual([]);
  });

  it('survives a null payload', () => {
    expect(walkParts(null).text).toBe('');
  });
});

describe('sanitizeEmailHtml', () => {
  it('strips script tags and their contents', () => {
    const { html } = sanitizeEmailHtml('<p>hi</p><script>steal()</script>');
    expect(html).not.toMatch(/script/i);
    expect(html).toContain('<p>hi</p>');
  });
  it('strips inline event handlers', () => {
    const { html } = sanitizeEmailHtml('<img src="x" onerror="steal()">');
    expect(html).not.toMatch(/onerror/i);
  });
  it('neutralises javascript: urls', () => {
    const { html } = sanitizeEmailHtml('<a href="javascript:steal()">click</a>');
    expect(html).not.toMatch(/javascript:/i);
  });
  it('drops iframes and forms', () => {
    const { html } = sanitizeEmailHtml('<iframe src="//evil"></iframe><form action="//evil"></form>');
    expect(html).not.toMatch(/iframe|<form/i);
  });
  it('blocks remote images by default and counts them', () => {
    const { html, blockedImages } = sanitizeEmailHtml('<img src="https://tracker/p.gif">');
    expect(blockedImages).toBe(1);
    expect(html).toContain('data-blocked-src');
    expect(html).not.toMatch(/\ssrc=/);
  });
  it('leaves cid: images alone — they are the message\'s own parts', () => {
    const { html, blockedImages } = sanitizeEmailHtml('<img src="cid:logo123">');
    expect(blockedImages).toBe(0);
    expect(html).toContain('src="cid:logo123"');
  });
  it('allows remote images when explicitly opted in', () => {
    const { html, blockedImages } = sanitizeEmailHtml('<img src="https://x/p.gif">', { allowRemoteImages: true });
    expect(blockedImages).toBe(0);
    expect(html).toContain('src="https://x/p.gif"');
  });
});

describe('resolveCidImages (client-side)', () => {
  it('rewrites cid: refs to the blob url the caller supplies', () => {
    const inline = [{ contentId: 'logo123', attachmentId: 'att2', filename: 'logo.png' }];
    const out = resolveCidImages('<img src="cid:logo123">', inline, (p) => `blob:${p.attachmentId}`);
    expect(out).toContain('blob:att2');
    expect(out).not.toContain('cid:');
  });
  it('leaves an unmatched cid untouched', () => {
    const out = resolveCidImages('<img src="cid:nope">', [{ contentId: 'other' }], () => '/x');
    expect(out).toContain('cid:nope');
  });
  it('no-ops with no inline parts', () => {
    expect(resolveCidImages('<p>hi</p>', [], () => '/x')).toBe('<p>hi</p>');
  });
});

describe('replyRecipients', () => {
  const me = 'raymond@rm117.com';
  const msg = {
    from: { name: 'Gabe', email: 'gabe@dev.com' },
    to: [{ name: 'Ray', email: 'raymond@rm117.com' }, { name: 'Ang', email: 'angelena@rm117.com' }],
    cc: [{ name: 'PM', email: 'pm@dev.com' }],
  };

  it('plain reply goes to the sender only', () => {
    const { to, cc } = replyRecipients(msg, me);
    expect(to.map((a) => a.email)).toEqual(['gabe@dev.com']);
    expect(cc).toEqual([]);
  });
  it('reply-all keeps the rest of the thread but drops me', () => {
    const { to, cc } = replyRecipients(msg, me, { all: true });
    expect(to.map((a) => a.email)).toEqual(['gabe@dev.com', 'angelena@rm117.com']);
    expect(cc.map((a) => a.email)).toEqual(['pm@dev.com']);
    expect([...to, ...cc].map((a) => a.email)).not.toContain(me);
  });
  it('honours Reply-To over From', () => {
    const withReplyTo = { ...msg, replyTo: { name: 'Desk', email: 'desk@dev.com' } };
    expect(replyRecipients(withReplyTo, me).to[0].email).toBe('desk@dev.com');
  });
  it('never duplicates an address', () => {
    const dupe = { from: { email: 'a@x.com' }, to: [{ email: 'a@x.com' }], cc: [{ email: 'a@x.com' }] };
    const { to, cc } = replyRecipients(dupe, me, { all: true });
    expect([...to, ...cc]).toHaveLength(1);
  });
});

describe('attachment display helpers', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
  it('previews images and PDFs only', () => {
    expect(canPreview('application/pdf', 'a.pdf')).toBe(true);
    expect(canPreview('image/png', 'a.png')).toBe(true);
    expect(canPreview('application/zip', 'a.zip')).toBe(false);
    expect(canPreview('image/svg+xml', 'a.svg')).toBe(false); // scriptable — download only
  });
});

describe('attachmentKind — the declared MIME type is not trustworthy', () => {
  it('uses an explicit type when there is one', () => {
    expect(attachmentKind('x.pdf', 'application/pdf')).toBe('pdf');
    expect(attachmentKind('x.png', 'image/png')).toBe('image');
  });

  // The real case: a contractor's drawing set arrived as 7 PDFs, every one
  // declared application/octet-stream, so a mime-only check offered no preview.
  it('falls back to the extension when the type is generic', () => {
    expect(attachmentKind('Floor Plans with Notes.pdf', 'application/octet-stream')).toBe('pdf');
    expect(attachmentKind('Cross Section.PDF', 'binary/octet-stream')).toBe('pdf');
    expect(attachmentKind('detail.jpg', 'application/octet-stream')).toBe('image');
  });
  it('falls back to the extension when there is no type at all', () => {
    expect(attachmentKind('plan.pdf', '')).toBe('pdf');
    expect(attachmentKind('plan.pdf', undefined)).toBe('pdf');
  });
  it('handles a charset parameter on the type', () => {
    expect(attachmentKind('a.pdf', 'application/pdf; charset=binary')).toBe('pdf');
  });
  it('never previews a scriptable SVG, by type or extension', () => {
    expect(attachmentKind('logo.svg', 'image/svg+xml')).toBe('other');
    expect(attachmentKind('logo.svg', 'application/octet-stream')).toBe('other');
  });
  it('leaves genuinely unknown files alone', () => {
    expect(attachmentKind('model.dwg', 'application/octet-stream')).toBe('other');
    expect(attachmentKind('set.zip', 'application/zip')).toBe('other');
    expect(attachmentKind('noext', '')).toBe('other');
  });
});

describe('effectiveMime — what the server actually serves', () => {
  it('rewrites a generic PDF so the browser renders instead of downloading', () => {
    // Serving application/octet-stream makes the browser download no matter what
    // Content-Disposition says, which would leave the in-app viewer blank.
    expect(effectiveMime('Boiler Plate Example.pdf', 'application/octet-stream')).toBe('application/pdf');
  });
  it('keeps an explicit type', () => {
    expect(effectiveMime('a.pdf', 'application/pdf')).toBe('application/pdf');
    expect(effectiveMime('a.bin', 'application/zip')).toBe('application/zip');
  });
  it('infers images', () => {
    expect(effectiveMime('shot.JPEG', '')).toBe('image/jpeg');
    expect(effectiveMime('shot.png', 'application/octet-stream')).toBe('image/png');
  });
  it('falls back to octet-stream for the genuinely unknown', () => {
    expect(effectiveMime('model.dwg', '')).toBe('application/octet-stream');
  });
});

describe('unread + subject', () => {
  it('reads the UNREAD label', () => {
    expect(isUnread({ labelIds: ['INBOX', 'UNREAD'] })).toBe(true);
    expect(isUnread({ labelIds: ['INBOX'] })).toBe(false);
    expect(isUnread({})).toBe(false);
  });
  it('strips Re:/Fwd: from the thread subject', () => {
    expect(threadSubject([{ subject: 'Re: Permit set' }])).toBe('Permit set');
    expect(threadSubject([{ subject: 'FWD: Zoning' }])).toBe('Zoning');
    expect(threadSubject([])).toBe('(no subject)');
  });
});

describe('counterparty — who the conversation is with', () => {
  const staff = { name: 'Ray', email: 'raymond@rm117.com' };
  const client = { name: 'Gabe', email: 'gabe@dev.com' };

  it('uses the sender for inbound mail', () => {
    expect(counterparty(client, [staff]).email).toBe('gabe@dev.com');
  });
  it('uses the recipient for mail the firm SENT', () => {
    // Otherwise every outbound client email files under "staff" and loses its tag.
    expect(counterparty(staff, [client]).email).toBe('gabe@dev.com');
  });
  it('falls back to the sender for internal staff mail', () => {
    const ang = { name: 'Ang', email: 'angelena@rm117.com' };
    expect(counterparty(ang, [staff]).email).toBe('angelena@rm117.com');
  });
});

describe('client matching via client_contacts', () => {
  const jobs = [
    { job_id: '26_001_Deuel', client_name: 'Tyler Deuel', client_id: 'c1' },
    { job_id: '26_002_Deuel', client_name: 'Tyler Deuel', client_id: 'c1' },
  ];
  const clients = [{ id: 'c1', name: 'Tyler Deuel', email: 'tyler@deuel.com' }];
  const contacts = [
    { client_id: 'c1', name: 'Sarah Klein', email: 'sarah@deuelpm.com', is_active: true },
    { client_id: 'c1', name: 'Gone Guy', email: 'gone@deuelpm.com', is_active: false },
  ];

  it('matches the primary client email', () => {
    const m = buildMatcher(jobs, clients, contacts).match({ name: '', email: 'tyler@deuel.com' });
    expect(m.isClient).toBe(true);
    expect(m.jobs).toEqual(['26_001_Deuel', '26_002_Deuel']);
  });

  it("matches a developer's project manager — the case that used to fail", () => {
    const m = buildMatcher(jobs, clients, contacts).match({ name: 'Sarah Klein', email: 'sarah@deuelpm.com' });
    expect(m.isClient).toBe(true);
    expect(m.label).toBe('Tyler Deuel');       // files under the CLIENT, not the person
    expect(m.contactName).toBe('Sarah Klein');
    expect(m.jobs).toEqual(['26_001_Deuel', '26_002_Deuel']);
  });

  it('ignores a deactivated contact', () => {
    const m = buildMatcher(jobs, clients, contacts).match({ name: '', email: 'gone@deuelpm.com' });
    expect(m.isClient).toBe(false);
  });

  it('a contact row never shadows the canonical clients.email', () => {
    const shadow = [{ client_id: 'c1', name: 'Imposter', email: 'tyler@deuel.com', is_active: true }];
    const m = buildMatcher(jobs, clients, shadow).match({ name: '', email: 'tyler@deuel.com' });
    expect(m.contactName).toBeNull();
  });

  it('still works with no contacts passed (back-compat)', () => {
    expect(buildMatcher(jobs, clients).match({ name: '', email: 'tyler@deuel.com' }).isClient).toBe(true);
  });
});

describe('classifySender + inScope', () => {
  const notClient = { isClient: false };
  it('tags a matched client', () => {
    expect(classifySender({ email: 'x@y.com' }, { isClient: true })).toBe('client');
  });
  it('tags a colleague', () => {
    expect(classifySender({ email: 'ang@rm117.com' }, notClient)).toBe('staff');
  });
  it('tags a building department as project mail', () => {
    expect(classifySender({ email: 'zoning@montclairnjusa.gov' }, notClient)).toBe('project');
  });
  it('tags an engineer we have never enumerated as project mail', () => {
    expect(classifySender({ email: 'pe@structural-eng.com' }, notClient)).toBe('project');
  });
  it('tags SaaS/bulk senders as noise', () => {
    expect(classifySender({ email: 'noreply@clickup.com', name: 'ClickUp Team' }, notClient)).toBe('noise');
    expect(classifySender({ email: 'newsletter@somewhere.io' }, notClient)).toBe('noise');
  });

  it('work scope keeps everything except noise', () => {
    expect(inScope('client', 'work')).toBe(true);
    expect(inScope('staff', 'work')).toBe(true);
    expect(inScope('project', 'work')).toBe(true);   // the whole point of the inversion
    expect(inScope('noise', 'work')).toBe(false);
  });
  it('clients scope stays deliberately narrow', () => {
    expect(inScope('client', 'clients')).toBe(true);
    expect(inScope('project', 'clients')).toBe(false);
    expect(inScope('staff', 'clients')).toBe(false);
  });
  it('all scope hides nothing', () => {
    expect(inScope('noise', 'all')).toBe(true);
  });
});

describe('htmlHasContent — never render an empty frame', () => {
  it('sees real text', () => {
    expect(htmlHasContent('<div><p>Hello Ray</p></div>')).toBe(true);
  });
  it('sees images and tables even with no text', () => {
    expect(htmlHasContent('<div><img src="x"></div>')).toBe(true);
    expect(htmlHasContent('<table><tr><td></td></tr></table>')).toBe(true);
  });
  it('rejects markup that renders nothing', () => {
    // These produced a blank white box with no explanation.
    expect(htmlHasContent('<div></div>')).toBe(false);
    expect(htmlHasContent('<div>&nbsp;&nbsp;</div>')).toBe(false);
    expect(htmlHasContent('  \n ')).toBe(false);
    expect(htmlHasContent('')).toBe(false);
    expect(htmlHasContent(null)).toBe(false);
  });
  it('ignores text hidden inside style/script blocks', () => {
    expect(htmlHasContent('<style>p{color:red}</style>')).toBe(false);
  });
});

describe('walkParts — bodies too large to arrive inline', () => {
  it('records a ref when Gmail omits body.data for the html part', () => {
    // Above ~a couple hundred KB Gmail sends an attachmentId instead of data.
    // Decoding data alone returned '' and the message rendered as a blank box.
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { attachmentId: 'big-text', size: 900000 } },
        { mimeType: 'text/html', body: { attachmentId: 'big-html', size: 900000 } },
      ],
    };
    const out = walkParts(payload);
    expect(out.html).toBe('');
    expect(out.htmlRef).toBe('big-html');
    expect(out.textRef).toBe('big-text');
  });
  it('prefers inline data and records no ref when data is present', () => {
    const payload = {
      mimeType: 'text/html',
      body: { data: Buffer.from('<p>hi</p>').toString('base64url'), attachmentId: 'unused' },
    };
    const out = walkParts(payload);
    expect(out.html).toBe('<p>hi</p>');
    expect(out.htmlRef).toBeNull();
  });
});

describe('reply threading headers', () => {
  it('adds Re: exactly once', () => {
    expect(replySubject('Checking In')).toBe('Re: Checking In');
    expect(replySubject('Re: Checking In')).toBe('Re: Checking In');
    expect(replySubject('RE: Checking In')).toBe('RE: Checking In');
    expect(replySubject('')).toBe('Re:');
  });

  it('appends the original Message-ID to the References chain', () => {
    // A malformed chain breaks threading in the RECIPIENT's client, where we
    // would never see it — hence a tested pure function.
    expect(buildReferences('<a@x> <b@x>', '<c@x>')).toBe('<a@x> <b@x> <c@x>');
  });
  it('starts a chain when the original had none', () => {
    expect(buildReferences('', '<c@x>')).toBe('<c@x>');
    expect(buildReferences(null, '<c@x>')).toBe('<c@x>');
  });
  it('does not duplicate an id already in the chain', () => {
    expect(buildReferences('<a@x> <c@x>', '<c@x>')).toBe('<a@x> <c@x>');
  });

  it('writes In-Reply-To, References and Cc into the MIME headers', () => {
    const raw = buildMimeMessage({
      to: 'client@x.com', cc: 'pm@x.com', subject: 'Re: Permit',
      text: 'Confirmed.', inReplyTo: '<c@x>', references: '<a@x> <c@x>',
    });
    expect(raw).toContain('To: client@x.com');
    expect(raw).toContain('Cc: pm@x.com');
    expect(raw).toContain('In-Reply-To: <c@x>');
    expect(raw).toContain('References: <a@x> <c@x>');
    expect(raw).toContain('Confirmed.');
  });

  it('omits Cc and threading headers entirely when not replying', () => {
    const raw = buildMimeMessage({ to: 'a@b.com', subject: 'Update', text: 'Hi' });
    expect(raw).not.toContain('Cc:');
    expect(raw).not.toContain('In-Reply-To:');
    expect(raw).not.toContain('References:');
  });
});
