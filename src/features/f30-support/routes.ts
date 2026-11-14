import type { FeatureHono, FeatureContext } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

const HANDLE = 'support.handle';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // ---- submit ----
  app.post('/tickets', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createTicket(ctx, s.userId, c.get('parsedBody') as any));
  });

  // ---- own history / staff queue ----
  app.get('/tickets', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 100);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
    const items = await svc.listTickets(ctx, s, { status: c.req.query('status') });
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.get('/queue', requireAuth(), requirePermission(HANDLE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.staffQueue(ctx, s, { queue: c.req.query('queue'), status: c.req.query('status') }));
  });

  app.get('/tickets/:id', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getTicket(ctx, s, c.req.param('id')));
  });

  // ---- staff actions ----
  app.post('/tickets/:id/assign', requireAuth(), requirePermission(HANDLE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.assignTicket(ctx, s, c.req.param('id'), (c.get('parsedBody') as any)?.assigneeId));
  });

  app.post('/tickets/:id/notes', requireAuth(), requirePermission(HANDLE), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addNote(ctx, s, c.req.param('id'), (c.get('parsedBody') as any)?.body));
  });

  app.post('/tickets/:id/escalate', requireAuth(), requirePermission(HANDLE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.escalateTicket(ctx, s, c.req.param('id'), (c.get('parsedBody') as any)?.reason));
  });

  app.post('/tickets/:id/resolve', requireAuth(), requirePermission(HANDLE), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.resolveTicket(ctx, s, c.req.param('id'), (c.get('parsedBody') as any)?.resolution));
  });

  // ---- requester actions ----
  app.post('/tickets/:id/close', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.closeTicket(ctx, s, c.req.param('id')));
  });

  app.post('/tickets/:id/reopen', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.reopenTicket(ctx, s, c.req.param('id'), (c.get('parsedBody') as any)?.reason));
  });
}
