import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/', requireAuth(), requirePermission('task.manage'), async (c) => {
    const items = await svc.listTasks(ctx, {
      status: c.req.query('status'),
      assigneeId: c.req.query('assigneeId'),
      projectId: c.req.query('projectId'),
      overdue: c.req.query('overdue'),
    });
    return ok(c, items);
  });

  app.post('/', requireAuth(), requirePermission('task.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.createTask(ctx, s.userId, c.get('parsedBody')));
  });

  app.get('/overdue', requireAuth(), requirePermission('task.manage'), async (c) => {
    return ok(c, await svc.listOverdueTasks(ctx));
  });

  app.get('/:id', requireAuth(), requirePermission('task.manage'), async (c) => {
    return ok(c, await svc.getTask(ctx, c.req.param('id')));
  });

  app.post('/:id/transition', requireAuth(), requirePermission('task.manage'), async (c) => {
    const s = c.get('session');
    return ok(c, await svc.transitionTask(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });

  app.post('/:id/dependencies', requireAuth(), requirePermission('task.manage'), async (c) => {
    const s = c.get('session');
    return created(c, await svc.addDependency(ctx, s.userId, c.req.param('id'), c.get('parsedBody')));
  });
}
