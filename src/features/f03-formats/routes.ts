import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page, requireSession } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

const MANAGE = ['tournament.manage', 'tournament.create', 'match.result.manage'];

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.post('/configs', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.createConfig(ctx, s.userId, c.get('parsedBody')));
  });

  app.get('/configs/:id', requireAuth(), async (c) => ok(c, await svc.getConfig(ctx, c.req.param('id'))));

  app.post('/configs/:id/validate', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.revalidateConfig(ctx, s.userId, c.req.param('id')));
  });

  app.post('/configs/:id/pairings', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    const b = c.get('parsedBody') || {};
    const round = Number(b.round ?? 1);
    return created(c, await svc.generatePairings(ctx, s.userId, c.req.param('id'), round, { scores: b.scores, winners: b.winners, regenerate: b.regenerate === true }));
  });

  app.post('/configs/:id/pairings/:pid/result', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.recordPairingResult(ctx, s.userId, c.req.param('id'), c.req.param('pid'), c.get('parsedBody')));
  });

  app.get('/configs/:id/standings', requireAuth(), async (c) => ok(c, await svc.standings(ctx, c.req.param('id'))));

  app.post('/configs/:id/start', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.startOfficialMatch(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/configs/:id/reset', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.requestReset(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/configs/:id/reset/:rid/approve', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.approveReset(ctx, s.userId, c.req.param('id'), c.req.param('rid'), c.get('parsedBody')));
  });

  app.post('/matches/:matchId/signals', requireAuth(), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.recordSignal(ctx, s.userId, c.req.param('matchId'), c.get('parsedBody')));
  });

  app.get('/matches/:matchId/signals', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const items = await svc.listSignals(ctx, { matchId: c.req.param('matchId'), status: c.req.query('status') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items, items.length, limit, offset));
  });

  app.post('/signals/:sid/decide', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.decideSignal(ctx, s.userId, c.req.param('sid'), c.get('parsedBody')));
  });

  app.post('/matches/:matchId/spectators', requireAuth(), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.requestSpectator(ctx, s.userId, c.req.param('matchId'), c.get('parsedBody')));
  });

  app.get('/matches/:matchId/spectators', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const items = await svc.listSpectators(ctx, c.req.param('matchId'));
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items, items.length, limit, offset));
  });

  app.post('/spectators/:sid/approve', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.approveSpectator(ctx, s.userId, c.req.param('sid')));
  });

  app.post('/spectators/:sid/revoke', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.revokeSpectator(ctx, s.userId, c.req.param('sid'), c.get('parsedBody')));
  });
}
