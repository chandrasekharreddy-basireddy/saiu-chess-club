import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/snapshot', requireAuth(), requirePermission('command.view'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.buildSnapshot(ctx, s.userId, s));
  });

  // Role-aware widget list: every authenticated user sees only their own widgets,
  // and every widget links to the specialist module that owns the underlying work.
  app.get('/widgets', requireAuth(), async (c) => {
    const s = c.get('session');
    return ok(c, {
      roles: s.roles || [],
      widgets: svc.widgetsForRoles(s.roles || []),
      generatedAt: ctx.now(),
    });
  });
}
