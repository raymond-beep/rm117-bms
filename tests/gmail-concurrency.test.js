// Tests for the Gmail rate-limit defences: bounded fan-out + 429 retry.
//
// These exist because the bug they prevent is INVISIBLE. Gmail caps CONCURRENT
// requests per user, and every per-message fan-out on the Mail page used
// `Promise.all(...).catch(() => null)` — so a 429 looked exactly like "that
// message doesn't exist". Measured on a real mailbox: 120 parallel metadata
// reads dropped 5 messages, then 36 on an immediate second run. The Mail list
// reported 20 conversations on one load and 40 on the next, with nothing logged.
//
// `fetch` is stubbed; no network.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { gmailGet, mapGmail } from '../api/_lib/gmail-read.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const ok = (body) => ({
  ok: true, status: 200, json: async () => body, headers: new Headers(),
});
const fail = (status, headers = {}) => ({
  ok: false, status, text: async () => `{"error":{"code":${status}}}`,
  json: async () => ({}), headers: new Headers(headers),
});

describe('mapGmail', () => {
  it('never exceeds its concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);

    const out = await mapGmail(items, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n * 2;
    }, { concurrency: 6 });

    expect(peak).toBeLessThanOrEqual(6);
    expect(out).toHaveLength(50);
  });

  it('preserves input order regardless of completion order', async () => {
    // Later items finish FIRST here — a naive push-as-you-go would scramble the
    // list, and the Mail page sorts on the message dates it reads back.
    const out = await mapGmail([30, 20, 10, 0], async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    }, { concurrency: 4 });
    expect(out).toEqual([30, 20, 10, 0]);
  });

  it('REJECTS rather than returning a short list when an item fails', async () => {
    // The whole point: a hole must be detectable. Silently dropping the failure
    // is what made a truncated inbox look like a complete one.
    await expect(mapGmail([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('gmail 429');
      return n;
    }, { concurrency: 2 })).rejects.toThrow('gmail 429');
  });

  it('handles an empty list without spawning workers', async () => {
    const fn = vi.fn();
    expect(await mapGmail([], fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('gmailGet retry', () => {
  it('retries a 429 and returns the eventual success', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(fail(429))
      .mockResolvedValueOnce(fail(429))
      .mockResolvedValueOnce(ok({ id: 'm1' }));

    expect(await gmailGet('/messages/m1', 'tok')).toEqual({ id: 'm1' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries 5xx too — a transient Google blip is not a missing message', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(ok({ id: 'm2' }));
    expect(await gmailGet('/messages/m2', 'tok')).toEqual({ id: 'm2' });
  });

  it('does NOT retry a 403 — a missing scope will never succeed', async () => {
    // mark-read relies on this: gmail.modify not being granted must fail fast
    // and be reported, not burn four backoffs first.
    globalThis.fetch = vi.fn().mockResolvedValue(fail(403));
    await expect(gmailGet('/x', 'tok')).rejects.toMatchObject({ status: 403 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after its retry budget and throws with the status attached', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fail(429));
    await expect(gmailGet('/x', 'tok', { retries: 2 })).rejects.toMatchObject({ status: 429 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('honours a Retry-After header', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(fail(429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(ok({ ok: 1 }));
    expect(await gmailGet('/x', 'tok')).toEqual({ ok: 1 });
  });
});
