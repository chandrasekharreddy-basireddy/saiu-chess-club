import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // Public leaderboard (no auth): never includes private fields or disputed games.
  app.get('/leaderboard', async (c) => {
    const res = await svc.leaderboard(ctx, {
      pool: c.req.query('pool'),
      department: c.req.query('department'),
      minGames: c.req.query('minGames') as any,
      limit: c.req.query('limit') as any,
      offset: c.req.query('offset') as any,
    });
    return ok(c, page(res.items, res.total, res.limit, res.offset));
  });

  app.get('/corrections', requireAuth(), requirePermission('rating.recalculate', 'audit.log.read'), async (c) => {
    return ok(c, await svc.listCorrections(ctx));
  });

  app.post('/corrections', requireAuth(), requirePermission('rating.recalculate'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.requestCorrection(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/profiles', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.upsertProfile(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.patch('/profiles/:userId/privacy', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    if (s.userId !== c.req.param('userId') && !(s.permissions || []).includes('*')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You may only change your own privacy settings' } }, 403);
    }
    return ok(c, await svc.upsertProfile(ctx, c.req.param('userId'), { privacy: b.privacy || b }));
  });

  app.get('/profiles/:userId/history', async (c) => {
    return ok(c, await svc.listHistory(ctx, c.req.param('userId'), c.req.query('pool')));
  });

  app.get('/profiles/:userId', async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getProfile(ctx, s?.userId || null, s?.permissions || [], c.req.param('userId')));
  });

  app.post('/results', requireAuth(), requirePermission('rating.recalculate'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.recordRatedResult(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/profiles/:userId/dispute', requireAuth(), requirePermission('match.dispute.resolve_assigned', 'rating.recalculate'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.markDisputed(ctx, s.userId, c.req.param('userId'), b.open !== false));
  });
}
