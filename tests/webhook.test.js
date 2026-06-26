// QBO payment webhook — the money-in path. The critical invariant is dedup on
// qbo_invoice_id: Zapier can retry or double-fire, and a single QBO payment must
// never be counted twice (it would understate outstanding A/R).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({
  hasDb: vi.fn(),
  getDb: vi.fn(),
}));

import { hasDb, getDb } from '../api/_lib/db.js';
import handler from '../api/payments/webhook.js';

const SECRET = 'test-webhook-secret';

// Minimal chainable Supabase query-builder stub. A fresh builder per from()
// call; terminal calls resolve from fixtures by *which* terminal is used:
//   .single()  without an insert -> the job-existence lookup
//   .maybeSingle()               -> the dedup lookup
//   .insert(row).select().single() -> the payment insert
// (Table name is irrelevant to the branch the handler takes.)
function makeDb({ job, existing, inserted, insertSpy }) {
  return {
    from() {
      const b = {
        _insert: false,
        select() { return b; },
        eq() { return b; },
        insert(row) { b._insert = true; insertSpy?.(row); return b; },
        single() {
          if (b._insert) return Promise.resolve({ data: inserted, error: null });
          return Promise.resolve({ data: job, error: job ? null : { message: 'not found' } });
        },
        maybeSingle() {
          return Promise.resolve({ data: existing ?? null, error: null });
        },
      };
      return b;
    },
  };
}

const mockRes = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(obj) { this.body = obj; return this; },
});

const post = (body) => ({ method: 'POST', body });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEBHOOK_SECRET = SECRET;
  hasDb.mockReturnValue(true);
});

afterEach(() => {
  delete process.env.WEBHOOK_SECRET;
});

describe('payments webhook', () => {
  it('rejects a wrong shared secret with 401', async () => {
    const res = mockRes();
    await handler(post({ secret: 'nope', job_id: '26_011_Kuhn', amount: 800, paid_date: '2026-06-01' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a non-POST method with 405', async () => {
    const res = mockRes();
    await handler({ method: 'GET', body: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('requires job_id / amount / paid_date', async () => {
    const res = mockRes();
    await handler(post({ secret: SECRET, amount: 800, paid_date: '2026-06-01' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-positive amount', async () => {
    const res = mockRes();
    await handler(post({ secret: SECRET, job_id: '26_011_Kuhn', amount: 0, paid_date: '2026-06-01' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('404s when the job_id does not exist', async () => {
    getDb.mockReturnValue(makeDb({ job: null }));
    const res = mockRes();
    await handler(post({ secret: SECRET, job_id: '99_999_Nobody', amount: 800, paid_date: '2026-06-01' }), res);
    expect(res.statusCode).toBe(404);
  });

  it('DEDUPS a repeated qbo_invoice_id — no second insert', async () => {
    const insertSpy = vi.fn();
    getDb.mockReturnValue(
      makeDb({ job: { job_id: '26_011_Kuhn' }, existing: { id: 'pay-existing' }, insertSpy }),
    );
    const res = mockRes();
    await handler(
      post({ secret: SECRET, job_id: '26_011_Kuhn', amount: 800, paid_date: '2026-06-01', qbo_invoice_id: 'INV-42' }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true, persisted: false, payment_id: 'pay-existing' });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('inserts a new payment for a fresh qbo_invoice_id', async () => {
    const insertSpy = vi.fn();
    getDb.mockReturnValue(
      makeDb({ job: { job_id: '26_011_Kuhn' }, existing: null, inserted: { id: 'pay-new' }, insertSpy }),
    );
    const res = mockRes();
    await handler(
      post({ secret: SECRET, job_id: '26_011_Kuhn', amount: 1400, paid_date: '2026-06-02', qbo_invoice_id: 'INV-99' }),
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ persisted: true, payment_id: 'pay-new' });
    expect(insertSpy).toHaveBeenCalledOnce();
    expect(insertSpy.mock.calls[0][0]).toMatchObject({ job_id: '26_011_Kuhn', amount: 1400, payment_method: 'qb' });
  });
});
