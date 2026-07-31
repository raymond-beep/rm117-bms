// Weekly Planner row-level write permissions — the security rule of the feature.
// A staff member may edit ONLY their own row; the admin (Angelena) may edit any row.
// Enforced server-side in api/delegation.js (this app can't use RLS — Supabase is
// reached only via the service-role key). If this ever regresses, one employee could
// rewrite or tick off another's list via a direct API call.
import { describe, it, expect } from 'vitest';
import { canWrite, canModifyTask, STUDIO_ROW } from '../api/delegation.js';

const ray = { email: 'raymond@rm117.com', is_admin: false };
const ang = { email: 'angelena@rm117.com', is_admin: true };

describe('canWrite (edit/clear a row)', () => {
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

  it('lets the admin write the shared Everyone lane, but blocks staff', () => {
    expect(canWrite(ang, STUDIO_ROW)).toBe(true);
    expect(canWrite(ray, STUDIO_ROW)).toBe(false);
    // Defense-in-depth: even an actor whose email somehow equals the sentinel is blocked
    // unless they're a real admin (the sentinel is not a valid email, so this can't happen).
    expect(canWrite({ email: STUDIO_ROW, is_admin: false }, STUDIO_ROW)).toBe(false);
  });
});

describe('canModifyTask (tick / rename / remove an item)', () => {
  // ⭐ Keyed on the ROW the task sits in, NOT on who created it. Angelena assigns
  // most items, so an author-based rule would mean nobody could tick off their own
  // work — the one interaction the board exists for. This test is the guard against
  // someone "tightening" it to created_by_email and silently breaking the feature.
  it('lets you tick an item in your OWN row that the admin assigned to you', () => {
    expect(canModifyTask(ray, {
      row_owner_email: 'raymond@rm117.com', created_by_email: 'angelena@rm117.com',
    })).toBe(true);
  });

  it("blocks touching an item in someone else's row, even one you created", () => {
    expect(canModifyTask(ray, {
      row_owner_email: 'tom@rm117.com', created_by_email: 'raymond@rm117.com',
    })).toBe(false);
  });

  it('lets the admin modify any row', () => {
    expect(canModifyTask(ang, { row_owner_email: 'tom@rm117.com' })).toBe(true);
  });

  it('keeps the shared Everyone lane admin-only', () => {
    expect(canModifyTask(ray, { row_owner_email: STUDIO_ROW })).toBe(false);
    expect(canModifyTask(ang, { row_owner_email: STUDIO_ROW })).toBe(true);
  });

  it('rejects a missing actor or task', () => {
    expect(canModifyTask(null, { row_owner_email: 'tom@rm117.com' })).toBe(false);
    expect(canModifyTask(ray, null)).toBe(false);
  });
});
