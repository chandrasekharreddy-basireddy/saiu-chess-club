import type { Repo, Row, ListOpts } from './types.js';

function matches(row: Row, filter?: Row): boolean {
  if (!filter) return true;
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined) continue;
    if (row[k] !== v) return false;
  }
  return true;
}

/** In-memory repository used by the test suite and local dev. */
export class MemoryRepo implements Repo {
  private tables = new Map<string, Map<string, Row>>();
  private seq = 0;

  private t(name: string) {
    let m = this.tables.get(name);
    if (!m) { m = new Map(); this.tables.set(name, m); }
    return m;
  }

  async insert(table: string, row: Row): Promise<Row> {
    const id = row.id || `id_${++this.seq}_${Math.random().toString(36).slice(2, 8)}`;
    const ts = new Date().toISOString();
    const rec: Row = { createdAt: ts, updatedAt: ts, ...row, id };
    this.t(table).set(id, rec);
    return structuredClone(rec);
  }

  async get(table: string, id: string): Promise<Row | null> {
    const r = this.t(table).get(id);
    return r ? structuredClone(r) : null;
  }

  async find(table: string, filter?: Row, opts?: ListOpts): Promise<Row[]> {
    let rows = [...this.t(table).values()].filter((r) => matches(r, filter as Row));
    if (opts?.orderBy) {
      const k = opts.orderBy;
      rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0));
      if (opts.desc) rows.reverse();
    }
    const off = opts?.offset ?? 0;
    const lim = opts?.limit ?? rows.length;
    rows = rows.slice(off, off + lim);
    return rows.map((r) => structuredClone(r));
  }

  async findOne(table: string, filter?: Row): Promise<Row | null> {
    const r = [...this.t(table).values()].find((x) => matches(x, filter));
    return r ? structuredClone(r) : null;
  }

  async update(table: string, id: string, patch: Row): Promise<Row | null> {
    const cur = this.t(table).get(id);
    if (!cur) return null;
    const next: Row = { ...cur, ...patch, id, updatedAt: new Date().toISOString() };
    this.t(table).set(id, next);
    return structuredClone(next);
  }

  async remove(table: string, id: string): Promise<boolean> {
    return this.t(table).delete(id);
  }

  async count(table: string, filter?: Row): Promise<number> {
    return [...this.t(table).values()].filter((r) => matches(r, filter)).length;
  }
}
