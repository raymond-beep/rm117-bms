// Phase 5 — reverse-geocode address formatting + field-note location sanitizing.
// formatAddress must never throw on junk (a bad geocoder response can't break a
// note save), and sanitizeLocation must keep only a finite lat/lng + clean address.
import { describe, it, expect } from 'vitest';
import { formatAddress } from '../api/_lib/geocode.js';
import { sanitizeLocation } from '../api/field-notes.js';

describe('formatAddress (Nominatim reverse response → one-line address)', () => {
  it('builds "street, city, state zip" from address parts', () => {
    const json = {
      address: { house_number: '123', road: 'Main St', city: 'Springfield', state: 'NJ', postcode: '07081' },
    };
    expect(formatAddress(json)).toBe('123 Main St, Springfield, NJ 07081');
  });

  it('falls back through town/village when city is absent', () => {
    const json = { address: { road: 'Elm Ave', village: 'Madison', state: 'NJ' } };
    expect(formatAddress(json)).toBe('Elm Ave, Madison, NJ');
  });

  it('uses display_name when structured parts are missing', () => {
    expect(formatAddress({ display_name: '1600 Pennsylvania Ave, Washington' }))
      .toBe('1600 Pennsylvania Ave, Washington');
  });

  it('returns null for junk / empty input (never throws)', () => {
    expect(formatAddress(null)).toBe(null);
    expect(formatAddress(undefined)).toBe(null);
    expect(formatAddress({})).toBe(null);
    expect(formatAddress({ address: {} })).toBe(null);
    expect(formatAddress('nope')).toBe(null);
  });
});

describe('sanitizeLocation (field-note GPS pin)', () => {
  it('keeps a finite lat/lng pair', () => {
    expect(sanitizeLocation({ lat: 40.7, lng: -74.1 })).toEqual({ lat: 40.7, lng: -74.1 });
  });

  it('coerces numeric strings', () => {
    expect(sanitizeLocation({ lat: '40.7', lng: '-74.1' })).toEqual({ lat: 40.7, lng: -74.1 });
  });

  it('carries an optional address (trimmed + capped)', () => {
    expect(sanitizeLocation({ lat: 1, lng: 2, address: '  123 Main St  ' }))
      .toEqual({ lat: 1, lng: 2, address: '123 Main St' });
    const long = 'x'.repeat(400);
    expect(sanitizeLocation({ lat: 1, lng: 2, address: long }).address).toHaveLength(300);
  });

  it('rejects a non-finite or missing pair → null', () => {
    expect(sanitizeLocation({ lat: 'abc', lng: 2 })).toBe(null);
    expect(sanitizeLocation({ lat: 1 })).toBe(null);
    expect(sanitizeLocation(null)).toBe(null);
    expect(sanitizeLocation('nope')).toBe(null);
  });
});
