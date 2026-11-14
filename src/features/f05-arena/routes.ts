import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page, requireSession } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

const STAFF = ['community.moderate', 'match.result.manage', 'tournament.manage'];

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/lobby', requireAuth(), async (c) => {
    const items = await svc.lobby(ctx, { mode: c.req.query('mode'), category: c.req.query('category') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items, items.length, limit, offset));
  });

  app.post('/games', requireAuth(), requirePermission('arena.play'), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.createGame(ctx, s.userId, c.get('parsedBody')));
  });

  app.get('/games/:id', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.getGame(ctx, c.req.param('id'), s.userId));
  });

  app.post('/games/:id/join', requireAuth(), requirePermission('arena.play'), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.joinGame(ctx, s.userId, c.req.param('id')));
  });

  app.post('/games/:id/invitations', requireAuth(), requirePermission('arena.play'), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.inviteToGame(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/invitations/:iid/accept', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.respondInvitation(ctx, s.userId, c.req.param('iid'), { accept: true }));
  });

  app.post('/invitations/:iid/decline', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.respondInvitation(ctx, s.userId, c.req.param('iid'), { accept: false }));
  });

  app.post('/games/:id/start', requireAuth(), requirePermission('arena.play'), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.startGame(ctx, s.userId, c.req.param('id')));
  });

  app.post('/games/:id/finalize', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.finalizeGame(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/games/:id/disconnect', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.recordDisconnect(ctx, s.userId, c.req.param('id')));
  });

  app.post('/games/:id/reconnect', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.recordReconnect(ctx, s.userId, c.req.param('id')));
  });

  app.get('/games/:id/pgn', requireAuth(), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.getPgn(ctx, c.req.param('id'), s.userId));
  });

  app.get('/history', requireAuth(), async (c) => {
    const s = requireSession(c);
    const limit = Number(c.req.query('limit') ?? 20);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, await svc.history(ctx, s.userId, limit, offset));
  });

  app.post('/official', requireAuth(), requirePermission('tournament.manage', 'match.result.manage'), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.importOfficialGame(ctx, s.userId, c.get('parsedBody')));
  });

  app.post('/games/:id/reports', requireAuth(), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.submitReport(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.get('/reports', requireAuth(), requirePermission(...STAFF), async (c) => {
    const items = await svc.listReports(ctx, { status: c.req.query('status'), gameId: c.req.query('gameId') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items, items.length, limit, offset));
  });

  app.post('/reports/:rid/review', requireAuth(), requirePermission(...STAFF), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.reviewReport(ctx, s.userId, c.req.param('rid'), c.get('parsedBody')));
  });
}
