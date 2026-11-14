import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { hasPermission } from '../../core/permissions.js';
import { badRequest } from '../../core/errors.js';
import * as svc from './service.js';

/** Mounted at /api/v1/compliance — privacy governance and data protection. */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  // ------------------------------------------------------------- policies ---
  app.get(
    '/policies',
    requireAuth(),
    requirePermission('legal.compliance.manage', 'governance.policy.manage'),
    async (c) => ok(c, await svc.listPolicies(ctx, { status: c.req.query('status'), key: c.req.query('key') })),
  );

  app.post('/policies', requireAuth(), requirePermission('legal.compliance.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.createPolicy(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post(
    '/policies/:id/publish',
    requireAuth(),
    requirePermission('legal.compliance.manage'),
    async (c) => {
      const s = c.get('session')!;
      return ok(c, await svc.publishPolicy(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
    },
  );

  // ------------------------------------------------------------- consents ---
  app.get('/consents', requireAuth(), async (c) => {
    const s = c.get('session')!;
    const asked = c.req.query('subjectId');
    const subjectId = asked && hasPermission(s, 'privacy.request.handle') ? asked : s.userId;
    return ok(c, await svc.listConsents(ctx, subjectId));
  });

  app.post('/consents', requireAuth(), async (c) => {
    const s = c.get('session')!;
    const input = (c.get('parsedBody') as any) || {};
    const safe = hasPermission(s, 'privacy.request.handle') ? input : { ...input, subjectId: s.userId };
    return created(c, await svc.recordConsent(ctx, s.userId, safe));
  });

  app.post('/consents/:id/withdraw', requireAuth(), async (c) => {
    const s = c.get('session')!;
    return ok(
      c,
      await svc.withdrawConsent(ctx, s.userId, c.req.param('id'), hasPermission(s, 'privacy.request.handle')),
    );
  });

  // --------------------------------------------------------- data requests ---
  app.get('/requests', requireAuth(), requirePermission('privacy.request.handle'), async (c) => {
    const r = await svc.listDataRequests(ctx, {
      status: c.req.query('status'),
      type: c.req.query('type'),
      subjectId: c.req.query('subjectId'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });
    return ok(c, page(r.items, r.total, r.limit, r.offset));
  });

  app.post('/requests', requireAuth(), async (c) => {
    const s = c.get('session')!;
    return created(
      c,
      await svc.createDataRequest(ctx, s.userId, (c.get('parsedBody') as any) || {}, hasPermission(s, 'privacy.request.handle')),
    );
  });

  app.get('/requests/:id', requireAuth(), async (c) => {
    const s = c.get('session')!;
    return ok(
      c,
      await svc.getDataRequest(ctx, s.userId, c.req.param('id'), hasPermission(s, 'privacy.request.handle')),
    );
  });

  app.post(
    '/requests/:id/transition',
    requireAuth(),
    requirePermission('privacy.request.handle'),
    async (c) => {
      const s = c.get('session')!;
      const input = (c.get('parsedBody') as any) || {};
      if (!input.status) throw badRequest('status is required');
      return ok(c, await svc.transitionDataRequest(ctx, s.userId, c.req.param('id'), input.status, input));
    },
  );

  app.post(
    '/requests/:id/legal-hold',
    requireAuth(),
    requirePermission('privacy.request.handle'),
    async (c) => {
      const s = c.get('session')!;
      return ok(c, await svc.markLegalHold(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
    },
  );

  // -------------------------------------------------------------- retention ---
  app.get('/retention-rules', requireAuth(), requirePermission('legal.compliance.manage'), async (c) =>
    ok(c, await svc.listRetentionRules(ctx)),
  );

  app.post('/retention-rules', requireAuth(), requirePermission('legal.compliance.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.createRetentionRule(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  // ------------------------------------------------------ privacy incidents ---
  app.post('/incidents', requireAuth(), requirePermission('legal.compliance.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.createPrivacyIncident(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post(
    '/incidents/:id/escalate',
    requireAuth(),
    requirePermission('legal.compliance.manage'),
    async (c) => {
      const s = c.get('session')!;
      return ok(c, await svc.escalatePrivacyIncident(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
    },
  );
}
