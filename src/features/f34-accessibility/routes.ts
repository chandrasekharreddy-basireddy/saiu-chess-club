import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // Public catalogue of supported accessibility modes.
  app.get('/options', async (c) => ok(c, svc.options()));

  app.get('/preferences', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getPreferences(ctx, s.userId));
  });

  app.put('/preferences', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.updatePreferences(ctx, s.userId, (c.get('parsedBody') as any) ?? {}));
  });

  // Reading another account's settings is an accessibility-team action.
  app.get('/preferences/:userId', requireAuth(), requirePermission('accessibility.manage'), async (c) =>
    ok(c, await svc.getPreferences(ctx, c.req.param('userId'))),
  );

  app.post('/issues', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.reportIssue(ctx, s.userId, (c.get('parsedBody') as any) ?? {}));
  });

  app.get('/issues', requireAuth(), requirePermission('accessibility.manage'), async (c) =>
    ok(c, await svc.listIssues(ctx, { status: c.req.query('status'), severity: c.req.query('severity') })),
  );

  app.post('/issues/:id/resolve', requireAuth(), requirePermission('accessibility.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.resolveIssue(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });
}
