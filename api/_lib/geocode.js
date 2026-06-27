// Reverse geocoding for field-note GPS pins (Phase 5).
// Turns a {lat,lng} into a human street address so the site report reads like a
// record, not a pile of coordinates. Uses OpenStreetMap Nominatim — keyless and
// free — so there's no API key to provision. Fail-soft by design: any error
// (network, rate-limit, no match) returns null and the caller keeps the raw pin.
//
// Nominatim usage policy: identify with a User-Agent, ≤1 req/sec. We only call
// this once per saved note that carries a fresh pin, so volume is trivial.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const TIMEOUT_MS = 4000; // a site visit shouldn't hang on the geocoder

// Pure: shape a Nominatim reverse-geocode response into a concise one-line
// address ("123 Main St, Springfield, NJ 07081"). Exported for unit tests.
// Falls back to display_name, then null.
export function formatAddress(json) {
  if (!json || typeof json !== 'object') return null;
  const a = json.address;
  if (a && typeof a === 'object') {
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county;
    const region = [a.state, a.postcode].filter(Boolean).join(' ');
    const line = [street, city, region].filter(Boolean).join(', ');
    if (line) return line;
  }
  if (typeof json.display_name === 'string' && json.display_name.trim()) {
    return json.display_name.trim();
  }
  return null;
}

// Look up a street address for a coordinate pair. Returns a string or null —
// never throws, so a geocoder hiccup can't fail a field-note save.
export async function reverseGeocode(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;

  const url = `${NOMINATIM_URL}?format=json&lat=${la}&lon=${ln}&zoom=18&addressdetails=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Identify the app per Nominatim policy.
        'User-Agent': 'RM117-BMS/1.0 (field-note site reports; raymond@rm117.com)',
        'Accept': 'application/json',
      },
    });
    if (!r.ok) return null;
    const json = await r.json();
    return formatAddress(json);
  } catch (err) {
    console.error('[geocode] reverse lookup failed:', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
