import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/current', requireAuth(), requirePermission('reporting.read', 'command.view'), async (c) => {
    return ok(c, await svc.getCurrentYear(ctx));
  });

  app.get('/years', requireAuth(), requirePermission('reporting.read', 'command.view'), async (c) => {
    const limit = Math.min(Number(c.req.query('limit') || 50) || 50, 200);
    const offset = Number(c.req.query('offset') || 0) || 0;
    const items = await svc.listYears(ctx, { status: c.req.query('status') });
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.post('/years', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.createYear(ctx, s.userId, c.get('parsedBody')));
  });

  app.get('/years/:id', requireAuth(), requirePermission('reporting.read', 'command.view'), async (c) => {
    return ok(c, await svc.getYear(ctx, c.req.param('id')));
  });

  app.get('/years/:id/timeline', requireAuth(), requirePermission('reporting.read', 'command.view'), async (c) => {
    return ok(c, await svc.getTimeline(ctx, c.req.param('id')));
  });

  app.post('/years/:id/activate', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.activateYear(ctx, s.userId, c.req.param('id')));
  });

  app.post('/years/:id/revise', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.reviseYear(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/years/:id/events', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.addEvent(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });
}
