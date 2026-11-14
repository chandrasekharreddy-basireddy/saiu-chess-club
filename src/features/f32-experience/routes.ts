import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // Public roadmap — approved, non-sensitive items only.
  app.get('/public/roadmap', async (c) => ok(c, await svc.publicRoadmap(ctx)));

  app.post('/', requireAuth(), requirePermission('feedback.submit'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.submitFeedback(ctx, s.userId, (c.get('parsedBody') as any) ?? {}));
  });

  app.get('/', requireAuth(), requirePermission('site.experience.manage'), async (c) => {
    const r = await svc.listFeedback(ctx, {
      type: c.req.query('type'),
      status: c.req.query('status'),
      queue: c.req.query('queue'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });
    return ok(c, page(r.items, r.total, r.limit, r.offset));
  });

  app.get('/:id', requireAuth(), async (c) =>
    ok(c, await svc.getFeedback(ctx, c.get('session') as any, c.req.param('id'))),
  );

  app.post('/:id/triage', requireAuth(), requirePermission('site.experience.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.triage(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });

  app.post('/:id/duplicate', requireAuth(), requirePermission('site.experience.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.linkDuplicate(ctx, c.get('session') as any, s.userId, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });

  app.post('/:id/vote', requireAuth(), requirePermission('feedback.submit'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.vote(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/roadmap', requireAuth(), requirePermission('site.experience.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.publishRoadmapItem(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });

  app.post('/:id/release-notes', requireAuth(), requirePermission('site.experience.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addReleaseNote(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });
}
