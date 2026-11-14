import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/', async (c) => {
    const items = await svc.listTournaments(ctx, { status: c.req.query('status') });
    return ok(c, items);
  });

  app.get('/:id', async (c) => ok(c, await svc.getTournament(ctx, c.req.param('id'))));

  app.post('/', requireAuth(), requirePermission('tournament.create'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createTournament(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/:id/registration/open', requireAuth(), requirePermission('tournament.manage', 'tournament.create'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.openRegistration(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/register', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.register(ctx, s.userId, c.req.param('id')));
  });

  app.post('/:id/registrations', requireAuth(), requirePermission('tournament.registration.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = c.get('parsedBody') as any;
    return created(c, await svc.register(ctx, s.userId, c.req.param('id'), { playerId: b?.playerId, manual: true }));
  });

  app.post('/:id/withdraw', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const b = c.get('parsedBody') as any;
    return ok(c, await svc.withdraw(ctx, s.userId, c.req.param('id'), b?.playerId || s.userId));
  });

  app.post('/:id/schedule/propose', requireAuth(), requirePermission('tournament.schedule.propose', 'tournament.manage'), async (c) => {
    const s = c.get('session') as any;
    const b = c.get('parsedBody') as any;
    return ok(c, await svc.proposeSchedule(ctx, s.userId, c.req.param('id'), b?.rounds));
  });

  app.post('/:id/schedule/approve', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const perms: string[] = s.permissions || [];
    const isPresident = perms.includes('*') ? false : perms.includes('tournament.schedule.approve_president');
    const isAdmin = perms.includes('*') || perms.includes('tournament.schedule.approve_admin');
    if (!isPresident && !isAdmin) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Requires President or Administrator approval permission' } }, 403);
    }
    return ok(c, await svc.approveSchedule(ctx, s.userId, c.req.param('id'), isAdmin ? 'admin' : 'president'));
  });
}
