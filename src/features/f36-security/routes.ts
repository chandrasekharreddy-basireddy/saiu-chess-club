import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission, readToken } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ------------------------------------------------------------ privacy */
  app.get('/privacy', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getPrivacy(ctx, s.userId));
  });

  app.put('/privacy', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.updatePrivacy(ctx, s.userId, c.get('parsedBody') as any));
  });

  /* ----------------------------------------------------------- sessions */
  app.get('/sessions', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const result = await svc.listSessions(ctx, s, {
      userId: c.req.query('userId') || undefined,
      currentToken: readToken(c),
    });
    return ok(c, result);
  });

  app.delete('/sessions', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.revokeAllSessions(ctx, s, readToken(c)));
  });

  app.delete('/sessions/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.revokeSession(ctx, s, c.req.param('id')));
  });

  app.get('/revocations', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.listRevocations(ctx, s, {
      userId: c.req.query('userId') || undefined,
      since: c.req.query('since') || undefined,
    }));
  });

  /* --------------------------------------------------- password and MFA */
  app.post('/password/change', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.changePassword(ctx, s, c.get('parsedBody') as any, readToken(c)));
  });

  app.get('/mfa', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getMfa(ctx, s.userId));
  });

  app.post('/mfa/enable', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.enableMfa(ctx, s, c.get('parsedBody') as any));
  });

  app.post('/mfa/disable', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.disableMfa(ctx, s, c.get('parsedBody') as any));
  });

  app.post('/mfa/recovery-codes', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.rotateRecoveryCodes(ctx, s, c.get('parsedBody') as any));
  });

  /* ----------------------------------------------------------- blocking */
  app.get('/blocked', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.listBlocked(ctx, s.userId));
  });

  app.post('/users/:id/block', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.blockUser(ctx, s.userId, c.req.param('id')));
  });

  app.delete('/users/:id/block', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.unblockUser(ctx, s.userId, c.req.param('id')));
  });

  /* -------------------------------------------------- account requests */
  app.get('/requests', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const all = c.req.query('scope') === 'all';
    const items = await svc.listRequests(ctx, s, { all });
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.post('/requests', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createRequest(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/requests/:id/review', requireAuth(), requirePermission('privacy.request.handle'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.reviewRequest(ctx, s, c.req.param('id'), c.get('parsedBody') as any));
  });

  /* ------------------------------------------------ login attempt counter */
  // Public: called by the sign-in flow itself, before a session exists.
  app.post('/login-attempts', async (c) => {
    const b = c.get('parsedBody') as any;
    return ok(c, await svc.recordLoginFailure(ctx, b?.email));
  });

  app.post('/login-attempts/clear', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.clearOwnLoginFailures(ctx, s));
  });

  /* ------------------------------------------------------ role assignment */
  app.post('/roles/assign', requireAuth(), requirePermission('security.role.assign'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.assignRoles(ctx, s, c.get('parsedBody') as any));
  });

  /* ------------------------------------------------------------- telemetry */
  app.get('/events', requireAuth(), requirePermission('security.operations.manage', 'audit.log.read'), async (c) => {
    const s = c.get('session') as any;
    const items = await svc.listSecurityEvents(ctx, s, { userId: c.req.query('userId') || undefined });
    return ok(c, items);
  });
}
