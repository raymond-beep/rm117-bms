#!/usr/bin/env bash
# Assemble the demo site into demo-site/dist/.
#
#   demo-site/dist/
#     index.html        the access gate + app picker (landing)
#     setup.html        Setup & Connections guide
#     resound/          the Resound BMS demo (single self-contained file)
#     app/              the Room 117 BMS demo (React SPA, built with base=/app/)
#
# Nothing here carries a credential: the Room 117 demo is built in demo mode
# (fixtures only, Clerk aliased away) and the Resound demo has never had a
# backend. That is what makes this safe to hand out.
#
# Usage:  ./demo-site/build.sh        (run from the repo root)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE="$ROOT/demo-site"
OUT="$SITE/dist"
RESOUND_SRC="${RESOUND_SRC:-$HOME/Desktop/Resound BMS/resound-bms.html}"

echo "▸ Building the Room 117 demo (fixtures only, no credentials)…"
cd "$ROOT"
npm run build:demo

echo "▸ Refreshing the Resound demo from its source repo…"
if [ -f "$RESOUND_SRC" ]; then
  cp "$RESOUND_SRC" "$SITE/resound/index.html"
  echo "  copied from: $RESOUND_SRC"
else
  echo "  ⚠ source not found — using the copy already in demo-site/resound/"
fi

echo "▸ Assembling $OUT …"
# dist/ is where `vercel deploy` runs from, so it holds the .vercel project link.
# Wiping it would unlink the project and the next deploy would sit waiting for
# input — preserve it across the rebuild.
LINK_TMP="$(mktemp -d)"
[ -d "$OUT/.vercel" ] && cp -R "$OUT/.vercel" "$LINK_TMP/"
rm -rf "$OUT"
mkdir -p "$OUT"
[ -d "$LINK_TMP/.vercel" ] && cp -R "$LINK_TMP/.vercel" "$OUT/"
rm -rf "$LINK_TMP"
cp "$SITE/index.html" "$OUT/index.html"
cp "$SITE/setup.html" "$OUT/setup.html"
# Carries the noindex headers + cleanUrls (the demo SPA routes in the hash, so no rewrite is needed).
cp "$SITE/vercel.json" "$OUT/vercel.json"
mkdir -p "$OUT/resound"
cp "$SITE/resound/index.html" "$OUT/resound/index.html"
cp -R "$ROOT/dist-demo" "$OUT/app"

# Guard rail: fail loudly rather than shipping a build that somehow picked up a
# real key.
#
# Matches credential VALUES, never variable names — setup.html legitimately
# documents `SUPABASE_SERVICE_KEY=` with nothing after it, and a check that trips
# on documentation is a check people learn to skip. So each pattern below requires
# actual key material: a live/test key prefix followed by its body, a JWT with a
# real payload (Supabase keys are JWTs), or an env name with a value attached.
echo "▸ Checking the bundle carries no credentials…"
CRED_RE='(sk_live_[A-Za-z0-9]{8}|pk_live_[A-Za-z0-9]{8}|sk_test_[A-Za-z0-9]{8}|eyJhbGciOi[A-Za-z0-9_-]{30,}|(SUPABASE_SERVICE_KEY|CLERK_SECRET_KEY|ANTHROPIC_API_KEY|QBO_CLIENT_SECRET)=[A-Za-z0-9_-]{8})'
if grep -rlE "$CRED_RE" "$OUT" >/dev/null 2>&1; then
  echo "  ✗ FAILED — something that looks like a real credential is in the output. Not shipping."
  grep -rlE "$CRED_RE" "$OUT" || true
  exit 1
fi
echo "  ✓ clean"

echo
echo "✅ Done — $OUT"
echo "   Preview:  npx serve demo-site/dist"
echo "   Deploy:   vercel deploy --prod demo-site/dist"
