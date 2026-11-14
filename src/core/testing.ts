import { appendFileSync } from 'node:fs';
import type { FeatureContext, Repo, Role, Row } from './types.js';
import { MemoryRepo } from './repo-memory.js';
import { D1Repo } from './repo-d1.js';
import { MemoryAudit } from './audit.js';
import { permissionsFor } from './permissions.js';
import { createSession } from './auth.js';

let counter = 0;

/**
 * Wraps a repo and records every (table, field) pair the feature modules touch,
 * so `db/schema.sql` can be generated from what the code actually uses.
 */
export class IntrospectingRepo implements Repo {
  constructor(private inner: Repo, private outFile: string) {}
  private note(table: string, row: Row) {
    try {
      appendFileSync(this.outFile, JSON.stringify({ table, fields: Object.keys(row || {}), values: row || {} }) + '\n');
    } catch { /* never let schema capture break a test */ }
  }
  async insert(table: string, row: any) { this.note(table, row); return this.inner.insert(table, row); }
  async get(table: string, id: string) { return this.inner.get(table, id); }
  async find(table: string, f?: any, o?: any) { return this.inner.find(table, f, o); }
  async findOne(table: string, f?: any) { return this.inner.findOne(table, f); }
  async update(table: string, id: string, patch: any) { this.note(table, patch); return this.inner.update(table, id, patch); }
  async remove(table: string, id: string) { return this.inner.remove(table, id); }
  async count(table: string, f?: any) { return this.inner.count(table, f); }
}

/** Deterministic context for tests: in-memory repo, recording audit sink, fixed clock. */
export function makeCtx(now = '2026-01-15T09:00:00.000Z') {
  const base = process.env.SCC_REPO === 'd1' ? new D1Repo(new FakeD1() as any) : new MemoryRepo();
  const repo: Repo = process.env.SCC_SCHEMA_OUT
    ? new IntrospectingRepo(base, process.env.SCC_SCHEMA_OUT)
    : base;
  const audit = new MemoryAudit();
  const ctx: FeatureContext = {
    repo,
    audit,
    now: () => now,
    newId: () => `t_${++counter}`,
  };
  return { ctx, repo, audit };
}

export interface SeedUserOpts {
  roles?: Role[];
  state?: string;
  permissions?: string[];
  name?: string;
  email?: string;
}

/** Creates a user row plus a live session token usable as `Authorization: Bearer <token>`. */
export async function seedUser(ctx: FeatureContext, opts: SeedUserOpts = {}) {
  const roles = opts.roles ?? ['member'];
  const id = ctx.newId();
  const user: Row = await ctx.repo.insert('users', {
    id,
    email: opts.email ?? `${id}@saiuniversity.edu.in`,
    name: opts.name ?? `User ${id}`,
    roles,
    state: opts.state ?? 'active',
    permissions: opts.permissions?.length ? opts.permissions : permissionsFor(roles),
    passwordHash: 'pbkdf2$1$x$y',
    createdAt: ctx.now(),
  });
  const { token } = await createSession(ctx, id);
  return { user, token, headers: { authorization: `Bearer ${token}` } as Record<string, string> };
}

/* ------------------------------------------------------------------
 * Fake D1: a minimal SQLite-shaped surface over a Map, so the whole
 * suite can be run against the *deployed* data adapter (D1Repo).
 *   SCC_REPO=d1 npx vitest run
 * ------------------------------------------------------------------ */
export class FakeD1 {
  rows = new Map<string, Map<string, string>>();
  private table(t: string) {
    let m = this.rows.get(t);
    if (!m) { m = new Map(); this.rows.set(t, m); }
    return m;
  }
  prepare(sql: string) {
    const self = this;
    const run = async (vals: any[]) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('INSERT')) {
        const [t, id, doc] = vals;
        self.table(String(t)).set(String(id), String(doc));
        return { success: true };
      }
      if (s.startsWith('DELETE')) {
        const [t, id] = vals;
        self.table(String(t)).delete(String(id));
        return { success: true };
      }
      return { success: true };
    };
    const read = async (vals: any[]) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('SELECT DOC FROM CHESS_ROWS WHERE T = ? AND ID = ?')) {
        const doc = self.table(String(vals[0])).get(String(vals[1]));
        return doc ? [{ doc }] : [];
      }
      const all = [...(self.rows.get(String(vals[0]))?.values() || [])].map((doc) => ({ doc }));
      return all;
    };
    const api: any = {
      bind: (...vals: any[]) => ({ all: async () => ({ results: await read(vals) }), first: async () => (await read(vals))[0] ?? null, run: () => run(vals) }),
      all: async () => ({ results: await read([]) }),
      first: async () => (await read([]))[0] ?? null,
      run: () => run([]),
    };
    return api;
  }
}
