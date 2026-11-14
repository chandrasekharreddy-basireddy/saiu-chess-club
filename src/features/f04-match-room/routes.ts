import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, requireSession } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

const MANAGE = ['match.result.manage', 'match.dispute.resolve_assigned', 'tournament.manage'];

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.post('/matches', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.createMatch(ctx, s.userId, c.get('parsedBody')));
  });

  app.get('/matches/:id', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.getMatchFor(ctx, c.req.param('id'), s.userId));
  });

  app.get('/matches/:id/state', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.getMatchFor(ctx, c.req.param('id'), s.userId));
  });

  app.post('/matches/:id/checkin', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.checkIn(ctx, s.userId, c.req.param('id')));
  });

  app.post('/matches/:id/start', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.startMatch(ctx, s.userId, c.req.param('id')));
  });

  app.post('/matches/:id/moves', requireAuth(), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.makeMove(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/matches/:id/draw', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.offerDraw(ctx, s.userId, c.req.param('id')));
  });

  app.post('/matches/:id/draw/respond', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.respondDraw(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/matches/:id/resign', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.resign(ctx, s.userId, c.req.param('id')));
  });

  app.post('/matches/:id/result', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.proposeResult(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/matches/:id/confirm', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.confirmResult(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/matches/:id/dispute', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.disputeResult(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/matches/:id/resolve', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    const b = c.get('parsedBody') || {};
    return ok(c, await svc.finalizeMatch(ctx, s.userId, c.req.param('id'), { result: b.result, reason: b.reason || 'Organizer resolution' }));
  });

  app.post('/matches/:id/finalize', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.finalizeMatch(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/matches/:id/pause', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.pauseMatch(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/matches/:id/resume', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.resumeMatch(ctx, s.userId, c.req.param('id')));
  });

  app.post('/matches/:id/spectators', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.setSpectatorPolicy(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.get('/matches/:id/spectate', requireAuth(), requirePermission('arena.spectate'), async (c) => ok(c, await svc.spectate(ctx, c.req.param('id'))));

  app.get('/matches/:id/events', requireAuth(), requirePermission(...MANAGE), async (c) => ok(c, await svc.listEvents(ctx, c.req.param('id'))));

  app.get('/matches/:id/disputes', requireAuth(), requirePermission(...MANAGE), async (c) => ok(c, await svc.listDisputes(ctx, c.req.param('id'))));

  app.get('/tournaments/:tid/standings', requireAuth(), async (c) => ok(c, await svc.standingsFor(ctx, c.req.param('tid'))));
}
