import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/**
 * Mounted at /api/v1/finance.
 * Every route is permission-gated: `finance.read` for finance officials, `finance.expense.approve`
 * for approvers. Ordinary members hold neither and see nothing here.
 */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/balance', requireAuth(), requirePermission('finance.read'), async (c) => ok(c, await svc.ledgerSummary(ctx)));

  app.get('/ledger', requireAuth(), requirePermission('finance.read'), async (c) =>
    ok(c, await svc.listLedger(ctx, { kind: c.req.query('kind') || undefined, account: c.req.query('account') || undefined })),
  );

  /* ---- budgets ---- */

  app.get('/budgets', requireAuth(), requirePermission('finance.read'), async (c) =>
    ok(c, await svc.listBudgets(ctx, { status: c.req.query('status') || undefined })),
  );

  app.post('/budgets', requireAuth(), requirePermission('finance.read'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createBudget(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post('/budgets/:id/approve', requireAuth(), requirePermission('finance.expense.approve'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveBudget(ctx, s.userId, c.req.param('id')));
  });

  /* ---- contributions (income) ---- */

  app.get('/contributions', requireAuth(), requirePermission('finance.read'), async (c) =>
    ok(c, await svc.listContributions(ctx, { status: c.req.query('status') || undefined })),
  );

  app.post('/contributions', requireAuth(), requirePermission('finance.read'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.recordContribution(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post('/contributions/:id/approve', requireAuth(), requirePermission('finance.expense.approve'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveContribution(ctx, s.userId, c.req.param('id')));
  });

  /* ---- expenses ---- */

  app.get('/expenses', requireAuth(), requirePermission('finance.read'), async (c) =>
    ok(c, await svc.listExpenses(ctx, { status: c.req.query('status') || undefined, category: c.req.query('category') || undefined })),
  );

  app.post('/expenses', requireAuth(), requirePermission('finance.read'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.requestExpense(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.get('/expenses/:id', requireAuth(), requirePermission('finance.read'), async (c) => ok(c, await svc.getExpense(ctx, c.req.param('id'))));

  app.post('/expenses/:id/receipt', requireAuth(), requirePermission('finance.read'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.attachReceipt(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
  });

  app.post('/expenses/:id/approve', requireAuth(), requirePermission('finance.expense.approve'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveExpense(ctx, s.userId, c.req.param('id')));
  });

  app.post('/expenses/:id/reject', requireAuth(), requirePermission('finance.expense.approve'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.rejectExpense(ctx, s.userId, c.req.param('id'), b.reason));
  });

  /* ---- reporting ---- */

  app.get('/reports/summary', requireAuth(), requirePermission('finance.read'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.financialReport(ctx, s.userId, { from: c.req.query('from') || undefined, to: c.req.query('to') || undefined }));
  });

  app.get('/periods', requireAuth(), requirePermission('finance.read'), async (c) => ok(c, await svc.listPeriods(ctx)));

  app.post('/periods/close', requireAuth(), requirePermission('finance.expense.approve'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.closePeriod(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });
}
