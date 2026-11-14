# Deploying SaiU Chess Club

The platform is a single Cloudflare Worker that serves both the API (`/api/v1/*`) and the
static SPA, backed by a D1 database. Everything below is free tier.

## What is already provisioned

| Resource | State |
| --- | --- |
| D1 database `saiu-chess-club` | created, `chess_rows` table present |
| D1 binding in `wrangler.toml` | `DB` → `0e85f6d4-2522-4d9f-8159-5b93e60d8f1b` |
| Worker build | `npm run bundle` → `dist/worker.js` |

No secrets are required for durable storage: the Worker prefers Supabase secrets, then the D1
binding, then an in-memory store.

## Deploy

```bash
npm ci
npm run typecheck
npm test                 # 50 suites, 332 tests
npm run bundle
npx wrangler deploy
```

Or let CI do it: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets
and the `verify-and-deploy` workflow runs on every push that touches `src/`, `test/`, `web/`
or the build configuration.

## Local development

```bash
npm install
SEED_DEMO=1 PORT=8787 npm run dev
```

Demo accounts (password `saiu-chess-2026`): `president@`, `organizer@`, `admin@` and four
members at `saiuniversity.edu.in`.

## Switching to institutional Postgres

```bash
npm run schema                                  # regenerate db/schema.sql from the code
psql "$DATABASE_URL" -f db/schema.sql           # 172 tables, prefixed chess_
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Use a server-side key only. The Worker talks to Supabase PostgREST over HTTPS, so no database
socket is opened from the edge and no credential ever reaches the browser.

## Verifying a deployment

```bash
curl https://<worker>.workers.dev/health          # {"features":50}
curl https://<worker>.workers.dev/api/v1/features # the 50 mounted modules
node scripts/smoke-worker.mjs                     # the same checks against a local build
```
