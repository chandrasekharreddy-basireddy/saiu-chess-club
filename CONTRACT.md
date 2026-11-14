# SaiU Chess Club — Feature Module Build Contract

You are one of 10 specialist engineers building a university chess-club platform.
Every engineer writes **feature modules** against this exact contract. The integration
engineer (the lead) merges all modules, type-checks and runs the whole suite.

## Absolute rules

1. **Do not modify anything in `src/core/`.** It is frozen. Read it, import from it, never edit it.
2. **Do not run `npm install`.** Do not add dependencies. The only external package you may import is `hono` (and `hono/*`).
3. Write **only** these files:
   - `src/features/fNN-<slug>/service.ts`
   - `src/features/fNN-<slug>/routes.ts`
   - `test/fNN.test.ts`
   (one pair per feature; `NN` is the two-digit feature number, e.g. `f07`)
4. Do not create `src/features/index.ts` — the lead builds the registry.
5. TypeScript is `strict: false` but the code must be correct, self-consistent and compile.
   Imports of local files **must** end in `.js` (e.g. `import { ok } from '../../core/http.js'`).
6. No `any`-casting your way out of a bug. Logic must actually implement the spec.
7. Never invent university integrations, credentials, paid services or approvals.

## File layout you receive

```
src/core/types.ts        FeatureModule, FeatureContext, Repo, Session, AuditSink
src/core/errors.ts       AppError + badRequest/notFound/conflict/forbidden/unauthorized/unprocessable/quotaExceeded
src/core/permissions.ts  hasPermission, hasAny, permissionsFor, assertNotSelfApproval
src/core/http.ts         ok, created, fail, page, requireSession
src/core/auth.ts         requireAuth(), requirePermission(...perms), createSession, hashPassword, verifyPassword
src/core/audit.ts        audit sinks
src/core/testing.ts      makeCtx(), seedUser()
src/features/f01-tournament-registration/{service,routes}.ts   ← REFERENCE IMPLEMENTATION, copy its shape
test/f01.test.ts                                               ← REFERENCE TEST
```

## Module shape

`routes.ts` must export exactly:

```ts
import type { Hono } from 'hono';
import type { FeatureContext } from '../../core/types.js';

export function mount(app: Hono, ctx: FeatureContext) { /* app is mounted at /api/v1/<slug> */ }
```

The lead wraps it in the registry as:

```ts
{ id: 7, slug: 'analysis', name: 'Chess Game Analysis & PGN Management',
  permissions: ['analysis.run'], mount }
```

**Slug rules:** lower-case kebab-case, unique, descriptive (e.g. `attendance`, `match-room`,
`arena`, `ratings`, `academy`, `community`, `finance`). Route paths inside `mount` are
relative to that slug: `app.get('/:id')` is `GET /api/v1/<slug>/:id`.

`service.ts` holds the business logic as exported async functions taking `ctx` first.
Routes stay thin: parse, authorize, call service, return `ok`/`created`.

## The repository

`ctx.repo` is a generic table store. There is **no schema migration step**: tables are
created implicitly by the first `insert`. Choose clear, namespaced table names
(`tournament_matches`, `academy_lessons`, …) and document them in a comment at the top of
`service.ts`.

```ts
await ctx.repo.insert('table', { ...fields });           // returns row with id
await ctx.repo.get('table', id);                          // row | null
await ctx.repo.find('table', { status: 'open' }, { limit: 20, offset: 0, orderBy: 'createdAt', desc: true });
await ctx.repo.findOne('table', { email: 'x' });           // first match | null
await ctx.repo.update('table', id, { status: 'closed' });  // row | null
await ctx.repo.remove('table', id);                        // boolean
await ctx.repo.count('table', { status: 'open' });         // number
```

- `id`, `createdAt`, `updatedAt` are added automatically on insert/update.
- Filters are exact equality on top-level fields only. For ranges/`$in`, fetch and filter in JS.
- Always store dates as ISO strings via `ctx.now()` or `new Date(...).toISOString()`.
- Always scope multi-tenant-ish rows by an explicit foreign key (e.g. `tournamentId`).

## Context helpers

```ts
ctx.now()      // ISO timestamp (deterministic in tests)
ctx.newId()    // unique id string
ctx.audit.record({ action, actorId, targetType, targetId, detail })
```

Audit **every** state change with a dotted action key (`finance.expense.approve`).

## Auth and permissions

```ts
import { requireAuth, requirePermission } from '../../core/auth.js';

app.post('/', requireAuth(), requirePermission('tournament.create'), handler);
```

Inside a handler:

```ts
const s = c.get('session') as any;   // { userId, roles, permissions, state }
const body = c.get('parsedBody') as any;   // parsed JSON body (never call c.req.json())
```

- `requirePermission('a', 'b')` passes if the session has **any** of them.
- `administrator` holds `*`, which satisfies every check.
- Enforce **separation of duties** with `assertNotSelfApproval(actorId, ownerId)` from
  `core/permissions.ts` wherever the spec requires independent approval.
- Public read endpoints (public site, leaderboards, notices) may omit `requireAuth()`.
- Never trust a role name as a permission; check the permission key.

## Response envelope (fixed)

```ts
return ok(c, data);            // 200 { ok: true, data }
return created(c, data);       // 201
throw badRequest('msg');       // -> { ok: false, error: { code, message } }
```

Throw `AppError` subclasses from `core/errors.ts`; the app-level error handler renders them.
Status codes: 400 validation, 401 unauthenticated, 403 forbidden/SoD, 404 missing,
409 conflict/state violation, 422 unprocessable, 429 quota exceeded.

For lists return `page(items, total, limit, offset)` from `core/http.ts`.

## Testing (mandatory)

`test/fNN.test.ts` with vitest. Use the reference test as the template:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

let app, ctx;
beforeEach(() => { const h = makeCtx(); ctx = h.ctx; app = buildApp(ctx); });

const post = (p, h, j) => app.request(p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: j ? JSON.stringify(j) : undefined });
```

Cover, per feature, at minimum:
1. the happy path end-to-end through HTTP;
2. the authorization boundary (a `member` session gets 403 where a role is required);
3. a validation or state-machine rejection (wrong status transition, duplicate, capacity);
4. one spec-specific rule (separation of duties, quota, waitlist promotion, rating math …).

Aim for 5–8 assertions per feature. **Tests must pass** — the lead runs them all and
reports failures as incomplete work. Do not write tests that assert your own bug.

## Output contract

Write finished files into your sandbox at `/scratch/output/` using the **same relative
paths** (`/scratch/output/src/features/f07-analysis/service.ts`, `/scratch/output/test/f07.test.ts`).
They are copied back to the lead automatically. Do not write a zip.

Finish with a short summary: feature number, slug, table names, endpoint list, test count,
and any spec rule you could not implement (say so plainly — do not fake it).
