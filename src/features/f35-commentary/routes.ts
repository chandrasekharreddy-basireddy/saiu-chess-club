import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // Spectator feed: the service applies the configured server-side delay.
  app.get('/matches/:matchId/entries', async (c) =>
    ok(c, await svc.listEntries(ctx, c.get('session') as any, c.req.param('matchId'))),
  );

  app.get('/matches/:matchId/archive', async (c) => ok(c, await svc.archive(ctx, c.req.param('matchId'))));

  // Authorization is decided in the service: permission holder OR match assignment.
  app.post('/matches/:matchId/entries', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.postEntry(ctx, s, c.req.param('matchId'), (c.get('parsedBody') as any) ?? {}));
  });

  app.post(
    '/matches/:matchId/commentators',
    requireAuth(),
    requirePermission('commentary.publish', 'tournament.manage'),
    async (c) => {
      const s = c.get('session') as any;
      return created(c, await svc.assignCommentator(ctx, s.userId, c.req.param('matchId'), (c.get('parsedBody') as any) ?? {}));
    },
  );

  app.put('/matches/:matchId/settings', requireAuth(), requirePermission('commentary.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.setSettings(ctx, s.userId, c.req.param('matchId'), (c.get('parsedBody') as any) ?? {}));
  });

  app.patch('/entries/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.editEntry(ctx, s, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });

  app.get('/entries/:id/history', requireAuth(), requirePermission('commentary.publish', 'community.moderate'), async (c) =>
    ok(c, await svc.getEditHistory(ctx, c.req.param('id'))),
  );

  app.delete('/entries/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.deleteEntry(ctx, s, c.req.param('id')));
  });
}
