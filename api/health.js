// GET /api/health — Phase 0 checklist helper. Reports which integrations have
// env vars present (booleans only — never echoes secrets).
import { hasDb } from './_lib/db.js';
import { hasQbo } from './_lib/qbo.js';

export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    data_source: hasDb() ? 'supabase' : 'mock',
    env: {
      supabase: hasDb(),
      sheet: Boolean(process.env.SHEET_ID),
      google_service_account: Boolean(
        process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_PRIVATE_KEY
      ),
      resend: Boolean(process.env.RESEND_API_KEY),
      postmark: Boolean(process.env.POSTMARK_SERVER_TOKEN),
      docusign: Boolean(process.env.DOCUSIGN_INTEGRATION_KEY),
      qbo: hasQbo(), // all four QBO_* creds present (client id/secret/refresh/realm)
      company_calendar: Boolean(process.env.COMPANY_CALENDAR_ID),
      clerk: Boolean(process.env.CLERK_SECRET_KEY),
    },
  });
}
