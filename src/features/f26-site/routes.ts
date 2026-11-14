import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

const MANAGE = 'site.experience.manage';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // ---- public reads (no auth; published content only) ----
  app.get('/blocks', async (c) => ok(c, await svc.publicBlocks(ctx, c.req.query('kind'))));

  app.get('/blocks/:kind', async (c) => ok(c, await svc.publicBlockByKind(ctx, c.req.param('kind'))));

  // ---- admin reads ----
  app.get('/admin/blocks', requireAuth(), requirePermission(MANAGE), async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 100);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
    const items = await svc.adminBlocks(ctx, { status: c.req.query('status'), kind: c.req.query('kind') });
    const slice = items.slice(offset, offset + limit);
    return ok(c, page(slice, items.length, limit, offset));
  });

  app.get('/admin/blocks/:id', requireAuth(), requirePermission(MANAGE), async (c) =>
    ok(c, await svc.getBlock(ctx, c.req.param('id'))));

  // ---- authoring + workflow (admin-only writes) ----
  app.post('/blocks', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createBlock(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.patch('/blocks/:id', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.updateBlock(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/blocks/:id/submit', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.submitBlock(ctx, s.userId, c.req.param('id')));
  });

  app.post('/blocks/:id/approve', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveBlock(ctx, s.userId, c.req.param('id')));
  });

  app.post('/blocks/:id/publish', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.publishBlock(ctx, s.userId, c.req.param('id')));
  });

  app.post('/blocks/:id/archive', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.archiveBlock(ctx, s.userId, c.req.param('id')));
  });
}
