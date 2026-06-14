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
  '/api/forefront': () => import('./api/forefront.js'),
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
