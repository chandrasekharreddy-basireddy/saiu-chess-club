import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/objectives', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const status = c.req.query('status');
    return ok(c, await svc.listObjectives(ctx, { status }));
  });

  app.post('/objectives', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.createObjective(ctx, s.userId, c.get('parsedBody')));
  });

  app.get('/objectives/:id', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    return ok(c, await svc.getObjective(ctx, c.req.param('id')));
  });

  app.post('/objectives/:id/key-results', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.addKeyResult(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.patch('/key-results/:id', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.updateKeyResult(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/objectives/:id/milestones', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.addMilestone(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/objectives/:id/risks', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.addRisk(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/objectives/:id/reviews', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.addReview(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/objectives/:id/public-summary', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.submitPublicSummary(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/objectives/:id/public-summary/approve', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.approvePublicSummary(ctx, s.userId, c.req.param('id')));
  });

  app.post('/objectives/:id/archive', requireAuth(), requirePermission('strategy.manage'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.archiveObjective(ctx, s.userId, c.req.param('id')));
  });
}
