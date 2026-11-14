import { Hono } from 'hono';
import type { Context } from 'hono';
import type { FeatureContext, Session } from './types.js';
import { AppError } from './errors.js';
import { sessionMiddleware, requireAuth, createSession, verifyPassword, hashPassword } from './auth.js';
import { permissionsFor } from './permissions.js';
import { ok, created, fail, requireSession } from './http.js';
import { FEATURES } from '../features/index.js';

type AppEnv = { Variables: { session: Session | null; parsedBody: any } };

export function buildApp(ctx: FeatureContext) {
  const app = new Hono<AppEnv>();

  app.use('*', sessionMiddleware(ctx));

  app.onError((err, c) => {
    if (err instanceof AppError) return fail(c, err.code, err.message, err.status, err.details);
    const e: any = err;
    if (e?.status && e?.code) return fail(c, e.code, e.message || 'Request failed', e.status);
    return fail(c, 'INTERNAL', 'Unexpected server error', 500);
  });

  app.notFound((c) => fail(c, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`, 404));

  app.get('/health', (c) => ok(c, { status: 'ok', service: 'saiu-chess-club-api', features: FEATURES.length }));

  // ---- core identity routes (doc 04) ----
  const auth = new Hono<AppEnv>();

  auth.post('/register', async (c) => {
    const b = c.get('parsedBody') as any;
    if (!b?.email || !b?.password) throw new AppError('BAD_REQUEST', 'email and password are required', 400);
    if (String(b.password).length < 10) throw new AppError('BAD_REQUEST', 'password must be at least 10 characters', 400);
    const domain = String(b.email).split('@')[1]?.toLowerCase();
    const allow = (await ctx.repo.find('domain_allowlist', { active: true })).map((d: any) => d.domain);
    const existing = await ctx.repo.findOne('users', { email: String(b.email).toLowerCase() });
    if (existing) throw new AppError('CONFLICT', 'An account with this email already exists', 409);
    const user = await ctx.repo.insert('users', {
      id: ctx.newId(),
      email: String(b.email).toLowerCase(),
      name: b.name || null,
      roles: ['member'],
      permissions: permissionsFor(['member']),
      state: allow.length && !allow.includes(domain) ? 'pending' : 'pending',
      emailVerified: false,
      passwordHash: await hashPassword(String(b.password)),
      createdAt: ctx.now(),
    });
    await ctx.audit.record({ action: 'account.register', actorId: user.id, targetType: 'user', targetId: user.id });
    return created(c, { id: user.id, email: user.email, state: user.state });
  });

  auth.post('/login', async (c) => {
    const b = c.get('parsedBody') as any;
    const user = await ctx.repo.findOne('users', { email: String(b?.email || '').toLowerCase() });
    if (!user || !(await verifyPassword(String(b?.password || ''), user.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
    }
    if (user.state === 'suspended') throw new AppError('FORBIDDEN', 'Account is suspended', 403);
    const { token, expiresAt } = await createSession(ctx, user.id);
    await ctx.audit.record({ action: 'account.login', actorId: user.id, targetType: 'user', targetId: user.id });
    return ok(c, { token, expiresAt, user: { id: user.id, name: user.name, roles: user.roles, state: user.state } });
  });

  auth.post('/logout', async (c) => {
    const s = requireSession(c);
    const token = (c.req.header('authorization') || '').replace('Bearer ', '').trim();
    const rec = await ctx.repo.findOne('sessions', { token });
    if (rec) await ctx.repo.update('sessions', rec.id, { revokedAt: ctx.now() });
    await ctx.audit.record({ action: 'account.logout', actorId: s.userId });
    return ok(c, { loggedOut: true });
  });

  app.route('/api/v1/auth', auth);

  app.get('/api/v1/me', requireAuth(), async (c) => {
    const s = requireSession(c);
    const user = await ctx.repo.get('users', s.userId);
    return ok(c, { id: s.userId, roles: s.roles, permissions: s.permissions, name: user?.name ?? null, state: s.state });
  });

  app.get('/api/v1/features', (c) =>
    ok(c, FEATURES.map((f) => ({ id: f.id, slug: f.slug, name: f.name, permissions: f.permissions, base: `/api/v1/${f.slug}` }))),
  );

  for (const f of FEATURES) {
    const sub = new Hono<AppEnv>();
    try {
      f.mount(sub, ctx);
    } catch (e) {
      // a feature must never take the whole platform down
      sub.get('/', (c: Context) => fail(c, 'FEATURE_UNAVAILABLE', `Feature ${f.id} failed to mount`, 503));
    }
    app.route(`/api/v1/${f.slug}`, sub);
  }

  return app;
}
