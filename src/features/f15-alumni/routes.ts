import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ------------------------------------------------------------- requests */

  app.post('/requests', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.requestAlumniAccess(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/requests/mine', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.listMyRequests(ctx, s.userId));
  });

  app.post('/requests/:id/verify-contact', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.verifyContactEmail(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.get('/requests', requireAuth(), requirePermission('alumni.manage'), async (c) =>
    ok(c, await svc.listRequests(ctx, { status: c.req.query('status') || undefined })),
  );

  app.post('/requests/:id/approve', requireAuth(), requirePermission('alumni.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveRequest(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/requests/:id/reject', requireAuth(), requirePermission('alumni.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.rejectRequest(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  /* ------------------------------------------------------------- profiles */

  app.get('/profiles/me', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getMyProfile(ctx, s.userId));
  });

  app.patch('/profiles/me', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.setProfilePrivacy(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/profiles/:id/suspend', requireAuth(), requirePermission('alumni.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.setProfileStatus(ctx, s.userId, c.req.param('id'), 'suspended', c.get('parsedBody') as any));
  });

  app.post('/profiles/:id/revoke', requireAuth(), requirePermission('alumni.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.setProfileStatus(ctx, s.userId, c.req.param('id'), 'revoked', c.get('parsedBody') as any));
  });

  app.get('/directory', requireAuth(), async (c) => ok(c, await svc.directory(ctx)));

  /* -------------------------------------------------------------- history */

  app.get('/history', requireAuth(), async (c) => ok(c, await svc.listHistory(ctx)));

  app.get('/history/mine', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.myHistory(ctx, s.userId));
  });

  app.post('/history', requireAuth(), requirePermission('alumni.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addHistoryEntry(ctx, s.userId, c.get('parsedBody') as any));
  });
}
