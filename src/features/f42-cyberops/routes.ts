import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { badRequest } from '../../core/errors.js';
import * as svc from './service.js';

/**
 * Mounted at /api/v1/cyberops. Every route is restricted to
 * `security.operations.manage` (or a holder of `*`): detailed security events and
 * security reports are never exposed to ordinary members.
 */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/incidents', requireAuth(), requirePermission('security.operations.manage'), async (c) => {
    const r = await svc.listIncidents(ctx, {
      status: c.req.query('status'),
      severity: c.req.query('severity'),
      containmentStatus: c.req.query('containmentStatus'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });
    return ok(c, page(r.items, r.total, r.limit, r.offset));
  });

  app.get('/incidents/:id', requireAuth(), requirePermission('security.operations.manage'), async (c) =>
    ok(c, await svc.getIncident(ctx, c.req.param('id'))),
  );

  app.post('/incidents', requireAuth(), requirePermission('security.operations.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.openIncident(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post(
    '/incidents/:id/transition',
    requireAuth(),
    requirePermission('security.operations.manage'),
    async (c) => {
      const s = c.get('session')!;
      const input = (c.get('parsedBody') as any) || {};
      if (!input.status) throw badRequest('status is required');
      return ok(c, await svc.transitionIncident(ctx, s.userId, c.req.param('id'), input.status, input));
    },
  );

  app.post('/alerts', requireAuth(), requirePermission('security.operations.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.raiseAlert(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post(
    '/alerts/:id/escalate',
    requireAuth(),
    requirePermission('security.operations.manage'),
    async (c) => {
      const s = c.get('session')!;
      return created(c, await svc.escalateAlert(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
    },
  );

  app.get('/vulnerabilities', requireAuth(), requirePermission('security.operations.manage'), async (c) =>
    ok(
      c,
      await svc.listVulnerabilities(ctx, { status: c.req.query('status'), severity: c.req.query('severity') }),
    ),
  );

  app.post('/vulnerabilities', requireAuth(), requirePermission('security.operations.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.registerVulnerability(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post(
    '/vulnerabilities/:id/remediate',
    requireAuth(),
    requirePermission('security.operations.manage'),
    async (c) => {
      const s = c.get('session')!;
      return ok(c, await svc.remediateVulnerability(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
    },
  );

  app.get('/privileged-reviews', requireAuth(), requirePermission('security.operations.manage'), async (c) =>
    ok(c, await svc.listPrivilegedReviews(ctx)),
  );

  app.post(
    '/privileged-reviews',
    requireAuth(),
    requirePermission('security.operations.manage'),
    async (c) => {
      const s = c.get('session')!;
      return created(c, await svc.recordPrivilegedReview(ctx, s.userId, (c.get('parsedBody') as any) || {}));
    },
  );

  app.get('/secrets', requireAuth(), requirePermission('security.operations.manage'), async (c) =>
    ok(c, await svc.listSecretRotations(ctx)),
  );

  app.post('/secrets/rotate', requireAuth(), requirePermission('security.operations.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.rotateSecret(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post('/audit-reviews', requireAuth(), requirePermission('security.operations.manage'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.recordAuditLogReview(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });
}
