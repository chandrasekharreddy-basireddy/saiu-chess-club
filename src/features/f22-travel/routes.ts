import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { hasPermission } from '../../core/permissions.js';
import * as svc from './service.js';

/** Feature 22 — Transport & Travel Management, mounted at /api/v1/travel */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  const official = (c: any) => hasPermission(c.get('session') as any, 'travel.manage');

  app.get('/', requireAuth(), async (c) => {
    const items = await svc.listTrips(ctx, { status: c.req.query('status') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.post('/', requireAuth(), requirePermission('travel.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createTrip(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getTrip(ctx, c.req.param('id'), s.userId, official(c)));
  });

  app.get('/:id/manifest', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.manifest(ctx, c.req.param('id'), s.userId, official(c)));
  });

  app.post('/:id/submit', requireAuth(), requirePermission('travel.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.submitTrip(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/approve', requireAuth(), requirePermission('travel.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.decideTrip(ctx, s.userId, c.req.param('id'), 'approve'));
  });

  app.post('/:id/reject', requireAuth(), requirePermission('travel.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.decideTrip(ctx, s.userId, c.req.param('id'), 'reject', b.reason));
  });

  app.post('/:id/passengers', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    // travellers may add themselves; adding somebody else requires the travel official role
    if (b.userId && b.userId !== s.userId && !official(c)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Requires permission: travel.manage' } }, 403);
    }
    return created(c, await svc.addPassenger(ctx, s.userId, c.req.param('id'), b));
  });

  app.post('/:id/passengers/:pid/confirm', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.confirmPassenger(ctx, s.userId, c.req.param('id'), c.req.param('pid'), official(c)));
  });

  app.post('/:id/passengers/:pid/decline', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.setPassengerStatus(ctx, s.userId, c.req.param('id'), c.req.param('pid'), 'declined', b.reason, official(c)));
  });

  app.post('/:id/passengers/:pid/cancel', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.setPassengerStatus(ctx, s.userId, c.req.param('id'), c.req.param('pid'), 'cancelled', b.reason, official(c)));
  });

  app.post('/:id/notices', requireAuth(), requirePermission('travel.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.addNotice(ctx, s.userId, c.req.param('id'), b));
  });

  app.get('/:id/notices', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.listNotices(ctx, c.req.param('id'), s.userId, official(c)));
  });

  app.post('/:id/complete', requireAuth(), requirePermission('travel.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.completeTrip(ctx, s.userId, c.req.param('id'), b));
  });
}
