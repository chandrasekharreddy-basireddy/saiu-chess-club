import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

/** Feature 24 — Sponsorship, Partnerships & University Relations, mounted at /api/v1/sponsorships */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  // public sponsor recognition feed — approved and published records only, no contacts or terms
  app.get('/recognition', async (c) => ok(c, await svc.publicRecognition(ctx)));

  app.get('/partners', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const items = await svc.listPartners(ctx, { stage: c.req.query('stage'), type: c.req.query('type') });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.post('/partners', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createPartner(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/partners/:id', requireAuth(), requirePermission('sponsorship.manage'), async (c) =>
    ok(c, await svc.getPartner(ctx, c.req.param('id'))),
  );

  app.get('/partners/:id/finance', requireAuth(), requirePermission('sponsorship.manage', 'finance.read'), async (c) =>
    ok(c, await svc.financeSummary(ctx, c.req.param('id'))),
  );

  app.post('/partners/:id/stage', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, await svc.advanceStage(ctx, s.userId, c.req.param('id'), b.stage));
  });

  app.post('/partners/:id/agreements', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createAgreement(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/partners/:id/contributions', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.recordContribution(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/partners/:id/recognition/request', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = (c.get('parsedBody') as any) || {};
    return created(c, await svc.requestRecognition(ctx, s.userId, c.req.param('id'), b));
  });

  app.post('/partners/:id/recognition/approve', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveRecognition(ctx, s.userId, c.req.param('id')));
  });

  app.post('/agreements/:id/approve', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveAgreement(ctx, s.userId, c.req.param('id')));
  });

  app.post('/agreements/:id/deliverables', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addDeliverable(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/deliverables/:id/complete', requireAuth(), requirePermission('sponsorship.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.completeDeliverable(ctx, s.userId, c.req.param('id')));
  });
}
