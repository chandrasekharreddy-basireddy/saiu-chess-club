import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ---------------------------------------------------------------- feed */

  app.get('/posts', requireAuth(), async (c) => {
    const r = await svc.listFeed(ctx, {
      limit: Number(c.req.query('limit')) || undefined,
      offset: Number(c.req.query('offset')) || undefined,
      scope: c.req.query('scope') || undefined,
    });
    return ok(c, page(r.items, r.total, r.limit, r.offset));
  });

  app.post('/posts', requireAuth(), requirePermission('community.post'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createPost(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/posts/:id', requireAuth(), async (c) => ok(c, await svc.getPost(ctx, c.req.param('id'))));

  app.patch('/posts/:id', requireAuth(), requirePermission('community.post'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.editOwnPost(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.delete('/posts/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.deleteOwnPost(ctx, s.userId, c.req.param('id')));
  });

  app.post('/posts/:id/comments', requireAuth(), requirePermission('community.post'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addComment(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  /* ---------------------------------------------------------- moderation */

  app.post('/posts/:id/moderate', requireAuth(), requirePermission('community.moderate'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.moderatePost(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/posts/:id/report', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(
      c,
      await svc.reportContent(ctx, s.userId, { targetType: 'post', targetId: c.req.param('id'), reason: b.reason }),
    );
  });

  app.post('/reports', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.reportContent(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/reports', requireAuth(), requirePermission('community.moderate'), async (c) => {
    const r = await svc.listReports(ctx, {
      status: c.req.query('status') || undefined,
      limit: Number(c.req.query('limit')) || undefined,
      offset: Number(c.req.query('offset')) || undefined,
    });
    return ok(c, page(r.items, r.total, r.limit, r.offset));
  });

  app.post('/reports/:id/resolve', requireAuth(), requirePermission('community.moderate'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.resolveReport(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  /* -------------------------------------------------------------- blocks */

  app.post('/members/:id/block', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.blockMember(ctx, s.userId, c.req.param('id')));
  });
}
