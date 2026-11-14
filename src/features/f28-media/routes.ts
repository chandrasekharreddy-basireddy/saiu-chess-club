import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

const MANAGE = 'media.manage';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // ---- public gallery (published items only) ----
  app.get('/items', async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 100);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
    const items = await svc.publicItems(ctx, {
      tag: c.req.query('tag'),
      year: c.req.query('year'),
      albumId: c.req.query('albumId'),
      q: c.req.query('q'),
    });
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.get('/archive/years', async (c) => ok(c, await svc.archiveYears(ctx)));

  app.get('/items/:id', async (c) => ok(c, await svc.publicItem(ctx, c.req.param('id'))));

  // ---- takedown / report workflow (open to authenticated users) ----
  app.post('/items/:id/report', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.requestTakedown(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
  });

  // ---- download gate ----
  app.get('/items/:id/download', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.downloadItem(ctx, s, c.req.param('id')));
  });

  // ---- upload + moderation ----
  app.post('/items', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createItem(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/admin/items/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getItem(ctx, s, c.req.param('id')));
  });

  app.get('/admin/queue', requireAuth(), requirePermission(MANAGE), async (c) =>
    ok(c, await svc.moderationQueue(ctx)));

  app.post('/items/:id/consent', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.recordConsent(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
  });

  app.post('/items/:id/approve', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveItem(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any)?.note));
  });

  app.post('/items/:id/reject', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.rejectItem(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any)?.reason));
  });

  app.post('/items/:id/publish', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.publishItem(ctx, s.userId, c.req.param('id')));
  });

  app.post('/items/:id/takedown', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.takedownItem(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any)?.reason));
  });

  app.post('/takedown-requests/:requestId/resolve', requireAuth(), requirePermission(MANAGE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.resolveTakedown(ctx, s.userId, c.req.param('requestId'), (c.get('parsedBody') as any)?.outcome));
  });
}
