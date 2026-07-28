import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Two builds come out of this one config:
//
//   npm run build        production — unchanged; talks to Clerk, Supabase, QBO…
//   npm run build:demo   the standalone demo (VITE_DEMO_MODE=1)
//
// The demo swap is a single alias: '@clerk/clerk-react' resolves to a local shim,
// which is what lets the app run with no auth provider while every component file
// keeps its normal import. Nothing below changes a production build — the alias is
// only added when VITE_DEMO_MODE is set. See src/demo/README.md.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const demo = env.VITE_DEMO_MODE === '1';

  return {
    plugins: [react()],
    // The demo is served under /app/ on the shared demo site (the landing page and
    // the Resound demo own the root), so assets and the router both need that base.
    base: demo ? '/app/' : '/',
    resolve: {
      alias: demo
        ? { '@clerk/clerk-react': path.resolve(__dirname, 'src/demo/clerk-shim.jsx') }
        : {},
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    build: {
      // Keep the demo's output separate so a demo build never overwrites the
      // production dist/ that Vercel deploys from.
      outDir: demo ? 'dist-demo' : 'dist',
    },
  };
});
