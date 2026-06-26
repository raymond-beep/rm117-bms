// Auth gate — locks in the Phase-1 security fix so it can never silently
// regress. Every staff data endpoint (jobs, clients, payments, forefront,
// phase-events, field-notes) funnels through requireStaff, so testing the gate
// covers all of them at once: no token -> 401, non-staff -> 403, staff -> pass.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api/_lib/clerk.js', () => ({
  hasClerk: vi.fn(),
  getAuthClaims: vi.fn(),
  getUserEmail: vi.fn(),
}));

import { hasClerk, getAuthClaims, getUserEmail } from '../api/_lib/clerk.js';
import { requireStaff } from '../api/_lib/require-staff.js';

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
}

const reqWith = (token) => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireStaff', () => {
  it('allows a local-dev user when Clerk is not configured', async () => {
    hasClerk.mockReturnValue(false);
    const res = mockRes();
    const result = await requireStaff(reqWith(null), res);
    expect(result).toBe('local-dev');
    expect(res.statusCode).toBeNull(); // no error response sent
  });

  it('sends 401 when there is no valid session token', async () => {
    hasClerk.mockReturnValue(true);
    getAuthClaims.mockResolvedValue(null);
    const res = mockRes();
    const result = await requireStaff(reqWith(null), res);
    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Not authenticated' });
  });

  it('sends 401 when the token has no userId', async () => {
    hasClerk.mockReturnValue(true);
    getAuthClaims.mockResolvedValue({ userId: null, role: null });
    const res = mockRes();
    expect(await requireStaff(reqWith('tok'), res)).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('fast-paths a token carrying the staff role claim (no email fetch)', async () => {
    hasClerk.mockReturnValue(true);
    getAuthClaims.mockResolvedValue({ userId: 'user_123', role: 'staff' });
    const res = mockRes();
    const result = await requireStaff(reqWith('tok'), res);
    expect(result).toBe('user_123');
    expect(getUserEmail).not.toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('falls back to the @rm117.com email check when no role claim', async () => {
    hasClerk.mockReturnValue(true);
    getAuthClaims.mockResolvedValue({ userId: 'user_123', role: null });
    getUserEmail.mockResolvedValue('angelena@rm117.com');
    const res = mockRes();
    expect(await requireStaff(reqWith('tok'), res)).toBe('user_123');
    expect(getUserEmail).toHaveBeenCalledWith('user_123');
  });

  it('sends 403 for a valid token that is not an RM117 staff account (e.g. a portal client)', async () => {
    hasClerk.mockReturnValue(true);
    getAuthClaims.mockResolvedValue({ userId: 'client_1', role: null });
    getUserEmail.mockResolvedValue('homeowner@gmail.com');
    const res = mockRes();
    expect(await requireStaff(reqWith('tok'), res)).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Staff access required' });
  });

  it('sends 403 when the email cannot be resolved', async () => {
    hasClerk.mockReturnValue(true);
    getAuthClaims.mockResolvedValue({ userId: 'user_123', role: null });
    getUserEmail.mockResolvedValue(null);
    const res = mockRes();
    expect(await requireStaff(reqWith('tok'), res)).toBeNull();
    expect(res.statusCode).toBe(403);
  });
});
