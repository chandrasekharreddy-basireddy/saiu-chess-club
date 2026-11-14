import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/offerings', async (c) => ok(c, await svc.listOfferings(ctx)));

  app.post('/offerings', requireAuth(), requirePermission('coaching.assignment.manage', 'tournament.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createOffering(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/assignments', requireAuth(), requirePermission('coaching.assignment.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.assignStudent(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/coach/:coachId/students', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.listStudents(ctx, s, c.req.param('coachId')));
  });

  app.get('/sessions', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.listMySessions(ctx, s));
  });

  app.post('/sessions', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.requestSession(ctx, s, c.get('parsedBody') as any));
  });

  app.get('/sessions/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getSession(ctx, s, c.req.param('id')));
  });

  app.post('/sessions/:id/confirm', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.confirmSession(ctx, s, c.req.param('id')));
  });

  app.post('/sessions/:id/notes', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addSessionNotes(ctx, s, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/sessions/:id/complete', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.completeSession(ctx, s, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/plans', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createPlan(ctx, s, c.get('parsedBody') as any));
  });

  app.get('/plans/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getPlan(ctx, s, c.req.param('id')));
  });
}
