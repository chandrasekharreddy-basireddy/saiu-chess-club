import { serve } from '@hono/node-server';
import { buildApp } from './core/app.js';
import { PgRepo } from './core/repo-pg.js';
import { MemoryRepo } from './core/repo-memory.js';
import { repoAuditSink } from './core/audit.js';
import type { FeatureContext } from './core/types.js';
import { seedDemo } from './seed.js';

const connectionString = process.env.DATABASE_URL;
const repo = connectionString ? new PgRepo(connectionString) : new MemoryRepo();

let n = 0;
const ctx: FeatureContext = {
  repo,
  audit: repoAuditSink({ repo, now: () => new Date().toISOString(), newId: () => `id_${Date.now()}_${++n}` }),
  now: () => new Date().toISOString(),
  newId: () => `id_${Date.now().toString(36)}_${(++n).toString(36)}`,
};

const app = buildApp(ctx);

if (process.env.SEED_DEMO === '1') {
  const r = await seedDemo(ctx);
  console.log('demo seed:', JSON.stringify(r));
}
const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SaiU Chess Club API listening on http://localhost:${info.port} (db: ${connectionString ? 'postgres' : 'memory'})`);
});
