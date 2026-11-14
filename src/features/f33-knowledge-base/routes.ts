import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // Public: published articles the caller's audience may see.
  app.get('/', async (c) => {
    const r = await svc.listPublished(ctx, c.get('session') as any, {
      q: c.req.query('q'),
      category: c.req.query('category'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });
    return ok(c, page(r.items, r.total, r.limit, r.offset));
  });

  // Permission-aware search (registered before the slug route).
  app.get('/search', async (c) =>
    ok(c, await svc.search(ctx, c.get('session') as any, { q: c.req.query('q') })),
  );

  app.get('/reviews/due', requireAuth(), requirePermission('kb.publish'), async (c) => ok(c, await svc.reviewsDue(ctx)));

  app.post('/', requireAuth(), requirePermission('kb.publish'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createArticle(ctx, s.userId, (c.get('parsedBody') as any) ?? {}));
  });

  app.get('/:id/versions', requireAuth(), requirePermission('kb.publish'), async (c) =>
    ok(c, await svc.getVersions(ctx, c.req.param('id'))),
  );

  app.patch('/:id', requireAuth(), requirePermission('kb.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.updateArticle(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });

  app.post('/:id/publish', requireAuth(), requirePermission('kb.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.publishArticle(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/archive', requireAuth(), requirePermission('kb.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.archiveArticle(ctx, s.userId, c.req.param('id')));
  });

  // Public read by slug: published, audience-appropriate only.
  app.get('/:slug', async (c) =>
    ok(c, await svc.getArticleBySlug(ctx, c.get('session') as any, c.req.param('slug'))),
  );
}
