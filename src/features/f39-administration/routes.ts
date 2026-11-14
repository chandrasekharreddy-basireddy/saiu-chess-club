import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* Public operational status — no secrets, no personal data. */
  app.get('/status', async (c) => ok(c, await svc.platformStatus(ctx)));

  app.get('/settings', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    return ok(c, await svc.listSettings(ctx));
  });

  app.get('/settings/:key', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    return ok(c, await svc.getSetting(ctx, c.req.param('key')));
  });

  app.put('/settings/:key', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.updateSetting(ctx, s, c.req.param('key'), c.get('parsedBody') as any));
  });

  app.post('/settings/:key/approve', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveSettingChange(ctx, s, c.req.param('key'), c.get('parsedBody') as any));
  });

  app.post('/settings/:key/rollback', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.rollbackSetting(ctx, s, c.req.param('key'), c.get('parsedBody') as any));
  });

  app.get('/settings/:key/history', requireAuth(), requirePermission('system.configuration.manage'), async (c) => {
    return ok(c, await svc.settingHistory(ctx, c.req.param('key')));
  });

  app.get('/history', requireAuth(), requirePermission('system.configuration.manage', 'audit.log.read'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.configurationHistory(ctx, s, { key: c.req.query('key') || undefined }));
  });
}
