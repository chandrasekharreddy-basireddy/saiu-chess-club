import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/** Mounted at /api/v1/governance */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ---- committee directory (public) ---- */

  app.get('/committee', async (c) =>
    ok(c, await svc.listCommittee(ctx, { current: c.req.query('current') === 'true', includeEnded: c.req.query('includeEnded') === 'true' })),
  );

  app.post('/committee', requireAuth(), requirePermission('governance.policy.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createTerm(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post('/committee/:id/end', requireAuth(), requirePermission('governance.policy.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.endTerm(ctx, s.userId, c.req.param('id')));
  });

  /* ---- elections ---- */

  app.get('/elections', async (c) => ok(c, await svc.listElections(ctx, { status: c.req.query('status') || undefined })));

  app.post('/elections', requireAuth(), requirePermission('governance.election.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createElection(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.get('/elections/:id', async (c) => ok(c, await svc.getElection(ctx, c.req.param('id'))));

  app.post('/elections/:id/authorize', requireAuth(), requirePermission('governance.policy.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.authorizeElection(ctx, s.userId, c.req.param('id'), b.authorizationRef));
  });

  app.post('/elections/:id/nominations', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.nominate(ctx, s.userId, c.req.param('id'), b));
  });

  app.post('/elections/:id/nominations/:candidateId/review', requireAuth(), requirePermission('governance.election.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    const decision = b.decision === 'reject' ? 'reject' : 'approve';
    return ok(c, await svc.reviewNomination(ctx, s.userId, c.req.param('id'), c.req.param('candidateId'), decision, b.notes));
  });

  app.post('/elections/:id/open', requireAuth(), requirePermission('governance.election.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.openVoting(ctx, s.userId, c.req.param('id')));
  });

  app.post('/elections/:id/vote', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.castVote(ctx, s.userId, c.req.param('id'), b.candidateId));
  });

  app.post('/elections/:id/close', requireAuth(), requirePermission('governance.election.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.closeElection(ctx, s.userId, c.req.param('id')));
  });

  app.post('/elections/:id/certify', requireAuth(), requirePermission('governance.election.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.certifyResults(ctx, s.userId, c.req.param('id'), b.notes));
  });

  app.get('/elections/:id/results', requireAuth(), async (c) => ok(c, await svc.getResults(ctx, c.req.param('id'))));

  /* ---- handover ---- */

  app.get('/elections/:id/handover', requireAuth(), async (c) => ok(c, await svc.listHandover(ctx, c.req.param('id'))));

  app.post('/elections/:id/handover', requireAuth(), requirePermission('governance.policy.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.addHandoverTasks(ctx, s.userId, c.req.param('id'), b.tasks));
  });

  app.post('/handover/:taskId/complete', requireAuth(), requirePermission('governance.election.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.completeHandoverTask(ctx, s.userId, c.req.param('taskId')));
  });
}
