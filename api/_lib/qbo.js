// QuickBooks Online API client — OUTBOUND (app → QBO).
//
// This is the runtime counterpart to the inbound Zapier webhook (api/payments/
// webhook.js, QBO → app). It lets the app create customers and invoices in QBO
// so the firm can drive billing from this app instead of QBO's UI — the "Stage B"
// two-way sync. QBO stays the system of record for invoices/AR; this app is the
// control surface. `qbo_invoice_id` is the idempotency key tying the two together.
//
// ── Company (confirmed live 2026-06-23 via the Intuit QuickBooks MCP) ──────────
//   Company:  Room 117 Architecture & Design LLC
//   Realm ID: 193514517070094   (PRODUCTION — not sandbox)
//   Invariant: a job's QBO Customer DisplayName === its Job ID (YY_NNN_[FF_]LastName).
//
// ── Credentials (env) ─────────────────────────────────────────────────────────
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET  — from the Intuit Developer app
//   QBO_REFRESH_TOKEN                 — seed refresh token from the OAuth flow
//   QBO_REALM_ID                      — 193514517070094 for the real company
//   QBO_ENV        (optional)         — 'production' (default) | 'sandbox'
//   QBO_MINOR_VERSION (optional)      — QBO API minor version (default below)
//
// ── ⚠️ Refresh-token rotation (the one gotcha) ────────────────────────────────
//   QBO OAuth2 access tokens last ~1h; the *refresh* token lasts ~100 days and is
//   **re-issued on (almost) every refresh**. If you keep using the original env
//   token forever it will eventually stop working. So after each refresh we
//   persist the new refresh token to Supabase (`qbo_tokens`) and read from there
//   first, falling back to the env seed. The table is optional — if it doesn't
//   exist yet the client still works off the env token (you'll just get a one-line
//   warning until the rotated token would have expired). See `qbo_tokens` below.

import { getDb, hasDb } from './db.js';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const DEFAULT_MINOR_VERSION = '73';

// Single-row token store. Create when you wire creds (id is a stable singleton key):
//   create table qbo_tokens (
//     id text primary key default 'singleton',
//     refresh_token text not null,
//     updated_at timestamptz default now()
//   );
const TOKEN_TABLE = 'qbo_tokens';
const TOKEN_ROW_ID = 'singleton';

// All four credentials must be present for outbound QBO to work.
export function hasQbo() {
  return Boolean(
    process.env.QBO_CLIENT_ID &&
    process.env.QBO_CLIENT_SECRET &&
    (process.env.QBO_REFRESH_TOKEN || hasDb()) && // seed token OR a store to read one from
    process.env.QBO_REALM_ID
  );
}

export function qboConfig() {
  const sandbox = (process.env.QBO_ENV || 'production').toLowerCase() === 'sandbox';
  return {
    realmId: process.env.QBO_REALM_ID,
    baseUrl: sandbox
      ? 'https://sandbox-quickbooks.api.intuit.com'
      : 'https://quickbooks.api.intuit.com',
    minorVersion: process.env.QBO_MINOR_VERSION || DEFAULT_MINOR_VERSION,
    sandbox,
  };
}

// ── Refresh-token persistence (graceful) ──────────────────────────────────────
async function loadRefreshToken() {
  if (hasDb()) {
    try {
      const { data, error } = await getDb()
        .from(TOKEN_TABLE)
        .select('refresh_token')
        .eq('id', TOKEN_ROW_ID)
        .maybeSingle();
      if (!error && data?.refresh_token) return data.refresh_token;
    } catch (err) {
      // Table may not exist yet — fall through to the env seed.
      console.warn('[qbo] token store read failed (using env seed):', err.message);
    }
  }
  return process.env.QBO_REFRESH_TOKEN || null;
}

async function saveRefreshToken(token) {
  if (!token || !hasDb()) return;
  try {
    const { error } = await getDb()
      .from(TOKEN_TABLE)
      .upsert({ id: TOKEN_ROW_ID, refresh_token: token, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (err) {
    // Non-fatal: the rotated token still works for this process; we just couldn't
    // persist it. Create the qbo_tokens table to silence this and survive restarts.
    console.warn('[qbo] could not persist rotated refresh token:', err.message);
  }
}

// ── Access-token cache (per warm lambda) ──────────────────────────────────────
let _accessToken = null;
let _accessExpiresAt = 0; // epoch ms

async function refreshAccessToken() {
  const refreshToken = await loadRefreshToken();
  if (!refreshToken) throw new Error('QBO not configured: no refresh token (env or store)');

  const basic = Buffer
    .from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`)
    .toString('base64');

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    // 400 invalid_grant here almost always means the refresh token expired or was
    // superseded — re-mint via /api/qbo/connect and reseed QBO_REFRESH_TOKEN.
    // intuit_tid is Intuit's request id — captured for support/debugging (a
    // Compliance commitment) so we can quote it when reporting an API error.
    const tid = resp.headers.get('intuit_tid');
    throw new Error(`QBO token refresh failed (${resp.status}${tid ? `, intuit_tid ${tid}` : ''}): ${text}`);
  }
  const json = JSON.parse(text);

  _accessToken = json.access_token;
  // Refresh ~1 min early to avoid edge-of-expiry 401s.
  _accessExpiresAt = Date.now() + (Number(json.expires_in || 3600) - 60) * 1000;

  // Persist the (usually rotated) refresh token for next time.
  if (json.refresh_token && json.refresh_token !== refreshToken) {
    await saveRefreshToken(json.refresh_token);
  }
  return _accessToken;
}

async function getAccessToken(force = false) {
  if (!force && _accessToken && Date.now() < _accessExpiresAt) return _accessToken;
  return refreshAccessToken();
}

// ── Core request helper ───────────────────────────────────────────────────────
// Calls https://<base>/v3/company/<realm>/<path>?minorversion=<n>. Retries once
// on a 401 with a forced token refresh (covers a token that expired mid-flight).
async function qboRequest(method, path, body, { retry = true } = {}) {
  if (!hasQbo()) throw new Error('QBO not configured (missing QBO_* env vars)');
  const { realmId, baseUrl, minorVersion } = qboConfig();
  const token = await getAccessToken();

  const sep = path.includes('?') ? '&' : '?';
  const url = `${baseUrl}/v3/company/${realmId}/${path}${sep}minorversion=${minorVersion}`;

  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (resp.status === 401 && retry) {
    await getAccessToken(true); // force refresh, then retry once
    return qboRequest(method, path, body, { retry: false });
  }

  const text = await resp.text();
  if (!resp.ok) {
    // Capture intuit_tid (Intuit's request id) on every failed API call — lets us
    // quote it to Intuit support and ties our logs to theirs (Compliance commitment).
    const tid = resp.headers.get('intuit_tid');
    if (tid) console.warn(`[qbo] ${method} ${path} -> ${resp.status} intuit_tid=${tid}`);
    throw new Error(`QBO ${method} ${path} failed (${resp.status}${tid ? `, intuit_tid ${tid}` : ''}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// QBO query language escapes a single quote by doubling it.
const esc = (s) => String(s).replace(/'/g, "''");

// ── Customers ─────────────────────────────────────────────────────────────────
export async function findCustomerByDisplayName(displayName) {
  const q = `select * from Customer where DisplayName = '${esc(displayName)}'`;
  const res = await qboRequest('GET', `query?query=${encodeURIComponent(q)}`);
  return res?.QueryResponse?.Customer?.[0] || null;
}

// fields: { displayName (required), email, phone, company, givenName, familyName }
export async function createCustomer(fields) {
  if (!fields?.displayName) throw new Error('createCustomer: displayName is required');
  const payload = { DisplayName: fields.displayName };
  if (fields.email) payload.PrimaryEmailAddr = { Address: fields.email };
  if (fields.phone) payload.PrimaryPhone = { FreeFormNumber: fields.phone };
  if (fields.company) payload.CompanyName = fields.company;
  if (fields.givenName) payload.GivenName = fields.givenName;
  if (fields.familyName) payload.FamilyName = fields.familyName;
  const res = await qboRequest('POST', 'customer', payload);
  return res?.Customer || null;
}

// DisplayName === Job ID, so this is the canonical "ensure the customer exists" call.
export async function findOrCreateCustomer(fields) {
  const existing = await findCustomerByDisplayName(fields.displayName);
  if (existing) return { customer: existing, created: false };
  const customer = await createCustomer(fields);
  return { customer, created: true };
}

// Rename a customer's DisplayName (used by the "Correct Job ID" flow to keep the
// QBO customer name === Job ID). Sparse update so only DisplayName changes. Returns
// { renamed:false, reason:'not-found' } if no customer currently has oldDisplayName
// (e.g. the job was never invoiced), or throws if QBO rejects (e.g. the new name
// already belongs to another customer — DisplayName must be unique in QBO).
export async function renameCustomer(oldDisplayName, newDisplayName) {
  const existing = await findCustomerByDisplayName(oldDisplayName);
  if (!existing) return { renamed: false, reason: 'not-found' };
  const res = await qboRequest('POST', 'customer', {
    Id: existing.Id,
    SyncToken: existing.SyncToken,
    sparse: true,
    DisplayName: newDisplayName,
  });
  return { renamed: true, customerId: existing.Id, customer: res?.Customer || null };
}

// ── Service catalog (line items are billed by Item Id) ────────────────────────
// Known item ids on the real company (from live invoices, 2026-06-23):
//   4 Final Design · 5 Architectural Construction Documents · 7 Final Construction
//   Documents · 13 Project Retainer. Others in the catalog (look up by name):
//   Design Phase III (DP3), Zoning Board of Adjustment (ZBA), Zoning Coordination,
//   Structural Engineer Engagement, Construction Administration (CA), Hours.
export async function findItemByName(name) {
  const q = `select * from Item where Name = '${esc(name)}'`;
  const res = await qboRequest('GET', `query?query=${encodeURIComponent(q)}`);
  return res?.QueryResponse?.Item?.[0] || null;
}

// ── Invoices ──────────────────────────────────────────────────────────────────
// args: {
//   customerId   (required, QBO Customer Id),
//   lines: [{ itemId? | itemName?, amount (required), description?, qty?, unitPrice? }],
//   email?       — sets BillEmail (used by sendInvoice),
//   dueDate?     — 'YYYY-MM-DD',
//   memo?        — private note (shows on the QBO invoice's memo, like the real ones),
//   docNumber?   — override DocNumber (default: QBO auto-numbers),
// }
export async function createInvoice(args) {
  if (!args?.customerId) throw new Error('createInvoice: customerId is required');
  if (!Array.isArray(args.lines) || args.lines.length === 0) {
    throw new Error('createInvoice: at least one line is required');
  }

  const Line = [];
  for (const line of args.lines) {
    if (line.amount == null) throw new Error('createInvoice: each line needs an amount');
    let itemId = line.itemId;
    if (!itemId && line.itemName) {
      const item = await findItemByName(line.itemName);
      if (!item) throw new Error(`createInvoice: no QBO item named "${line.itemName}"`);
      itemId = item.Id;
    }
    if (!itemId) throw new Error('createInvoice: each line needs itemId or itemName');
    Line.push({
      DetailType: 'SalesItemLineDetail',
      Amount: Number(line.amount),
      ...(line.description ? { Description: line.description } : {}),
      SalesItemLineDetail: {
        ItemRef: { value: String(itemId) },
        ...(line.qty != null ? { Qty: Number(line.qty) } : {}),
        ...(line.unitPrice != null ? { UnitPrice: Number(line.unitPrice) } : {}),
      },
    });
  }

  const payload = {
    CustomerRef: { value: String(args.customerId) },
    Line,
    ...(args.email ? { BillEmail: { Address: args.email } } : {}),
    ...(args.dueDate ? { DueDate: args.dueDate } : {}),
    ...(args.memo ? { PrivateNote: args.memo } : {}),
    ...(args.docNumber ? { DocNumber: String(args.docNumber) } : {}),
  };

  const res = await qboRequest('POST', 'invoice', payload);
  return res?.Invoice || null;
}

// Emails a created invoice. If `email` is omitted QBO uses the invoice's BillEmail.
export async function sendInvoice(invoiceId, email) {
  const path = email
    ? `invoice/${invoiceId}/send?sendTo=${encodeURIComponent(email)}`
    : `invoice/${invoiceId}/send`;
  const res = await qboRequest('POST', path);
  return res?.Invoice || null;
}
