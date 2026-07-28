// The demo's writable layer.
//
// The demo build ships with no database and no credentials. But an app you can
// only look at is a brochure — the point of handing someone a demo is that they
// drag a job to a new phase, log a payment, type into the planner, and watch the
// numbers move. So writes land in localStorage, per browser.
//
// That is deliberately BETTER than a shared demo database here: two people
// clicking around at the same time never step on each other, nothing can be left
// broken for the next viewer, and "Reset demo data" is a single key delete.
//
// Shape: fixtures are the base, this holds only the deltas on top of them.

import { JOBS, CLIENTS, CLIENT_CONTACTS, PAYMENTS, FOREFRONT, PHASE_EVENTS } from './fixtures/jobs.js';
import { PROPOSALS, LETTERS, FIELD_NOTES, DELEGATION_NOTES } from './fixtures/integrations.js';

const KEY = 'rm117-demo-store-v1';

// A deep clone of the pristine fixture set. Every read goes through this, so a
// mutation can never reach back into the imported fixture module.
function pristine() {
  return structuredClone({
    jobs: JOBS,
    clients: CLIENTS,
    contacts: CLIENT_CONTACTS,
    payments: PAYMENTS,
    forefront: FOREFRONT,
    phaseEvents: PHASE_EVENTS,
    proposals: PROPOSALS,
    letters: LETTERS,
    fieldNotes: FIELD_NOTES,
    delegationNotes: DELEGATION_NOTES,
    delegationStrokes: [],
    dismissedDriveFolders: [],
  });
}

let state = null;

function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Merge onto a fresh base so a fixture added in a later build still shows up
      // for someone whose browser holds an older saved store.
      state = { ...pristine(), ...saved };
      return state;
    }
  } catch {
    /* corrupt or unavailable storage — fall through to a clean slate */
  }
  state = pristine();
  return state;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — the demo still works, it just won't survive reload */
  }
}

// Read the whole store. Callers must not mutate what they get back; use update().
export function db() {
  return load();
}

// Mutate the store and persist in one step. `fn` receives the live state object.
export function update(fn) {
  const s = load();
  const out = fn(s);
  persist();
  return out;
}

// Wipe every local edit and go back to the shipped fixtures.
export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  state = null;
  load();
}

// Has the viewer changed anything? Drives the "Reset demo data" button's hint.
export function hasEdits() {
  try {
    return Boolean(localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

export function newId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
