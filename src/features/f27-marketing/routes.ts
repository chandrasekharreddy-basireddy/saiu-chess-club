import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

const MANAGE = 'marketing.manage';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/campaigns', requireAuth(), requirePermission(MANAGE), async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 100);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
    const items = await svc.listCampaigns(ctx, { status: c.req.query('status'), channel: c.req.query('channel') });
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  // calendar must be declared before the /campaigns/:id style routes
  app.get('/calendar', requireAuth(), requirePermission(MANAGE), async (c) =>
    ok(c, await svc.calendar(ctx, c.req.query('from'), c.req.query('to'))));

  app.get('/campaigns/:id', requireAuth(), requirePermission(MANAGE), async (c) =>
    ok(c, await svc.getCampaign(ctx, c.req.param('id'))));

  app.post('/campaigns', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createCampaign(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.patch('/campaigns/:id', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.updateCampaign(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/campaigns/:id/submit', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.submitCampaign(ctx, s.userId, c.req.param('id')));
  });

  app.post('/campaigns/:id/approve', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveCampaign(ctx, s.userId, c.req.param('id')));
  });

  app.post('/campaigns/:id/reject', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.rejectCampaign(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any)?.reason));
  });

  app.post('/campaigns/:id/publish', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.publishCampaign(ctx, s.userId, c.req.param('id'), { externalUrl: b.externalUrl }));
  });

  app.post('/campaigns/:id/archive', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.archiveCampaign(ctx, s.userId, c.req.param('id')));
  });

  app.post('/campaigns/:id/metrics', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.recordMetrics(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
  });
}
