// Local dev wrapper for the Vercel serverless functions in api/.
// Vite (5173) proxies /api/* here (3001). On Vercel, api/ files deploy directly
// as serverless functions and this file is never used.
import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

// Route table: URL path -> api/ module. Add a line here when adding an api/ file.
const routes = {
  '/api/health': () => import('./api/health.js'),
  '/api/jobs': () => import('./api/jobs.js'),
  '/api/jobs/create': () => import('./api/jobs/create.js'),
  '/api/jobs/update': () => import('./api/jobs/update.js'),
  '/api/payments': () => import('./api/payments.js'),
  '/api/clients': () => import('./api/clients.js'),
  '/api/phase-events': () => import('./api/phase-events.js'),
  '/api/field-notes': () => import('./api/field-notes.js'),
  // Portal routes are one consolidated function; the dispatcher reads the
  // trailing path segment (Vercel passes it as the [action] dynamic segment).
  '/api/portal/me': () => import('./api/portal/[action].js'),
  '/api/portal/preview': () => import('./api/portal/[action].js'),
  '/api/portal/files': () => import('./api/portal/[action].js'),
  '/api/portal/download': () => import('./api/portal/[action].js'),
  '/api/portal/messages': () => import('./api/portal/[action].js'),
  '/api/portal/send': () => import('./api/portal/[action].js'),
  '/api/forefront': () => import('./api/forefront.js'),
  '/api/inbox': () => import('./api/inbox.js'),
  '/api/calendar': () => import('./api/calendar.js'),
  '/api/payments/webhook': () => import('./api/payments/webhook.js'),
};

for (const [path, load] of Object.entries(routes)) {
  app.all(path, async (req, res) => {
    try {
      const mod = await load();
      await mod.default(req, res);
    } catch (err) {
      console.error(`[api] ${path} failed:`, err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => {
  console.log(`[api] RM117 API listening on http://localhost:${PORT}`);
});
