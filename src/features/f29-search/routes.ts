import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/suggest', async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.suggest(ctx, s, c.req.query('q') as string, c.req.query('limit') as any));
  });

  app.get('/health', requireAuth(), requirePermission('audit.log.read', 'system.configuration.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.indexHealth(ctx, s));
  });

  app.get('/', async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.search(ctx, s, {
      q: c.req.query('q'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
      type: c.req.query('type'),
      sort: c.req.query('sort'),
    }));
  });
}
