// portal-test.js — a LOCAL, dev-only harness for driving the client portal end to end
// without emailing a real client. Everything it touches is scoped to one clearly-labeled
// test client ("ZZ — Portal Test (DELETE ME)"), and `teardown` removes all of it.
//
// It talks straight to Supabase with the service key and reuses the app's OWN crypto
// (portal-session / portal-login-code), so the tokens and codes it mints are byte-identical
// to what the live endpoints produce — you're testing the real thing, not a mock.
//
// Why a script and not the HTTP endpoints: `invite`/`notify` are gated by requireStaff
// (Clerk), and `notify` fires a real Gmail. This bypasses Clerk (it's local + service-key)
// and never sends to anyone but you, so you can set up a safe target and then press the
// REAL "Notify client" button in the running app against it.
//
//   node scripts/portal-test.js setup      # create the test client + contact + 2 jobs
//   node scripts/portal-test.js link       # mint a magic link -> click to become the client
//   node scripts/portal-test.js code       # mint a 6-digit code -> test the email+code door
//   node scripts/portal-test.js draft      # print the exact email a client would receive
//   node scripts/portal-test.js status     # show the test client, jobs, live links + codes
//   node scripts/portal-test.js teardown   # delete everything this script created
//
// Flags: --email <addr> (contact address, default raymond@rm117.com)
//        --base <url>    (origin for the magic link, default http://localhost:5173)
//        --job <n>       (which test job for `draft`/`code`, 1 or 2; default 1)
//        --note <text>   (staff note to include in `draft`)
//        --yes           (skip the teardown confirmation)

import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';
import {
  mintToken,
  hashToken,
  linkExpiry,
  DEFAULT_LINK_TTL_DAYS,
} from '../api/_lib/portal-session.js';
import {
  mintCode,
  hashCode,
  codeExpiry,
  normalizeEmail,
  CODE_TTL_MINUTES,
} from '../api/_lib/portal-login-code.js';
import { buildUpdateEmail } from '../api/_lib/portal-notify.js';

// --- Sentinel: the ONLY data this script is ever allowed to create or delete -----------
const MARK = 'ZZ — Portal Test (DELETE ME)'; // client name — the sentinel every op is scoped to
const JOBS = [
  {
    job_id: 'ZZTEST_001_Portal_Demo',
    address: '1 Test Lane\nMontclair, NJ 07042',
    phase: 'cd_prep', // client sees "construction drawings"
    job_total: 24000,
    amount_billed: 12000,
    next_milestone_label: 'Permit set to the town',
    next_milestone_date: () => isoDate(14), // 2 weeks out
  },
  {
    job_id: 'ZZTEST_002_Portal_Demo',
    address: '2 Sample Street\nMontclair, NJ 07042',
    phase: 'design_phase', // client sees "design"
    job_total: 9500,
    amount_billed: 0,
    next_milestone_label: 'First design review',
    next_milestone_date: () => isoDate(7),
  },
];

// --- CLI plumbing ----------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function isoDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) die('SUPABASE_URL / SUPABASE_SERVICE_KEY missing from .env — run this locally.');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Find the test client, or null. Never matches anything but the sentinel name.
async function findTestClient(sb) {
  const { data, error } = await sb.from('clients').select('id, name, type').eq('name', MARK).maybeSingle();
  if (error) die(`lookup failed: ${error.message}`);
  return data;
}

async function requireTestClient(sb) {
  const c = await findTestClient(sb);
  if (!c) die('No test client yet. Run:  node scripts/portal-test.js setup');
  return c;
}

async function primaryContact(sb, clientId) {
  const { data } = await sb
    .from('client_contacts')
    .select('id, name, email, is_primary')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// --- Commands --------------------------------------------------------------------------

async function cmdSetup(sb, args) {
  const email = normalizeEmail(args.email || 'raymond@rm117.com');
  if (!email.includes('@')) die(`--email "${email}" doesn't look like an address.`);

  let client = await findTestClient(sb);
  if (!client) {
    const { data, error } = await sb
      .from('clients')
      .insert({
        name: MARK,
        type: 'homeowner',
        email,
        notes: 'Local portal test harness — safe to delete. Created by scripts/portal-test.js.',
        is_active: true,
      })
      .select('id, name')
      .single();
    if (error) die(`create client: ${error.message}`);
    client = data;
    console.log(`✓ created client  ${MARK}`);
  } else {
    console.log(`• client already exists  ${MARK}`);
  }

  // Primary contact = the address you'll actually receive at.
  const contact = await primaryContact(sb, client.id);
  if (!contact) {
    const { error } = await sb.from('client_contacts').insert({
      client_id: client.id,
      name: 'Ray Tester',
      email,
      is_primary: true,
      is_active: true,
    });
    if (error) die(`create contact: ${error.message}`);
    console.log(`✓ created contact ${email}`);
  } else if (normalizeEmail(contact.email) !== email) {
    const { error } = await sb.from('client_contacts').update({ email }).eq('id', contact.id);
    if (error) die(`update contact email: ${error.message}`);
    console.log(`✓ updated contact email -> ${email}`);
  } else {
    console.log(`• contact already set  ${email}`);
  }

  // Two jobs, distinct phases, so the portal + the update email have something to show.
  for (let i = 0; i < JOBS.length; i++) {
    const j = JOBS[i];
    const row = {
      job_id: j.job_id,
      client_id: client.id,
      client_name: MARK,
      address: j.address,
      phase: j.phase,
      job_total: j.job_total,
      amount_billed: j.amount_billed,
      next_milestone_label: j.next_milestone_label,
      next_milestone_date: j.next_milestone_date(),
      board_position: 990000 + i, // sort to the very bottom of the board, out of the way
      is_fire_escape: false,
    };
    const { error } = await sb.from('jobs').upsert(row, { onConflict: 'job_id' });
    if (error) die(`upsert job ${j.job_id}: ${error.message}`);
    console.log(`✓ job ${j.job_id}  (${j.phase})`);
  }

  console.log(`\nSet up. Next:`);
  console.log(`  node scripts/portal-test.js link     # become the client in your browser`);
  console.log(`  node scripts/portal-test.js code     # test the email+code door`);
  console.log(`  ...or open the app, sign in as staff, open "${MARK}" and press "✉ Notify client" (it emails ${email}).`);
}

async function cmdLink(sb, args) {
  const client = await requireTestClient(sb);
  const base = (args.base || 'http://localhost:5173').replace(/\/$/, '');
  const days = Number(args.days) || DEFAULT_LINK_TTL_DAYS;

  // Mirror handleInvite: mint raw token, store ONLY its hash. One live link per client, so
  // revoke any previous test links first (same behavior as a new update email).
  await sb.from('portal_links').update({ revoked_at: new Date().toISOString() })
    .eq('client_id', client.id).is('revoked_at', null);

  const token = mintToken();
  const { error } = await sb.from('portal_links').insert({
    client_id: client.id,
    token_hash: hashToken(token),
    expires_at: linkExpiry(days),
    created_by: 'portal-test-script',
  });
  if (error) die(`mint link: ${error.message}`);

  // Locally, vite proxies /api -> :3001, sets the cookie on localhost (cookies ignore port),
  // then the 302 to "/" lands back on the vite app already signed in.
  console.log(`\n✓ Magic link (valid ${days} days, previous test links revoked):\n`);
  console.log(`  ${base}/api/portal/enter?t=${token}\n`);
  console.log(`Click it (make sure \`npm run dev\` is running). You'll land in the portal AS the`);
  console.log(`test client and see both test jobs. In production the same link is /enter?t=…`);
}

async function cmdCode(sb, args) {
  const client = await requireTestClient(sb);
  const contact = await primaryContact(sb, client.id);
  if (!contact) die('Test client has no contact. Re-run setup.');
  const email = normalizeEmail(contact.email);

  // Mirror handleRequestCode: supersede any outstanding code, insert a fresh HMAC row.
  await sb.from('portal_login_codes').update({ consumed_at: new Date().toISOString() })
    .eq('email', email).is('consumed_at', null);

  const code = mintCode();
  const { error } = await sb.from('portal_login_codes').insert({
    email,
    client_id: client.id,
    contact_id: contact.id,
    code_hash: hashCode(email, code),
    expires_at: codeExpiry(),
  });
  if (error) die(`mint code: ${error.message}`);

  const base = (args.base || 'http://localhost:5173').replace(/\/$/, '');
  console.log(`\n✓ Sign-in code for ${email} (expires in ${CODE_TTL_MINUTES} min, single use):\n`);
  console.log(`      ${code}\n`);
  console.log(`Test the door: open ${base} , enter ${email}, then type the code above.`);
  console.log(`(The real endpoint would email this via Resend; the script prints it so you`);
  console.log(` don't have to wait for mail.)`);
}

async function cmdDraft(sb, args) {
  const client = await requireTestClient(sb);
  const contact = await primaryContact(sb, client.id);
  const n = Number(args.job) === 2 ? 1 : 0;
  const { data: job } = await sb.from('jobs').select('*').eq('job_id', JOBS[n].job_id).maybeSingle();
  if (!job) die('Test job missing — re-run setup.');

  // Side-effect-free preview: exactly what buildUpdateEmail produces for the real Notify
  // button (which additionally mints a link + sends). No link is minted here.
  const mail = buildUpdateEmail({
    job,
    client: { name: contact?.name || client.name, email: contact?.email },
    link: 'https://portal.rm117.com/enter?t=<minted-when-you-press-Notify>',
    senderName: 'Ray Arocha',
    note: typeof args.note === 'string' ? args.note : '',
  });

  console.log(`\n─ The email this client would receive (job ${n + 1}) ─────────────────────\n`);
  console.log(`To:      ${mail.to}`);
  console.log(`Subject: ${mail.subject}\n`);
  console.log(mail.text);
  console.log(`\n──────────────────────────────────────────────────────────────────────────`);
  console.log(`This is the exact composition. Pressing "✉ Notify client" in the app also`);
  console.log(`mints the magic link and sends it from your Gmail to ${mail.to}.`);
}

async function cmdStatus(sb) {
  const client = await findTestClient(sb);
  if (!client) { console.log(`\nNo test client. Run:  node scripts/portal-test.js setup\n`); return; }
  console.log(`\nTest client: ${client.name}  (${client.id})`);

  const { data: contacts = [] } = await sb.from('client_contacts')
    .select('name, email, is_primary, is_active').eq('client_id', client.id);
  for (const c of contacts) console.log(`  contact  ${c.email}  ${c.is_primary ? '(primary)' : ''}${c.is_active ? '' : ' [inactive]'}`);

  const { data: jobs = [] } = await sb.from('jobs')
    .select('job_id, phase, job_total, amount_billed, next_milestone_label').eq('client_id', client.id);
  for (const j of jobs) console.log(`  job      ${j.job_id}  ${j.phase}  $${j.job_total}  next: ${j.next_milestone_label || '—'}`);

  const now = new Date().toISOString();
  const { data: links = [] } = await sb.from('portal_links')
    .select('expires_at, revoked_at, use_count').eq('client_id', client.id);
  const liveLinks = links.filter((l) => !l.revoked_at && l.expires_at > now);
  console.log(`  links    ${liveLinks.length} live / ${links.length} total`);

  const emails = contacts.map((c) => normalizeEmail(c.email));
  const { data: codes = [] } = emails.length
    ? await sb.from('portal_login_codes').select('expires_at, consumed_at, attempts').in('email', emails)
    : { data: [] };
  const liveCodes = codes.filter((c) => !c.consumed_at && c.expires_at > now);
  console.log(`  codes    ${liveCodes.length} live / ${codes.length} total\n`);
}

async function cmdTeardown(sb, args) {
  const client = await findTestClient(sb);
  if (!client) { console.log(`\nNothing to tear down — no test client exists.\n`); return; }

  if (!args.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`\nDelete "${client.name}", its contacts, jobs, links and codes? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(ans.trim())) { console.log('Aborted.'); return; }
  }

  const { data: contacts = [] } = await sb.from('client_contacts').select('email').eq('client_id', client.id);
  const emails = contacts.map((c) => normalizeEmail(c.email));

  if (emails.length) await sb.from('portal_login_codes').delete().in('email', emails);
  await sb.from('portal_links').delete().eq('client_id', client.id);
  await sb.from('jobs').delete().eq('client_id', client.id);
  await sb.from('client_contacts').delete().eq('client_id', client.id);
  const { error } = await sb.from('clients').delete().eq('id', client.id).eq('name', MARK); // belt + suspenders
  if (error) die(`delete client: ${error.message}`);

  console.log(`\n✓ Removed the test client and everything it created.\n`);
}

// --- main ------------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (process.env.NODE_ENV === 'production') die('Refusing to run with NODE_ENV=production.');
  const sb = db();

  switch (cmd) {
    case 'setup': return cmdSetup(sb, args);
    case 'link': return cmdLink(sb, args);
    case 'code': return cmdCode(sb, args);
    case 'draft': return cmdDraft(sb, args);
    case 'status': return cmdStatus(sb, args);
    case 'teardown': return cmdTeardown(sb, args);
    default:
      console.log(`portal-test — local end-to-end tester for the client portal\n`);
      console.log(`  setup      create the test client + contact + 2 jobs (emails go to YOU)`);
      console.log(`  link       mint a localhost magic link -> click to become the client`);
      console.log(`  code       mint a 6-digit code -> test the email+code sign-in door`);
      console.log(`  draft      print the exact email a client would receive (no send)`);
      console.log(`  status     show the test client, jobs, and live links/codes`);
      console.log(`  teardown   delete everything this script created\n`);
      console.log(`Flags: --email <addr>  --base <url>  --job <1|2>  --note "<text>"  --yes\n`);
      if (cmd) die(`Unknown command "${cmd}".`);
  }
}

main().catch((e) => die(e.message || String(e)));
