import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/** Mounted at /api/v1/events */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/', async (c) => {
    const r = await svc.listEvents(ctx, {
      status: c.req.query('status') || undefined,
      category: c.req.query('category') || undefined,
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
    });
    return ok(c, page(r.items, r.total, r.limit, r.offset));
  });

  app.get('/mine', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.myRegistrations(ctx, s.userId));
  });

  app.post('/', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createEvent(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.get('/:id', async (c) => ok(c, await svc.getEvent(ctx, c.req.param('id'))));

  app.post('/:id/publish', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.publishEvent(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/cancel', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.cancelEvent(ctx, s.userId, c.req.param('id'), b.reason));
  });

  app.post('/:id/close', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.closeEvent(ctx, s.userId, c.req.param('id'), b.report));
  });

  app.post('/:id/invitations', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.inviteToEvent(ctx, s.userId, c.req.param('id'), b.userId));
  });

  app.post('/:id/register', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.registerForEvent(ctx, s.userId, c.req.param('id'), { playerId: b.userId }));
  });

  app.post('/:id/registrations', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.registerForEvent(ctx, s.userId, c.req.param('id'), { playerId: b.userId, manual: true }));
  });

  app.post('/:id/withdraw', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.withdrawFromEvent(ctx, s.userId, c.req.param('id'), b.userId || s.userId, b.reason));
  });

  app.post('/:id/waitlist/promote', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.promoteWaitlist(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/registrations/:regId/approve', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.decideRegistration(ctx, s.userId, c.req.param('id'), c.req.param('regId'), 'approve'));
  });

  app.post('/:id/registrations/:regId/reject', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.decideRegistration(ctx, s.userId, c.req.param('id'), c.req.param('regId'), 'reject'));
  });

  app.post('/:id/registrations/:regId/checkin', requireAuth(), requirePermission('event.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.checkIn(ctx, s.userId, c.req.param('id'), c.req.param('regId')));
  });
}
