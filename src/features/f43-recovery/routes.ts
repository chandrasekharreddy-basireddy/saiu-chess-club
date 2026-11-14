import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/** Mounted at /api/v1/recovery — continuity and recovery operations. */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/plans', requireAuth(), requirePermission('disaster.recovery.manage'), async (c) =>
    ok(c, await svc.listPlans(ctx, { status: c.req.query('status') })),
  );

  app.get('/plans/:id', requireAuth(), requirePermission('disaster.recovery.manage'), async (c) =>
    ok(c, await svc.getPlan(ctx, c.req.param('id'))),
  );

  app.post('/plans', requireAuth(), requirePermission('disaster.recovery.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.createPlan(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post('/plans/:id/approve', requireAuth(), requirePermission('disaster.recovery.manage'), async (c) => {
    const s = c.get('session')!;
    return ok(c, await svc.approvePlan(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
  });

  app.get('/plans/:id/drills', requireAuth(), requirePermission('disaster.recovery.manage'), async (c) =>
    ok(c, await svc.listDrills(ctx, c.req.param('id'))),
  );

  app.post('/plans/:id/drills', requireAuth(), requirePermission('disaster.recovery.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.recordDrill(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
  });

  app.get('/contacts', requireAuth(), requirePermission('command.view', 'disaster.recovery.manage'), async (c) =>
    ok(c, await svc.listContacts(ctx)),
  );

  app.post('/contacts', requireAuth(), requirePermission('disaster.recovery.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.addContact(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.get('/command', requireAuth(), requirePermission('command.view', 'disaster.recovery.manage'), async (c) =>
    ok(c, await svc.commandView(ctx)),
  );

  app.post(
    '/continuity/pause',
    requireAuth(),
    requirePermission('disaster.recovery.manage', 'tournament.manage'),
    async (c) => {
      const s = c.get('session')!;
      return created(c, await svc.pauseForContinuity(ctx, s.userId, (c.get('parsedBody') as any) || {}));
    },
  );

  app.post(
    '/continuity/:id/reconcile',
    requireAuth(),
    requirePermission('disaster.recovery.manage', 'tournament.manage'),
    async (c) => {
      const s = c.get('session')!;
      return ok(c, await svc.reconcileContinuity(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
    },
  );
}
