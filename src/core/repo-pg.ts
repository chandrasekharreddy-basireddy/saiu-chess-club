import postgres from 'postgres';
import type { Repo, Row, ListOpts } from './types.js';

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function id(name: string) {
  if (!IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `"${name}"`;
}

/**
 * PostgreSQL implementation of Repo (Supabase Postgres, doc 02 §5).
 * Parameterized values, validated identifiers, least-privilege role expected.
 */
export class PgRepo implements Repo {
  private sql: postgres.Sql;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, { max: 5, idle_timeout: 20, prepare: false });
  }

  async insert(table: string, row: Row): Promise<Row> {
    const keys = Object.keys(row);
    const cols = keys.map(id).join(', ');
    const params = keys.map((k, i) => `$${i + 1}`).join(', ');
    const q = `INSERT INTO ${id(table)} (${cols}) VALUES (${params}) RETURNING *`;
    const rows = await this.sql.unsafe(q, keys.map((k) => (row as Row)[k]) as any[]);
    return rows[0];
  }

  async get(table: string, rid: string): Promise<Row | null> {
    const rows = await this.sql.unsafe(`SELECT * FROM ${id(table)} WHERE id = $1 LIMIT 1`, [rid]);
    return rows[0] ?? null;
  }

  async find(table: string, filter?: Row, opts?: ListOpts): Promise<Row[]> {
    const { where, values } = this.where(filter);
    let q = `SELECT * FROM ${id(table)}${where}`;
    if (opts?.orderBy) q += ` ORDER BY ${id(opts.orderBy)} ${opts.desc ? 'DESC' : 'ASC'}`;
    if (opts?.limit != null) q += ` LIMIT ${Number(opts.limit)}`;
    if (opts?.offset != null) q += ` OFFSET ${Number(opts.offset)}`;
    return await this.sql.unsafe(q, values as any[]);
  }

  async findOne(table: string, filter?: Row): Promise<Row | null> {
    const rows = await this.find(table, filter, { limit: 1 });
    return rows[0] ?? null;
  }

  async update(table: string, rid: string, patch: Row): Promise<Row | null> {
    const keys = Object.keys(patch);
    if (!keys.length) return this.get(table, rid);
    const sets = keys.map((k, i) => `${id(k)} = $${i + 1}`).join(', ');
    const q = `UPDATE ${id(table)} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`;
    const rows = await this.sql.unsafe(q, [...keys.map((k) => patch[k]), rid] as any[]);
    return rows[0] ?? null;
  }

  async remove(table: string, rid: string): Promise<boolean> {
    const rows = await this.sql.unsafe(`DELETE FROM ${id(table)} WHERE id = $1 RETURNING id`, [rid]);
    return rows.length > 0;
  }

  async count(table: string, filter?: Row): Promise<number> {
    const { where, values } = this.where(filter);
    const rows = await this.sql.unsafe(`SELECT COUNT(*)::int AS n FROM ${id(table)}${where}`, values as any[]);
    return rows[0]?.n ?? 0;
  }

  private where(filter?: Row) {
    const entries = Object.entries(filter || {}).filter(([, v]) => v !== undefined);
    if (!entries.length) return { where: '', values: [] as any[] };
    const clause = entries.map(([k], i) => `${id(k)} = $${i + 1}`).join(' AND ');
    return { where: ` WHERE ${clause}`, values: entries.map(([, v]) => v) };
  }

  async close() { await this.sql.end({ timeout: 5 }); }
}
