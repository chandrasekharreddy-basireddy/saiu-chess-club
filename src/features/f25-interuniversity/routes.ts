import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/** Feature 25 — Inter-University Competition & Federation Management, mounted at /api/v1/interuniversity */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/federations', requireAuth(), requirePermission('interuniversity.manage'), async (c) =>
    ok(c, await svc.listFederations(ctx)),
  );

  app.post('/federations', requireAuth(), requirePermission('interuniversity.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createFederation(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/federations/:id/verify', requireAuth(), requirePermission('interuniversity.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.verifyFederation(ctx, s.userId, c.req.param('id')));
  });

  app.get('/competitions', async (c) => {
    const items = await svc.listCompetitions(ctx, { status: c.req.query('status') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.post('/competitions', requireAuth(), requirePermission('interuniversity.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createCompetition(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/competitions/:id', async (c) => ok(c, await svc.getCompetition(ctx, c.req.param('id'))));

  // selection criteria are transparent to eligible participants (public read)
  app.get('/competitions/:id/criteria', async (c) => ok(c, await svc.selectionCriteria(ctx, c.req.param('id'))));

  app.get('/competitions/:id/affiliation', async (c) => ok(c, await svc.affiliation(ctx, c.req.param('id'))));

  app.get('/competitions/:id/documents', requireAuth(), requirePermission('interuniversity.manage'), async (c) =>
    ok(c, await svc.listDocuments(ctx, c.req.param('id'))),
  );

  app.post('/competitions/:id/documents', requireAuth(), requirePermission('interuniversity.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addDocument(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/competitions/:id/fixtures', requireAuth(), requirePermission('interuniversity.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createFixture(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/competitions/:id/team', requireAuth(), requirePermission('interuniversity.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.proposeTeam(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.get('/fixtures/:id', async (c) => ok(c, await svc.getFixture(ctx, c.req.param('id'))));

  app.post('/fixtures/:id/result', requireAuth(), requirePermission('interuniversity.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.proposeResult(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/fixtures/:id/result/confirm', requireAuth(), requirePermission('interuniversity.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.confirmResult(ctx, s.userId, c.req.param('id')));
  });

  app.post('/teams/:id/approve', requireAuth(), requirePermission('interuniversity.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveTeam(ctx, s.userId, c.req.param('id')));
  });
}
