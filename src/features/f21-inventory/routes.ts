import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { hasPermission } from '../../core/permissions.js';
import * as svc from './service.js';

/** Feature 21 — Equipment & Inventory Management, mounted at /api/v1/inventory */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    const res = await svc.listAssets(
      ctx,
      { status: c.req.query('status'), category: c.req.query('category') },
      { limit, offset },
    );
    const canSeeValue = hasPermission(s, 'inventory.manage') || hasPermission(s, 'finance.read');
    const items = res.rows.map((a: any) => ({ ...a, replacementValue: canSeeValue ? a.replacementValue : null }));
    return ok(c, page(items, res.total, res.limit, res.offset));
  });

  app.get('/loans/overdue', requireAuth(), requirePermission('inventory.manage', 'finance.read'), async (c) => {
    return ok(c, await svc.listOverdueLoans(ctx));
  });

  app.get('/loans/mine', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.listMyLoans(ctx, s.userId));
  });

  app.get('/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const canSeeValue = hasPermission(s, 'inventory.manage') || hasPermission(s, 'finance.read');
    return ok(c, await svc.getAsset(ctx, c.req.param('id'), { canSeeValue }));
  });

  app.post('/', requireAuth(), requirePermission('inventory.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createAsset(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/:id/checkout', requireAuth(), requirePermission('inventory.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.checkout(ctx, s.userId, c.req.param('id'), b));
  });

  app.post('/:id/checkin', requireAuth(), requirePermission('inventory.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.checkin(ctx, s.userId, c.req.param('id'), b));
  });

  app.post('/:id/write-off', requireAuth(), requirePermission('inventory.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.writeOff(ctx, s.userId, c.req.param('id'), b));
  });

  app.post('/:id/disposal/request', requireAuth(), requirePermission('inventory.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.requestDisposal(ctx, s.userId, c.req.param('id'), b));
  });

  app.post('/:id/disposal/approve', requireAuth(), requirePermission('inventory.manage', 'finance.expense.approve'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveDisposal(ctx, s.userId, c.req.param('id')));
  });
}
