import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/** Mounted at /api/v1/calendar */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ---- academic years (static paths first, they must not be swallowed by ':id') ---- */

  app.get('/academic-years', async (c) => {
    const items = await svc.listAcademicYears(ctx, { status: c.req.query('status') || undefined });
    return ok(c, items);
  });

  app.get('/academic-years/current', async (c) => {
    const year = await svc.currentAcademicYear(ctx, c.req.query('at') || undefined);
    return ok(c, year);
  });

  app.post('/academic-years', requireAuth(), requirePermission('calendar.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createAcademicYear(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post('/academic-years/:id/approve', requireAuth(), requirePermission('calendar.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveAcademicYear(ctx, s.userId, c.req.param('id')));
  });

  app.post('/academic-years/:id/revise', requireAuth(), requirePermission('calendar.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.reviseAcademicYear(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
  });

  app.get('/season-membership', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const userId = c.req.query('userId') || s.userId;
    return ok(c, await svc.seasonMembership(ctx, userId, c.req.query('at') || undefined));
  });

  /* ---- calendar entries ---- */

  app.get('/entries', async (c) => {
    const s = c.get('session') as any;
    const viewerAudiences = s ? ['public', 'members', ...(s.roles || [])] : ['public'];
    const items = await svc.calendarView(ctx, viewerAudiences, {
      from: c.req.query('from') || undefined,
      to: c.req.query('to') || undefined,
      timezone: c.req.query('timezone') || undefined,
    });
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : items.length;
    const offset = c.req.query('offset') ? Number(c.req.query('offset')) : 0;
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.post('/entries', requireAuth(), requirePermission('calendar.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createEntry(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.get('/entries/:id', async (c) => ok(c, await svc.getEntry(ctx, c.req.param('id'))));

  app.post('/entries/:id/approve', requireAuth(), requirePermission('calendar.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveEntry(ctx, s.userId, c.req.param('id')));
  });

  app.post('/entries/:id/cancel', requireAuth(), requirePermission('calendar.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.cancelEntry(ctx, s.userId, c.req.param('id'), b.reason));
  });

  /* ---- conflict view ---- */

  app.get('/conflicts', requireAuth(), requirePermission('calendar.manage'), async (c) => {
    const from = c.req.query('from') || undefined;
    const to = c.req.query('to') || undefined;
    const items = await svc.listEntries(ctx, { from, to, includeDrafts: true });
    const clashes: Array<{ a: any; b: any; kind: string }> = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!svc.overlaps(a.startsAt, a.endsAt, b.startsAt, b.endsAt)) continue;
        if (a.venueId && a.venueId === b.venueId) clashes.push({ a: { id: a.id, title: a.title }, b: { id: b.id, title: b.title }, kind: 'venue' });
        else if (a.hostId && a.hostId === b.hostId) clashes.push({ a: { id: a.id, title: a.title }, b: { id: b.id, title: b.title }, kind: 'person' });
      }
    }
    return ok(c, clashes);
  });
}
