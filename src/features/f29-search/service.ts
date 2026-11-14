import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, quotaExceeded } from '../../core/errors.js';

/**
 * Feature 29 — Search & Discovery
 *
 * Tables
 *  search_queries — per-user query log; also the rate-limit ledger (own table).
 *
 * Search reads tables owned by other features. EVERY table read is wrapped in a
 * try/catch so that a missing table (a feature not merged yet, or a renamed table)
 * can never break the endpoint — that source simply contributes no hits.
 *
 * Domains searched (read-only):
 *  tournaments   -> tournaments
 *  notice        -> notices / club_notices
 *  event         -> events / club_events
 *  media         -> media_items
 *  kb            -> kb_articles / knowledge_base_articles / kb_entries
 *  page          -> site_blocks
 *
 * Permission filtering happens BEFORE matching and snippet generation, so hidden
 * rows can neither appear nor leak text. Private messages, confidential support
 * tickets, eligibility evidence and finance records are never in any source list.
 */

export const QUERIES = 'search_queries';

export const RATE_LIMIT = 30;          // queries
export const RATE_WINDOW_MS = 60_000;  // per minute

export const RESULT_TYPES = ['tournament', 'notice', 'event', 'media', 'kb', 'page'] as const;
export type ResultType = (typeof RESULT_TYPES)[number];

export interface SearchResult {
  type: ResultType;
  id: string;
  title: string;
  snippet: string;
  url: string;
  /** higher is more relevant: title matches outrank body matches */
  score: number;
}

interface SourceDef {
  type: ResultType;
  tables: string[];
  titleFields: string[];
  bodyFields: string[];
  /** authorized destination for a hit */
  url(id: string): string;
  /** visibility gate — must run before matching */
  visible(row: Row, session: any): boolean;
}

const PUBLIC_TOURNAMENT_STATUSES = ['registration_open', 'registration_closed', 'scheduled', 'ongoing', 'completed', 'published'];
const PUBLIC_EVENT_STATUSES = ['published', 'scheduled', 'open', 'registration_open'];

function canManage(session: any, perm: string): boolean {
  const perms: string[] = session?.permissions ?? [];
  return perms.includes('*') || perms.includes(perm);
}

export const SOURCES: SourceDef[] = [
  {
    type: 'tournament',
    tables: ['tournaments'],
    titleFields: ['name', 'title'],
    bodyFields: ['description', 'summary', 'venue'],
    url: (id) => `/api/v1/tournaments/${id}`,
    visible: (row, session) =>
      PUBLIC_TOURNAMENT_STATUSES.includes(String(row.status)) || canManage(session, 'tournament.manage'),
  },
  {
    type: 'notice',
    tables: ['notices', 'club_notices'],
    titleFields: ['title', 'subject'],
    bodyFields: ['body', 'content', 'summary'],
    url: (id) => `/api/v1/notices/${id}`,
    visible: (row, session) => {
      if (row.status !== 'published') return canManage(session, 'notice.publish');
      if (row.visibility === 'members' || row.audience === 'members') return !!session;
      if (row.visibility === 'staff' || row.audience === 'staff') return canManage(session, 'notice.publish');
      return true;
    },
  },
  {
    type: 'event',
    tables: ['events', 'club_events'],
    titleFields: ['title', 'name'],
    bodyFields: ['description', 'summary', 'location', 'venue'],
    url: (id) => `/api/v1/events/${id}`,
    visible: (row, session) =>
      PUBLIC_EVENT_STATUSES.includes(String(row.status)) || canManage(session, 'event.manage'),
  },
  {
    type: 'media',
    tables: ['media_items'],
    titleFields: ['title'],
    bodyFields: ['caption', 'description'],
    url: (id) => `/api/v1/media/items/${id}`,
    visible: (row, session) => row.status === 'published' || canManage(session, 'media.manage'),
  },
  {
    type: 'kb',
    tables: ['kb_articles', 'knowledge_base_articles', 'kb_entries'],
    titleFields: ['title', 'question'],
    bodyFields: ['body', 'content', 'answer', 'summary'],
    url: (id) => `/api/v1/kb/articles/${id}`,
    // the knowledge base is a member resource: anonymous visitors never see it
    visible: (row, session) =>
      (!!session && canManage(session, 'kb.read') && row.status === 'published') || canManage(session, 'kb.publish'),
  },
  {
    type: 'page',
    tables: ['site_blocks'],
    titleFields: ['title'],
    bodyFields: ['summary', 'body'],
    url: (id) => `/api/v1/site/blocks/${id}`,
    visible: (row, session) => row.status === 'published' || canManage(session, 'site.experience.manage'),
  },
];

/** Read a table, never throwing: an absent table yields []. */
async function safeFind(ctx: FeatureContext, table: string): Promise<Row[]> {
  try {
    const rows = await ctx.repo.find(table, {});
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** First candidate table that actually has rows. */
async function rowsForSource(ctx: FeatureContext, source: SourceDef): Promise<Row[]> {
  for (const table of source.tables) {
    const rows = await safeFind(ctx, table);
    if (rows.length) return rows;
  }
  return [];
}

function textOf(row: Row, fields: string[]): string {
  return fields
    .map((f) => (row[f] == null ? '' : String(row[f])))
    .filter(Boolean)
    .join(' ');
}

function firstTitle(row: Row, fields: string[]): string {
  for (const f of fields) {
    if (row[f] != null && String(row[f]).trim()) return String(row[f]).trim();
  }
  return '(untitled)';
}

function snippetOf(body: string, needle: string): string {
  if (!body) return '';
  const idx = body.toLowerCase().indexOf(needle);
  if (idx < 0) {
    return body.length > 140 ? `${body.slice(0, 140).trim()}…` : body.trim();
  }
  const start = Math.max(0, idx - 50);
  const end = Math.min(body.length, idx + needle.length + 70);
  return `${start > 0 ? '…' : ''}${body.slice(start, end).trim()}${end < body.length ? '…' : ''}`;
}

async function enforceRateLimit(ctx: FeatureContext, userId: string | null) {
  if (!userId) return;
  const nowMs = new Date(ctx.now()).getTime();
  const rows = await safeFind(ctx, QUERIES);
  const recent = rows.filter((r) => r.userId === userId && new Date(r.createdAt ?? 0).getTime() >= nowMs - RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    throw quotaExceeded(`Search rate limit reached: ${RATE_LIMIT} queries per minute`);
  }
}

export interface SearchParams {
  q?: string;
  limit?: string | number;
  offset?: string | number;
  type?: string;
  sort?: string;
}

export interface SearchResponse {
  q: string;
  items: SearchResult[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  types: string[];
}

function clampInt(value: any, def: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function search(ctx: FeatureContext, session: any, params: SearchParams): Promise<SearchResponse> {
  const q = params?.q == null ? '' : String(params.q).trim();
  if (q.length < 2) throw badRequest('q must be at least 2 characters');
  const limit = clampInt(params.limit, 10, 1, 50);
  const offset = clampInt(params.offset, 0, 0, 10_000);

  const requested = params.type
    ? String(params.type).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    : null;
  if (requested) {
    for (const t of requested) {
      if (!RESULT_TYPES.includes(t as ResultType)) throw badRequest(`type must be one of: ${RESULT_TYPES.join(', ')}`);
    }
  }

  await enforceRateLimit(ctx, session?.userId ?? null);

  const needle = q.toLowerCase();
  const hits: SearchResult[] = [];

  for (const source of SOURCES) {
    if (requested && !requested.includes(source.type)) continue;
    const rows = await rowsForSource(ctx, source);
    for (const row of rows) {
      if (!row || row.id == null) continue;
      if (!source.visible(row, session)) continue; // permission filter BEFORE matching
      const title = firstTitle(row, source.titleFields);
      const body = textOf(row, source.bodyFields);
      const inTitle = title.toLowerCase().includes(needle);
      const inBody = body.toLowerCase().includes(needle);
      if (!inTitle && !inBody) continue;
      hits.push({
        type: source.type,
        id: String(row.id),
        title,
        snippet: inBody ? snippetOf(body, needle) : '',
        url: source.url(String(row.id)),
        score: (inTitle ? 2 : 0) + (inBody ? 1 : 0),
      });
    }
  }

  const sort = params?.sort === 'title' ? 'title' : 'relevance';
  hits.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (b.score !== a.score) return b.score - a.score;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.title.localeCompare(b.title);
  });

  // log the query for the rate-limit ledger (best effort; never fatal)
  try {
    await ctx.repo.insert(QUERIES, {
      id: ctx.newId(),
      userId: session?.userId ?? null,
      q,
      resultCount: hits.length,
      createdAt: ctx.now(),
    });
  } catch {
    /* logging must not break search */
  }

  const items = hits.slice(offset, offset + limit);
  return {
    q,
    items,
    total: hits.length,
    limit,
    offset,
    hasMore: offset + items.length < hits.length,
    types: [...new Set(hits.map((h) => h.type))],
  };
}

/** Lightweight typeahead: titles only, never snippets. */
export async function suggest(ctx: FeatureContext, session: any, q: string, limit = 5) {
  if (!q || String(q).trim().length < 2) throw badRequest('q must be at least 2 characters');
  const needle = String(q).trim().toLowerCase();
  const max = clampInt(limit, 5, 1, 20);
  const out: Array<{ type: ResultType; id: string; title: string; url: string }> = [];
  for (const source of SOURCES) {
    const rows = await rowsForSource(ctx, source);
    for (const row of rows) {
      if (!row || row.id == null) continue;
      if (!source.visible(row, session)) continue;
      const title = firstTitle(row, source.titleFields);
      if (!title.toLowerCase().includes(needle)) continue;
      out.push({ type: source.type, id: String(row.id), title, url: source.url(String(row.id)) });
    }
  }
  return out.slice(0, max);
}

/** Admin index health: how many searchable rows each source currently exposes. */
export async function indexHealth(ctx: FeatureContext, session: any) {
  const report = [];
  for (const source of SOURCES) {
    const rows = await rowsForSource(ctx, source);
    const visible = rows.filter((r) => r && r.id != null && source.visible(r, session)).length;
    report.push({
      type: source.type,
      tables: source.tables,
      tableFound: rows.length > 0,
      rows: rows.length,
      visible,
      hidden: rows.length - visible,
    });
  }
  return { sources: report, indexedTypes: report.filter((r) => r.tableFound).length, total: report.length };
}
