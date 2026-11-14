/**
 * Cloudflare Worker entrypoint: serves the SPA from static assets and the API
 * from the same origin, so the browser never talks to the database directly.
 */
import { buildApp } from './core/app.js';
import { SupabaseRepo } from './core/repo-supabase.js';
import { D1Repo } from './core/repo-d1.js';
import { MemoryRepo } from './core/repo-memory.js';
import { repoAuditSink } from './core/audit.js';
import type { FeatureContext } from './core/types.js';

export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  DB?: any;
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  DATABASE_URL?: string;
}

let seq = 0;
const newId = () => `id_${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function makeCtx(env: Env): FeatureContext {
  const repo = env.SUPABASE_URL && env.SUPABASE_KEY
    ? new SupabaseRepo(env.SUPABASE_URL, env.SUPABASE_KEY)
    : env.DB
      ? new D1Repo(env.DB)
      : new MemoryRepo();
  const now = () => new Date().toISOString();
  return { repo, now, newId, audit: repoAuditSink({ repo, now, newId }) };
}

/**
 * The app graph (repo + 50 mounted routers) is built once per isolate and reused.
 * Rebuilding it per request would be wasteful and, with the in-memory adapter,
 * would silently reset state between requests.
 */
const apps = new WeakMap<object, ReturnType<typeof buildApp>>();

function appFor(env: Env) {
  let app = apps.get(env as object);
  if (!app) {
    app = buildApp(makeCtx(env));
    apps.set(env as object, app);
  }
  return app;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      return appFor(env).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
