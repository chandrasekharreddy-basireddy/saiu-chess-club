# SaiU Chess Club

The chess-club platform of **Sai University**: tournaments, ratings, the arena, the academy,
the notice board, finance, governance — and the club's operational backbone. Built to the
26-document specification set in Notion, under a hard **₹0 cost policy**.

```
web/            static SPA (no build step) — served from the same origin as the API
src/core/       kernel: types, permissions, auth, repos, audit, HTTP envelope
src/features/   one module per feature (service.ts + routes.ts)
test/           vitest suites, one file per feature
db/schema.sql   generated from the tables the modules actually write
```

> **Source location:** the platform source ships in the `saiu-chess-club.zip` archive. See
> [DEPLOY.md](DEPLOY.md) for importing it and deploying.

## Why this shape

The specification pins the architecture: Cloudflare Pages + Workers, Supabase PostgreSQL,
**application-built authentication** (Supabase Auth is explicitly excluded), and no paid tier
anywhere. So the code is organised around three rules:

1. **The Worker owns authorization.** Every protected route checks a permission key on the
   server before it touches data. The browser never sees a database credential.
2. **Persistence is behind one interface.** `Repo` has four implementations — in-memory (tests,
   demo), Cloudflare D1 (deployed, no secrets), PostgreSQL (`postgres.js`), and Supabase
   PostgREST over `fetch` (works on Workers with no socket). Swapping storage changes no
   feature code.
3. **A feature is a module.** Each of the 50 features exports `mount(app, ctx)` and is mounted
   at `/api/v1/<slug>`. A module that fails to mount degrades to a 503 on its own slug instead
   of taking the platform down.

## Run it

```bash
npm install
npm test                            # 50 feature suites, 332 tests
npm run typecheck                   # clean
SEED_DEMO=1 PORT=8787 npm run dev   # API + demo club data, in-memory store
```

Open `web/index.html` through the Worker (or any static server) — the SPA talks to `/api/v1/*`
on the same origin.

## Test and schema

```bash
npm test                      # 50 suites / 332 tests (memory adapter)
SCC_REPO=d1 npm test          # the same 332 tests against the D1 adapter used in production
npm run schema                # regenerate db/schema.sql (172 tables) from real code usage
npm run bundle                # esbuild -> dist/worker.js
node scripts/smoke-worker.mjs # exercises the built bundle: routing, auth, envelopes
```

`npm run schema` runs the suite with an introspecting repo, records every table and field the
modules write, and emits idempotent DDL. The schema is therefore never out of date with the code.

## Deploy

See [DEPLOY.md](DEPLOY.md). Short version: `npm run bundle && npx wrangler deploy`.

## Identity and authorization

- Passwords: PBKDF2-SHA256, 100k iterations, per-user salt, via Web Crypto (Node and Workers alike).
- Sessions: opaque 32-byte tokens in a `sessions` table, 7-day expiry, revocable server-side,
  delivered as a Bearer token or `scc_session` cookie.
- Roles: President, Administrator, Organizer, Coach, Committee official, Member, Alumnus,
  Spectator. Effective permissions are the union of role grants; `*` is an explicit full grant
  held only by Administrator. Account state gates every request (`pending`, `suspended`).
- **Separation of duties** is enforced in code, not by convention: a proposer cannot approve
  their own schedule, expense, facility booking or alumni application.
- Every state change writes an audit row (`audit_log`): action, actor, target, detail, time.

## The zero-cost guardrails

- No payment processing anywhere in the platform.
- The AI feature keeps a rupee-paise ledger against the ₹100 Sarvam credit, refuses calls with
  `429` once exhausted, and falls back to a deterministic non-AI answer — core club operations
  never depend on AI.
- The integrations feature holds a quota counter per provider and refuses work that would cross
  a free-tier limit rather than incur an overage.
- Hosting is Cloudflare free tier; the Worker has no paid binding.

## Status

- 50 feature modules mounted at `/api/v1/<slug>`, one test file each, **332 tests passing**
  against both the in-memory and the D1 adapter.
- `tsc --noEmit` clean across `src/` and `test/`.
- 172 tables derived from real code usage (`db/schema.sql`).
- Built Worker bundle verified end to end (`scripts/smoke-worker.mjs`, 9/9).

What this does **not** claim: institutional approvals, verified university domain data,
validated provider free-tier terms, or production load figures. Those remain open dependencies
in the specification. Some capabilities are recorded rather than delivered — notifications are
durable rows rather than email, chess legality is structural rather than a full engine, and
the AI feature degrades to a deterministic answer because no paid provider is wired in.
