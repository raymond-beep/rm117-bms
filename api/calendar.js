// GET /api/calendar — upcoming events from the signed-in user's Google Calendar.
// Reads the user's primary calendar plus the shared company calendar
// (COMPANY_CALENDAR_ID) if configured. Read-only; same per-user Google OAuth as
// the Priority Inbox, but needs the calendar.readonly scope granted.
//
// Response:
//   { connected: true, events: [{ id, title, start, end, allDay, location, calendar }] }
//   { connected: false, reason: 'google_not_connected' | 'google_reauth_needed' | ... }
//
// Query params: ?days=14 (how far ahead to look).
import { hasClerk, getUserId, getGoogleToken } from './_lib/clerk.js';

const CAL = 'https://www.googleapis.com/calendar/v3';

async function calGet(path, token) {
  const r = await fetch(`${CAL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const err = new Error(`calendar ${r.status}`);
    err.status = r.status;
    err.body = await r.text().catch(() => '');
    throw err;
  }
  return r.json();
}

// Fetch events from one calendar between timeMin/timeMax. Missing/forbidden
// calendars (e.g. a COMPANY_CALENDAR_ID the user can't see) resolve to [].
async function listEvents(calendarId, token, timeMin, timeMax, label) {
  const q = new URLSearchParams({
    timeMin, timeMax,
    singleEvents: 'true', // expand recurring events into instances
    orderBy: 'startTime',
    maxResults: '50',
  });
  try {
    const data = await calGet(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`, token);
    return (data.items || []).map((e) => ({
      id: e.id,
      title: e.summary || '(no title)',
      start: e.start?.dateTime || e.start?.date || null,
      end: e.end?.dateTime || e.end?.date || null,
      allDay: Boolean(e.start?.date && !e.start?.dateTime),
      location: e.location || null,
      calendar: label,
    }));
  } catch (e) {
    if (e.status === 404 || e.status === 403) return []; // not visible to this user
    throw e;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!hasClerk()) {
    return res.status(200).json({ connected: false, reason: 'clerk_not_configured' });
  }

  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const { token, error } = await getGoogleToken(userId);
  if (error) return res.status(200).json({ connected: false, reason: error });

  const url = new URL(req.url, 'http://localhost');
  const days = Math.min(Number(url.searchParams.get('days')) || 14, 60);
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 86400000).toISOString();

  try {
    const sources = [['primary', token, timeMin, timeMax, 'mine']];
    if (process.env.COMPANY_CALENDAR_ID) {
      sources.push([process.env.COMPANY_CALENDAR_ID, token, timeMin, timeMax, 'company']);
    }
    const results = await Promise.all(sources.map((args) => listEvents(...args)));
    const events = results
      .flat()
      .filter((e) => e.start)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    res.status(200).json({ connected: true, count: events.length, events });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      // Token lacks calendar.readonly (or expired) — needs reconnect with the scope.
      return res.status(200).json({ connected: false, reason: 'google_reauth_needed' });
    }
    console.error('[api/calendar]', err);
    res.status(500).json({ error: err.message });
  }
}
