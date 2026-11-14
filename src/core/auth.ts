import type { Context, Next } from 'hono';
import type { FeatureContext, Session, Role } from './types.js';
import { AppError } from './errors.js';
import { hasPermission, permissionsFor } from './permissions.js';

const ITER = 100_000;
const enc = new TextEncoder();

/** Base64 helpers built on btoa/atob so the same code runs on Node and Workers (no Buffer). */
function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** PBKDF2-SHA256 via Web Crypto: runs unchanged on Node 20 and Cloudflare Workers. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: ITER, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${ITER}$${b64(salt.buffer)}$${b64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iter, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'pbkdf2') return false;
    const salt = fromB64(saltB64);
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: Number(iter), hash: 'SHA-256' }, key, 256);
    return b64(bits) === hashB64;
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  const raw = b64(crypto.getRandomValues(new Uint8Array(bytes)));
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const SESSION_COOKIE = 'scc_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export async function createSession(ctx: FeatureContext, userId: string, ttlMs = SESSION_TTL_MS) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await ctx.repo.insert('sessions', { id: ctx.newId(), userId, token, expiresAt, revokedAt: null, createdAt: ctx.now() });
  return { token, expiresAt };
}

export function readToken(c: Context): string | null {
  const auth = c.req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = c.req.header('cookie') || '';
  const m = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function resolveSession(ctx: FeatureContext, c: Context): Promise<Session | null> {
  const token = readToken(c);
  if (!token) return null;
  const s = await ctx.repo.findOne('sessions', { token });
  if (!s || s.revokedAt) return null;
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) return null;
  const user = await ctx.repo.get('users', s.userId);
  if (!user) return null;
  const roles = (user.roles || []) as Role[];
  return {
    userId: user.id,
    roles,
    permissions: user.permissions?.length ? user.permissions : permissionsFor(roles),
    state: user.state || 'active',
  };
}

/** Attaches req.session (may be null) and parses JSON bodies once. */
export function sessionMiddleware(ctx: FeatureContext) {
  return async (c: Context, next: Next) => {
    c.set('session', await resolveSession(ctx, c));
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
      try { c.set('parsedBody', await c.req.json()); } catch { c.set('parsedBody', {}); }
    }
    await next();
  };
}

export function requireAuth() {
  return async (c: Context, next: Next) => {
    const s = c.get('session') as Session | null;
    if (!s) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    if (s.state && s.state !== 'active') throw new AppError('FORBIDDEN', `Account is ${s.state}`, 403);
    await next();
  };
}

export function requirePermission(...perms: string[]) {
  return async (c: Context, next: Next) => {
    const s = c.get('session') as Session | null;
    if (!s) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    if (!perms.some((p) => hasPermission(s, p))) {
      throw new AppError('FORBIDDEN', `Requires permission: ${perms.join(' or ')}`, 403);
    }
    await next();
  };
}
