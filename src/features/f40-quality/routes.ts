import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ------------------------------------------------------------ budgets */
  app.get('/budgets', requireAuth(), requirePermission('qa.manage', 'reporting.read'), async (c) => {
    return ok(c, await svc.listBudgets(ctx));
  });

  app.post('/budgets', requireAuth(), requirePermission('qa.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createBudget(ctx, s.userId, c.get('parsedBody') as any));
  });

  /* ---------------------------------------------------------- test runs */
  app.get('/test-runs', requireAuth(), requirePermission('qa.manage', 'reporting.read'), async (c) => {
    return ok(c, await svc.listTestRuns(ctx));
  });

  app.get('/test-runs/:id', requireAuth(), requirePermission('qa.manage', 'reporting.read'), async (c) => {
    return ok(c, await svc.getTestRun(ctx, c.req.param('id')));
  });

  app.post('/test-runs', requireAuth(), requirePermission('qa.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.recordTestRun(ctx, s.userId, c.get('parsedBody') as any));
  });

  /* ------------------------------------------------------ release gates */
  app.get('/release-gates', requireAuth(), requirePermission('qa.manage', 'reporting.read'), async (c) => {
    return ok(c, await svc.listGates(ctx));
  });

  app.post('/release-gates', requireAuth(), requirePermission('qa.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.evaluateReleaseGate(ctx, s.userId, c.get('parsedBody') as any));
  });

  /* ------------------------------------------------------------ metrics */
  app.get('/summary', requireAuth(), requirePermission('qa.manage', 'reporting.read'), async (c) => {
    return ok(c, await svc.summary(ctx));
  });

  app.post('/metrics', requireAuth(), requirePermission('qa.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.recordMetric(ctx, s.userId, c.get('parsedBody') as any));
  });

  /* ---------------------------------------------------------- incidents */
  app.get('/incidents', requireAuth(), requirePermission('qa.manage', 'reporting.read'), async (c) => {
    return ok(c, await svc.listIncidents(ctx, { status: c.req.query('status') || undefined }));
  });

  app.post('/incidents', requireAuth(), requirePermission('qa.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.openIncident(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/incidents/:id/resolve', requireAuth(), requirePermission('qa.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.resolveIncident(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  /* -------------------------------------------------- load-test guard */
  app.post('/load-test/check', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.assertLoadTestCompliant(ctx, s, c.get('parsedBody') as any));
  });
}
