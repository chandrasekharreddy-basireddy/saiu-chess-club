import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ------------------------------------------------------- configuration */

  app.get('/categories', requireAuth(), async (c) => ok(c, await svc.listCategories(ctx)));

  app.post('/categories', requireAuth(), requirePermission('membership.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createCategory(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/allowlist', requireAuth(), requirePermission('membership.manage', 'membership.approve'), async (c) =>
    ok(c, await svc.listAllowlist(ctx)),
  );

  app.post('/allowlist', requireAuth(), requirePermission('membership.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addAllowlistDomain(ctx, s.userId, c.get('parsedBody') as any));
  });

  /* -------------------------------------------------------- applications */

  app.post('/applications', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.applyForMembership(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/applications/mine', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.listMyApplications(ctx, s.userId));
  });

  app.get('/applications', requireAuth(), requirePermission('membership.approve', 'membership.manage'), async (c) => {
    const r = await svc.listApplications(ctx, {
      status: c.req.query('status') || undefined,
      limit: Number(c.req.query('limit')) || undefined,
      offset: Number(c.req.query('offset')) || undefined,
    });
    return ok(c, page(r.items, r.total, r.limit, r.offset));
  });

  app.post('/applications/:id/decide', requireAuth(), requirePermission('membership.approve', 'membership.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.decideApplication(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/applications/:id/withdraw', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.withdrawApplication(ctx, s.userId, c.req.param('id')));
  });

  app.post('/applications/:id/suspend', requireAuth(), requirePermission('membership.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.suspendMembership(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  /* ------------------------------------------------------------ my status */

  app.get('/me', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getMyMembership(ctx, s.userId));
  });
}
