import type { Repo, Row, ListOpts } from './types.js';

/**
 * Cloudflare D1 adapter (SQLite, free tier, no secrets, no external network).
 *
 * D1 is the zero-cost durable store for the deployed Worker. Because D1 has a fixed
 * schema and the platform's domain model is wide (172 tables), rows are stored as
 * documents in one table and filtered in the adapter. Table scans are bounded by
 * `limit` and the club's data volume is small; the relational Postgres/Supabase
 * adapters remain the normal path for institutional deployment.
 */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: any[]): {
      all<T = any>(): Promise<{ results: T[] }>;
      run(): Promise<{ success: boolean; meta?: any }>;
      first<T = any>(): Promise<T | null>;
    };
    all<T = any>(): Promise<{ results: T[] }>;
    run(): Promise<{ success: boolean; meta?: any }>;
    first<T = any>(): Promise<T | null>;
  };
}

function matches(row: Row, filter?: Row): boolean {
  if (!filter) return true;
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined) continue;
    if (row[k] !== v) return false;
  }
  return true;
}

export class D1Repo implements Repo {
  constructor(private db: D1Like) {}

  private async rows(table: string): Promise<Row[]> {
    const res = await this.db.prepare('SELECT doc FROM chess_rows WHERE t = ?').bind(table).all<{ doc: string }>();
    return (res.results || []).map((r) => JSON.parse(r.doc) as Row);
  }

  private async put(table: string, row: Row) {
    await this.db
      .prepare('INSERT INTO chess_rows (t, id, doc) VALUES (?, ?, ?) ON CONFLICT(t, id) DO UPDATE SET doc = excluded.doc')
      .bind(table, row.id, JSON.stringify(row))
      .run();
  }

  async insert(table: string, row: Row): Promise<Row> {
    const ts = new Date().toISOString();
    const rec: Row = { createdAt: ts, updatedAt: ts, ...row };
    if (!rec.id) rec.id = crypto.randomUUID();
    await this.put(table, rec);
    return rec;
  }

  async get(table: string, id: string): Promise<Row | null> {
    const r = await this.db.prepare('SELECT doc FROM chess_rows WHERE t = ? AND id = ?').bind(table, id).first<{ doc: string }>();
    return r ? (JSON.parse(r.doc) as Row) : null;
  }

  async find(table: string, filter?: Row, opts?: ListOpts): Promise<Row[]> {
    let out = (await this.rows(table)).filter((r) => matches(r, filter));
    if (opts?.orderBy) {
      const k = opts.orderBy;
      out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0));
      if (opts.desc) out.reverse();
    }
    const off = opts?.offset ?? 0;
    const lim = opts?.limit ?? out.length;
    return out.slice(off, off + lim);
  }

  async findOne(table: string, filter?: Row): Promise<Row | null> {
    const rows = await this.find(table, filter, { limit: 1 });
    return rows[0] ?? null;
  }

  async update(table: string, id: string, patch: Row): Promise<Row | null> {
    const cur = await this.get(table, id);
    if (!cur) return null;
    const next: Row = { ...cur, ...patch, id, updatedAt: new Date().toISOString() };
    await this.put(table, next);
    return next;
  }

  async remove(table: string, id: string): Promise<boolean> {
    const cur = await this.get(table, id);
    if (!cur) return false;
    await this.db.prepare('DELETE FROM chess_rows WHERE t = ? AND id = ?').bind(table, id).run();
    return true;
  }

  async count(table: string, filter?: Row): Promise<number> {
    return (await this.rows(table)).filter((r) => matches(r, filter)).length;
  }
}
