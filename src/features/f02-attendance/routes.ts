import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page, requireSession } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/** Organizer-level authority for attendance decisions (organizer/president/admin hold these). */
const MANAGE = ['tournament.registration.manage', 'match.result.manage', 'tournament.manage'];

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.post('/matches', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.createMatch(ctx, s.userId, c.get('parsedBody')));
  });

  app.get('/matches/:id', requireAuth(), async (c) => {
    const s = requireSession(c);
    const id = c.req.param('id');
    const isStaff = ['tournament.registration.manage', 'match.result.manage', 'tournament.manage'].some((p) => s.permissions?.includes(p) || s.permissions?.includes('*'));
    if (isStaff) return ok(c, await svc.board(ctx, id));
    return ok(c, await svc.playerView(ctx, id, s.userId));
  });

  app.get('/matches/:id/board', requireAuth(), requirePermission(...MANAGE), async (c) => ok(c, await svc.board(ctx, c.req.param('id'))));

  app.post('/matches/:id/checkin', requireAuth(), async (c) => {
    const s = requireSession(c);
    const b = c.get('parsedBody') || {};
    const staff = (s.permissions || []).some((p: string) => MANAGE.includes(p) || p === '*');
    const source: 'self' | 'organizer' = b.source === 'organizer' && staff ? 'organizer' : 'self';
    const playerId = source === 'organizer' ? b.playerId || s.userId : s.userId;
    return created(c, await svc.checkIn(ctx, s.userId, c.req.param('id'), { playerId, source }));
  });

  app.post('/matches/:id/attendance', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    const b = c.get('parsedBody') || {};
    return ok(c, await svc.setAttendance(ctx, s.userId, c.req.param('id'), b.playerId, b.status, b.reason));
  });

  app.post('/matches/:id/explanations', requireAuth(), async (c) => {
    const s = requireSession(c);
    return created(c, await svc.submitExplanation(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.get('/matches/:id/explanations', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const items = await svc.listExplanations(ctx, c.req.param('id'), { status: c.req.query('status') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items, items.length, limit, offset));
  });

  app.post('/matches/:id/explanations/:eid/review', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.reviewExplanation(ctx, s.userId, c.req.param('id'), c.req.param('eid'), c.get('parsedBody')));
  });

  app.post('/matches/:id/walkover', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.awardWalkover(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/matches/:id/alerts/evaluate', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.evaluateMissing(ctx, s.userId, c.req.param('id')));
  });

  app.get('/alerts', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const items = await svc.listAlerts(ctx, { matchId: c.req.query('matchId'), status: c.req.query('status') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items, items.length, limit, offset));
  });

  app.post('/matches/:id/emergency', requireAuth(), requirePermission('tournament.manage', 'match.result.manage'), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.emergencyOverride(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/matches/:id/reopen', requireAuth(), requirePermission(...MANAGE), async (c) => {
    const s = requireSession(c);
    return ok(c, await svc.reopenAttendance(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.get('/matches/:id/result-gate', requireAuth(), async (c) => ok(c, await svc.resultGate(ctx, c.req.param('id'))));

  app.get('/matches/:id/history', requireAuth(), requirePermission(...MANAGE), async (c) => ok(c, await svc.history(ctx, c.req.param('id'))));
}
