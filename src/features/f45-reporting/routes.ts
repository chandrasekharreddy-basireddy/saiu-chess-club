import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/**
 * Mounted at /api/v1/reporting. Row-level and aggregate access is governed by
 * permissions: `reporting.read` for institutional reports, `finance.read` for the
 * restricted finance domain. Exports are permission-checked and audited.
 */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/catalogue', requireAuth(), requirePermission('reporting.read'), async (c) =>
    ok(c, svc.catalogue()),
  );

  app.get('/summary', requireAuth(), requirePermission('reporting.read'), async (c) =>
    ok(c, await svc.buildSummary(ctx)),
  );

  app.get('/reports/tournaments', requireAuth(), requirePermission('reporting.read'), async (c) =>
    ok(c, await svc.tournamentReport(ctx)),
  );

  app.get('/reports/finance', requireAuth(), requirePermission('finance.read'), async (c) =>
    ok(c, await svc.financeReport(ctx)),
  );

  app.get('/exports', requireAuth(), requirePermission('reporting.read'), async (c) =>
    ok(c, await svc.listExports(ctx, { reportKey: c.req.query('reportKey') })),
  );

  app.post('/exports', requireAuth(), requirePermission('reporting.read'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.createExport(ctx, s.userId, (c.get('parsedBody') as any) || {}, s.permissions || []));
  });
}
