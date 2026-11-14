import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { hasPermission } from '../../core/permissions.js';
import * as svc from './service.js';

/** Feature 23 — Facility, Venue & Infrastructure Management, mounted at /api/v1/facilities */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  const approver = (c: any) => hasPermission(c.get('session') as any, 'facility.booking.approve');

  app.get('/venues', async (c) => {
    const items = await svc.listVenues(ctx, { status: c.req.query('status') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.post('/venues', requireAuth(), requirePermission('facility.booking.approve'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createVenue(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/venues/:id', async (c) => ok(c, await svc.getVenue(ctx, c.req.param('id'))));

  app.get('/venues/:id/utilization', requireAuth(), requirePermission('facility.booking.approve', 'reporting.read'), async (c) =>
    ok(c, await svc.utilization(ctx, c.req.param('id'))),
  );

  app.post('/venues/:id/status', requireAuth(), requirePermission('facility.booking.approve'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.setVenueStatus(ctx, s.userId, c.req.param('id'), b.status));
  });

  app.post('/venues/:id/maintenance', requireAuth(), requirePermission('facility.booking.approve'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.scheduleMaintenance(ctx, s.userId, c.req.param('id'), b));
  });

  app.post('/venues/:id/bookings', requireAuth(), requirePermission('facility.booking'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.requestBooking(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.get('/bookings', requireAuth(), async (c) => {
    const items = await svc.listBookings(ctx, { venueId: c.req.query('venueId'), status: c.req.query('status') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.post('/bookings/:id/approve', requireAuth(), requirePermission('facility.booking.approve'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveBooking(ctx, s.userId, c.req.param('id')));
  });

  app.post('/bookings/:id/reject', requireAuth(), requirePermission('facility.booking.approve'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.rejectBooking(ctx, s.userId, c.req.param('id'), b.reason));
  });

  app.post('/bookings/:id/cancel', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.cancelBooking(ctx, s.userId, c.req.param('id'), b.reason, approver(c)));
  });
}
