// QBO OAuth helpers — the state (CSRF) round-trip and authorize-URL builder.
// CSRF on the connect/callback flow is a commitment we made in the Intuit
// Compliance questionnaire, so a regression here is worth catching at the gate.
import { describe, it, expect } from 'vitest';
import {
  makeState,
  verifyState,
  buildAuthorizeUrl,
  callbackUriFromReq,
  isLocalhostReq,
  QBO_SCOPE,
} from '../api/_lib/qbo-oauth.js';

const SECRET = 'test-client-secret';

describe('makeState / verifyState (CSRF)', () => {
  it('verifies a freshly signed state', () => {
    const s = makeState(SECRET);
    expect(verifyState(SECRET, s)).toBe(true);
  });

  it('rejects a state signed with a different secret', () => {
    const s = makeState(SECRET);
    expect(verifyState('other-secret', s)).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const s = makeState(SECRET);
    const [payload, sig] = s.split('.');
    const forged = `${payload}x.${sig}`;
    expect(verifyState(SECRET, forged)).toBe(false);
  });

  it('rejects an expired state', () => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const s = makeState(SECRET, tenMinAgo);
    // maxAge 5 min → the 10-min-old state is stale
    expect(verifyState(SECRET, s, 5 * 60 * 1000)).toBe(false);
    // but valid under a 15-min window
    expect(verifyState(SECRET, s, 15 * 60 * 1000)).toBe(true);
  });

  it('rejects junk / missing state', () => {
    expect(verifyState(SECRET, undefined)).toBe(false);
    expect(verifyState(SECRET, '')).toBe(false);
    expect(verifyState(SECRET, 'no-dot')).toBe(false);
    expect(verifyState('', makeState(SECRET))).toBe(false);
  });

  it('throws if asked to sign without a secret', () => {
    expect(() => makeState('')).toThrow();
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes the accounting scope, redirect, client id and state', () => {
    const url = buildAuthorizeUrl({
      clientId: 'ABC',
      redirectUri: 'http://localhost:3001/api/qbo/callback',
      state: 'xyz',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(u.searchParams.get('client_id')).toBe('ABC');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe(QBO_SCOPE);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3001/api/qbo/callback');
    expect(u.searchParams.get('state')).toBe('xyz');
  });

  it('requires clientId and redirectUri', () => {
    expect(() => buildAuthorizeUrl({ redirectUri: 'x', state: 's' })).toThrow();
    expect(() => buildAuthorizeUrl({ clientId: 'x', state: 's' })).toThrow();
  });
});

describe('callbackUriFromReq / isLocalhostReq', () => {
  it('builds an http localhost callback from a dev request', () => {
    const req = { headers: { host: 'localhost:3001' }, socket: {} };
    expect(callbackUriFromReq(req)).toBe('http://localhost:3001/api/qbo/callback');
    expect(isLocalhostReq(req)).toBe(true);
  });

  it('builds an https callback behind a proxy (Vercel)', () => {
    const req = {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'rm117-bms.vercel.app' },
      socket: {},
    };
    expect(callbackUriFromReq(req)).toBe('https://rm117-bms.vercel.app/api/qbo/callback');
    expect(isLocalhostReq(req)).toBe(false);
  });
});
