import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/** Mounted at /api/v1/notices — public board read is intentionally unauthenticated. */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/', async (c) => {
    const r = await svc.listNotices(ctx, c.get('session'), {
      category: c.req.query('category') || undefined,
      priority: c.req.query('priority') || undefined,
      includeExpired: c.req.query('includeExpired') === 'true',
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
    });
    return ok(c, page(r.items, r.total, r.limit, r.offset));
  });

  app.post('/', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createNotice(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.get('/:id', async (c) => ok(c, await svc.getNotice(ctx, c.req.param('id'), c.get('session'))));

  app.get('/:id/versions', requireAuth(), requirePermission('notice.publish'), async (c) =>
    ok(c, await svc.listVersions(ctx, c.req.param('id'))),
  );

  app.post('/:id/submit', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.submitForApproval(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/approve', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveNotice(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/publish', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.publishNotice(ctx, s.userId, c.req.param('id'), { publishAt: b.publishAt }));
  });

  app.post('/:id/unpublish', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.unpublishNotice(ctx, s.userId, c.req.param('id'), b.reason));
  });

  app.post('/:id/pin', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.pinNotice(ctx, s.userId, c.req.param('id'), true));
  });

  app.post('/:id/unpin', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.pinNotice(ctx, s.userId, c.req.param('id'), false));
  });

  app.post('/:id/expire', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.expireNotice(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/archive', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.archiveNotice(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/correct', requireAuth(), requirePermission('notice.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.correctNotice(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
  });
}
