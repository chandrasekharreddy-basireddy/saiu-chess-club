import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ------------------------------------------- public verification + fame */

  // Public verification page: no authentication, minimum information only.
  app.get('/verify/:code', async (c) => ok(c, await svc.verifyCertificate(ctx, c.req.param('code'))));

  app.get('/hall-of-fame', async (c) => ok(c, await svc.hallOfFame(ctx)));

  /* ----------------------------------------------------------- templates */

  app.get('/templates', requireAuth(), async (c) => ok(c, await svc.listTemplates(ctx)));

  app.post('/templates', requireAuth(), requirePermission('achievement.issue'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.publishTemplate(ctx, s.userId, c.get('parsedBody') as any));
  });

  /* -------------------------------------------------------- achievements */

  app.get('/achievements', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const requested = c.req.query('recipientId');
    if (requested && requested !== s.userId && !(s.permissions || []).some((p: string) => p === '*' || p === 'achievement.issue')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Requires permission: achievement.issue' } }, 403);
    }
    return ok(c, await svc.listAchievements(ctx, { recipientId: requested || s.userId }));
  });

  app.post('/achievements', requireAuth(), requirePermission('achievement.issue'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createAchievement(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/achievements/:id/approve', requireAuth(), requirePermission('achievement.issue'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveAchievement(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/achievements/:id/dispute', requireAuth(), requirePermission('achievement.issue'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.disputeAchievement(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/achievements/:id/consent', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.setConsent(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/achievements/:id/certificate', requireAuth(), requirePermission('achievement.issue'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.issueCertificate(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  /* -------------------------------------------------------- certificates */

  app.get('/certificates/mine', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.myCertificates(ctx, s.userId));
  });

  app.post('/certificates/:id/revoke', requireAuth(), requirePermission('achievement.issue'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.revokeCertificate(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });
}
