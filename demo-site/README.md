# Demo site — Resound BMS + Room 117 BMS

One static site, one access code, two demos. Built to hand to **Nick Hreczny**
(Resound Technologies) and his assistant so they can click through their own system
and the reference build it came from.

```
demo-site/dist/
  index.html        access gate + app picker (Resound leads)
  setup.html        Setup & Connections — every service, cost, and wiring order
  resound/          Resound BMS demo (one self-contained file)
  app/              Room 117 BMS demo (React SPA, built with base=/app/)
  vercel.json       SPA rewrite for /app/*, noindex headers
```

## Build and deploy

```bash
./demo-site/build.sh                       # assembles demo-site/dist
cd demo-site/dist && vercel deploy --prod  # linked to project rm117-resound-demo
```

`build.sh` rebuilds the Room 117 demo, re-copies the Resound file from
`~/Desktop/Resound BMS/resound-bms.html` (override with `RESOUND_SRC=…`), assembles
`dist/`, and refuses to ship if anything resembling a real credential appears in the
output.

## Why this is safe to hand out

Neither demo can reach a real service, and that is structural rather than a promise:

- **No credentials ship.** The Room 117 demo is built with `VITE_DEMO_MODE=1`, which
  aliases `@clerk/clerk-react` to a local shim and installs `src/demo/api.js` — a router
  that intercepts `window.fetch` and answers every `/api/*` call from fixtures. There is
  no Supabase URL, no QuickBooks token, no Google key in the bundle.
- **Every figure is invented.** No record is copied, scrambled or derived from real RM117
  or Resound data.
- **Writes stay in the viewer's browser.** localStorage only, with a reset button. Two
  people clicking around never affect each other.
- **The Resound demo never had a backend** to begin with.

The access code is a client-side check (`VITE_DEMO_PASSWORD` in `.env.demo`, and the
`CODE` constant in `index.html` — keep them equal). It is a "not for casual visitors"
sign, not a security control, which is the right level given there is nothing real
behind it. If the demo ever carries something real, replace it with Vercel's
project-level Password Protection instead.

## Changing the access code

Two places, both must match:

- `.env.demo` → `VITE_DEMO_PASSWORD=`
- `demo-site/index.html` → `var CODE = '…'`

Then rerun `./demo-site/build.sh` and redeploy.

## Where the demo code lives

| Path | Purpose |
|------|---------|
| `src/demo/api.js` | The router: intercepts `window.fetch`, serves all ~40 endpoints from fixtures |
| `src/demo/store.js` | localStorage write layer + reset |
| `src/demo/fixtures/jobs.js` | Jobs, clients, contacts, payments, Forefront, phase events |
| `src/demo/fixtures/integrations.js` | QuickBooks, Gmail, Calendar, Drive queue, checkset review, planner |
| `src/demo/clerk-shim.jsx` | Stand-in for `@clerk/clerk-react` (aliased in `vite.config.js` when demo) |
| `src/demo/DemoFrame.jsx` | Access gate + the "Demo — sample data" badge |

Production is untouched by all of it: the alias and the demo entry point are both behind
`VITE_DEMO_MODE`, so a normal `npm run build` produces exactly what it did before.
