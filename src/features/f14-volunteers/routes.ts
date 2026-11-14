import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ------------------------------------------------------ opportunities */

  app.get('/opportunities', requireAuth(), async (c) =>
    ok(c, await svc.listOpportunities(ctx, { status: c.req.query('status') || undefined })),
  );

  app.post('/opportunities', requireAuth(), requirePermission('volunteer.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createOpportunity(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/opportunities/:id', requireAuth(), async (c) => ok(c, await svc.getOpportunity(ctx, c.req.param('id'))));

  app.post('/opportunities/:id/close', requireAuth(), requirePermission('volunteer.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.closeOpportunity(ctx, s.userId, c.req.param('id')));
  });

  app.get('/opportunities/:id/roster', requireAuth(), requirePermission('volunteer.manage'), async (c) =>
    ok(c, await svc.opportunityRoster(ctx, c.req.param('id'))),
  );

  app.post('/opportunities/:id/shifts', requireAuth(), requirePermission('volunteer.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createShift(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.get('/opportunities/:id/shifts', requireAuth(), async (c) => ok(c, await svc.listShifts(ctx, c.req.param('id'))));

  /* -------------------------------------------------------------- shifts */

  app.get('/shifts/mine', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.myShifts(ctx, s.userId));
  });

  app.post('/shifts/:id/signup', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.signupForShift(ctx, s.userId, c.req.param('id')));
  });

  /* --------------------------------------------------------- assignments */

  app.post('/assignments/:id/confirm', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.confirmAssignment(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/assignments/:id/withdraw', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.withdrawAssignment(ctx, s.userId, c.req.param('id')));
  });

  app.post('/assignments/:id/checkin', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const supervisor = (s.permissions || []).some((p: string) => p === '*' || p === 'volunteer.manage');
    return ok(c, await svc.checkIn(ctx, s.userId, c.req.param('id'), { supervisor }));
  });

  app.post('/assignments/:id/complete', requireAuth(), requirePermission('volunteer.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.completeAssignment(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/assignments/:id/correct', requireAuth(), requirePermission('volunteer.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.correctAssignment(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.get('/me/history', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.participationHistory(ctx, s.userId));
  });
}
