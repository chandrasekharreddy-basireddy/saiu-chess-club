import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/certificates/:certificateId', async (c) => ok(c, await svc.verifyCertificate(ctx, c.req.param('certificateId'))));

  app.get('/seasons', async (c) => ok(c, await svc.listSeasons(ctx)));

  app.post('/seasons', requireAuth(), requirePermission('tournament.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createSeason(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/seasons/:id', async (c) => ok(c, await svc.getSeason(ctx, c.req.param('id'))));

  app.get('/seasons/:id/leaderboard', async (c) => ok(c, await svc.seasonLeaderboard(ctx, c.req.param('id'))));

  app.get('/seasons/:id/winners', async (c) => ok(c, await svc.listWinners(ctx, c.req.param('id'))));

  app.post('/seasons/:id/categories', requireAuth(), requirePermission('tournament.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addCategory(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/seasons/:id/criteria/publish', requireAuth(), requirePermission('tournament.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.publishCriteria(ctx, s.userId, c.req.param('id')));
  });

  app.post('/seasons/:id/points', requireAuth(), requirePermission('match.result.manage', 'tournament.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.recordSeasonPoints(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/seasons/:id/ratings', requireAuth(), requirePermission('rating.recalculate', 'tournament.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.recordRatingEntry(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.get(
    '/seasons/:id/categories/:categoryId/candidates',
    requireAuth(),
    requirePermission('tournament.manage', 'reporting.read', 'achievement.issue'),
    async (c) => ok(c, await svc.listCandidates(ctx, c.req.param('id'), c.req.param('categoryId'))),
  );

  app.post('/seasons/:id/categories/:categoryId/nominations', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.nominate(ctx, s.userId, c.req.param('id'), c.req.param('categoryId'), c.get('parsedBody') as any));
  });

  app.post('/seasons/:id/categories/:categoryId/approve', requireAuth(), requirePermission('achievement.issue'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.approveWinner(ctx, s.userId, c.req.param('id'), c.req.param('categoryId'), c.get('parsedBody') as any));
  });

  app.post('/seasons/:id/archive', requireAuth(), requirePermission('tournament.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.archiveSeason(ctx, s.userId, c.req.param('id')));
  });
}
