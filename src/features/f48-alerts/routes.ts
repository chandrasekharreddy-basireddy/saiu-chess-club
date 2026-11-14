import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { hasPermission } from '../../core/permissions.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  const canSeeSensitive = (c: any) => hasPermission(c.get('session'), 'security.operations.manage');

  app.get('/', requireAuth(), requirePermission('alert.broadcast'), async (c) => {
    const items = await svc.listAlerts(
      ctx,
      { severity: c.req.query('severity'), status: c.req.query('status'), category: c.req.query('category') },
      canSeeSensitive(c),
    );
    return ok(c, items);
  });

  app.post('/', requireAuth(), requirePermission('alert.broadcast'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.createAlert(ctx, s.userId, c.get('parsedBody')));
  });

  app.get('/config/thresholds', requireAuth(), requirePermission('alert.broadcast'), async (c) => {
    const thresholds = await svc.getThresholds(ctx);
    return ok(c, { thresholds, source: svc.CONFIG, generatedAt: ctx.now() });
  });

  app.put('/config/thresholds', requireAuth(), requirePermission('alert.broadcast'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.configureThresholds(ctx, s.userId, c.get('parsedBody')));
  });

  app.post('/escalate', requireAuth(), requirePermission('alert.broadcast'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.escalateOverdue(ctx, s.userId));
  });

  app.get('/:id', requireAuth(), requirePermission('alert.broadcast'), async (c) => {
    return ok(c, await svc.getAlert(ctx, c.req.param('id'), canSeeSensitive(c)));
  });

  app.post('/:id/acknowledge', requireAuth(), requirePermission('alert.broadcast'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.acknowledgeAlert(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/resolve', requireAuth(), requirePermission('alert.broadcast'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.resolveAlert(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });
}
