import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // Public: list published polls/surveys only.
  app.get('/', async (c) => ok(c, await svc.listPolls(ctx)));

  // Public detail (drafts are hidden from non-managers by the service).
  app.get('/:id', async (c) => ok(c, await svc.getPoll(ctx, c.get('session') as any, c.req.param('id'))));

  app.post('/', requireAuth(), requirePermission('survey.create'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createPoll(ctx, s.userId, (c.get('parsedBody') as any) ?? {}));
  });

  app.post('/:id/publish', requireAuth(), requirePermission('survey.create'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.publishPoll(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/responses', requireAuth(), requirePermission('survey.respond'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.respond(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });

  app.post('/:id/close', requireAuth(), requirePermission('survey.create'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.closePoll(ctx, s.userId, c.req.param('id')));
  });

  // Result visibility is decided inside the service (permission controlled).
  app.get('/:id/results', async (c) => ok(c, await svc.getResults(ctx, c.get('session') as any, c.req.param('id'))));

  app.get('/:id/proposals', async (c) => ok(c, await svc.listProposals(ctx, c.req.param('id'))));

  app.post('/:id/proposals', requireAuth(), requirePermission('survey.respond', 'community.post', 'survey.create'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createProposal(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });

  app.get('/:id/actions', requireAuth(), requirePermission('survey.create'), async (c) =>
    ok(c, await svc.listActions(ctx, c.req.param('id'))),
  );

  app.post('/:id/actions', requireAuth(), requirePermission('survey.create'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createAction(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) ?? {}));
  });

  app.post('/:id/actions/:actionId/complete', requireAuth(), requirePermission('survey.create'), async (c) => {
    const s = c.get('session') as any;
    return ok(
      c,
      await svc.completeAction(ctx, s.userId, c.req.param('id'), c.req.param('actionId'), (c.get('parsedBody') as any) ?? {}),
    );
  });
}
