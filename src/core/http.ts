import type { Context } from 'hono';
import type { Session } from './types.js';
import { AppError } from './errors.js';

/** Standard envelope (doc 08 §3). */
export function ok(c: Context, data: any, status: 200 | 201 = 200) {
  return c.json({ ok: true, data }, status);
}
export function created(c: Context, data: any) {
  return c.json({ ok: true, data }, 201);
}
export function fail(c: Context, code: string, message: string, status = 400, details?: any) {
  return c.json({ ok: false, error: { code, message, ...(details ? { details } : {}) } }, status as any);
}
export function page<T>(items: T[], total: number, limit: number, offset: number) {
  return { items, total, limit, offset, hasMore: offset + items.length < total };
}

export function sessionOf(c: Context): Session | null {
  return (c.get('session') as Session) || null;
}
export function requireSession(c: Context): Session {
  const s = sessionOf(c);
  if (!s) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
  return s;
}
export function body<T = any>(c: Context): T {
  try {
    return (c.get('parsedBody') as T) ?? ({} as T);
  } catch {
    return {} as T;
  }
}
