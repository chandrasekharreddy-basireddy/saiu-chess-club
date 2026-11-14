import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/providers', requireAuth(), async (c) => ok(c, await svc.listProviders()));

  app.get('/', requireAuth(), requirePermission('system.configuration.manage', 'ai.manage'), async (c) => {
    const enabled = c.req.query('enabled');
    return ok(c, await svc.listIntegrations(ctx, {
      enabled: enabled === undefined ? undefined : enabled === 'true',
      category: c.req.query('category') || undefined,
    }));
  });

  app.get('/status', requireAuth(), requirePermission('system.configuration.manage', 'ai.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.statusDashboard(ctx, s));
  });

  app.get('/:id', requireAuth(), requirePermission('system.configuration.manage', 'ai.manage'), async (c) => {
    return ok(c, await svc.getIntegration(ctx, c.req.param('id')));
  });

  app.get('/:id/usage', requireAuth(), requirePermission('system.configuration.manage', 'ai.manage'), async (c) => {
    return ok(c, await svc.listUsage(ctx, c.req.param('id')));
  });

  app.post('/', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.registerIntegration(ctx, s, c.get('parsedBody') as any));
  });

  app.post('/:id/terms-review', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.reviewTerms(ctx, s, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/:id/enable', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.setEnabled(ctx, s, c.req.param('id'), true));
  });

  app.post('/:id/disable', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.setEnabled(ctx, s, c.req.param('id'), false));
  });

  // Metered call path: other features call this before using a provider. Any authenticated
  // caller may record usage; the quota guard is what protects the free tier.
  app.post('/:id/usage', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.recordUsage(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/:id/health', requireAuth(), requirePermission('system.configuration.manage', 'ai.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.recordHealth(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });
}
