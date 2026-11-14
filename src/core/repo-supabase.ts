import type { Repo, Row, ListOpts } from './types.js';

/**
 * Supabase PostgREST implementation of Repo.
 * Pure HTTPS (fetch) so it runs unchanged on Cloudflare Workers — no TCP socket,
 * no connection pool, no Supabase Auth dependency (doc 02 §5).
 */
export class SupabaseRepo implements Repo {
  private url: string;
  private key: string;
  private prefix: string;

  constructor(url: string, key: string, prefix = 'chess_') {
    this.url = url.replace(/\/$/, '');
    this.key = key;
    this.prefix = prefix;
  }

  /** All platform tables live under a prefix so they never collide with other
   *  applications sharing the same Supabase project. */
  private t(table: string) {
    return this.prefix + table;
  }

  private async req(path: string, init: RequestInit = {}) {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.key,
        authorization: `Bearer ${this.key}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status} on ${path}: ${text.slice(0, 300)}`);
    }
    const raw = await res.text();
    return raw ? JSON.parse(raw) : null;
  }

  async insert(table: string, row: Row): Promise<Row> {
    const out = await this.req(this.t(table), {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    return Array.isArray(out) ? out[0] : out;
  }

  async get(table: string, id: string): Promise<Row | null> {
    const out = await this.req(`${this.t(table)}?id=eq.${encodeURIComponent(id)}&limit=1`);
    return out?.[0] ?? null;
  }

  async find(table: string, filter?: Row, opts?: ListOpts): Promise<Row[]> {
    const qs = this.query(filter, opts);
    return (await this.req(`${this.t(table)}${qs}`)) || [];
  }

  async findOne(table: string, filter?: Row): Promise<Row | null> {
    const rows = await this.find(table, filter, { limit: 1 });
    return rows[0] ?? null;
  }

  async update(table: string, id: string, patch: Row): Promise<Row | null> {
    const out = await this.req(`${this.t(table)}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    return (Array.isArray(out) ? out[0] : out) ?? null;
  }

  async remove(table: string, id: string): Promise<boolean> {
    const out = await this.req(`${this.t(table)}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { prefer: 'return=representation' },
    });
    return Array.isArray(out) && out.length > 0;
  }

  async count(table: string, filter?: Row): Promise<number> {
    const qs = this.query(filter, { limit: 1 });
    const res = await fetch(`${this.url}/rest/v1/${this.t(table)}${qs}`, {
      method: 'HEAD',
      headers: { apikey: this.key, authorization: `Bearer ${this.key}`, prefer: 'count=exact' },
    });
    const range = res.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  }

  private query(filter?: Row, opts?: ListOpts) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(filter || {})) {
      if (v === undefined) continue;
      parts.push(`${encodeURIComponent(k)}=eq.${encodeURIComponent(String(v))}`);
    }
    if (opts?.orderBy) parts.push(`order=${encodeURIComponent(opts.orderBy)}.${opts.desc ? 'desc' : 'asc'}`);
    if (opts?.limit != null) parts.push(`limit=${Number(opts.limit)}`);
    if (opts?.offset != null) parts.push(`offset=${Number(opts.offset)}`);
    return parts.length ? `?${parts.join('&')}` : '';
  }
}
