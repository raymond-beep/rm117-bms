// Delegation Board row-level write permissions — the security rule of the feature.
// A staff member may draw/clear ONLY their own row; the admin (Angelena) may draw
// in any row. Enforced server-side in api/delegation.js (this app can't use RLS —
// Supabase is reached only via the service-role key). If this ever regresses, one
// employee could scribble in another's row via a direct API call.
import { describe, it, expect } from 'vitest';
import { canWrite, canDelete } from '../api/delegation.js';

const ray = { email: 'raymond@rm117.com', is_admin: false };
const ang = { email: 'angelena@rm117.com', is_admin: true };

describe('canWrite (draw/clear a row)', () => {
  it('lets a staff member write their own row', () => {
    expect(canWrite(ray, 'raymond@rm117.com')).toBe(true);
  });

  it("blocks a staff member from another person's row", () => {
    expect(canWrite(ray, 'tom@rm117.com')).toBe(false);
    expect(canWrite(ray, 'angelena@rm117.com')).toBe(false);
  });

  it('lets the admin write ANY row', () => {
    expect(canWrite(ang, 'tom@rm117.com')).toBe(true);
    expect(canWrite(ang, 'raymond@rm117.com')).toBe(true);
    expect(canWrite(ang, 'angelena@rm117.com')).toBe(true);
  });

  it('rejects a missing actor or missing email', () => {
    expect(canWrite(null, 'tom@rm117.com')).toBe(false);
    expect(canWrite({ email: null, is_admin: false }, 'tom@rm117.com')).toBe(false);
    expect(canWrite({ email: '', is_admin: false }, '')).toBe(false);
  });
});

describe('canDelete (undo a stroke)', () => {
  it('lets a staff member delete a stroke they created', () => {
    expect(canDelete(ray, { created_by_email: 'raymond@rm117.com' })).toBe(true);
  });

  it("blocks deleting someone else's stroke", () => {
    expect(canDelete(ray, { created_by_email: 'tom@rm117.com' })).toBe(false);
  });

  it('lets the admin delete any stroke', () => {
    expect(canDelete(ang, { created_by_email: 'tom@rm117.com' })).toBe(true);
  });

  it('rejects a missing actor or stroke', () => {
    expect(canDelete(null, { created_by_email: 'tom@rm117.com' })).toBe(false);
    expect(canDelete(ray, null)).toBe(false);
  });
});
