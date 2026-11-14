import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  /* ------------------------------------------------------------ backups */
  app.get('/backups', requireAuth(), requirePermission('data.backup.manage', 'disaster.recovery.manage'), async (c) => {
    return ok(c, await svc.listBackups(ctx, { status: c.req.query('status') || undefined }));
  });

  app.get('/backups/:id', requireAuth(), requirePermission('data.backup.manage', 'disaster.recovery.manage'), async (c) => {
    return ok(c, await svc.getBackup(ctx, c.req.param('id')));
  });

  app.post('/backups', requireAuth(), requirePermission('data.backup.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createBackupJob(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/backups/:id/complete', requireAuth(), requirePermission('data.backup.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.completeBackupJob(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/backups/:id/fail', requireAuth(), requirePermission('data.backup.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.failBackupJob(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/backups/:id/verify', requireAuth(), requirePermission('data.backup.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.verifyBackupIntegrity(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/backups/:id/restore-verify', requireAuth(), requirePermission('data.backup.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.verifyBackupRestore(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  /* ----------------------------------------------------------- restores */
  app.get('/restores', requireAuth(), requirePermission('data.backup.manage', 'disaster.recovery.manage'), async (c) => {
    return ok(c, await svc.listRestoreRequests(ctx, { status: c.req.query('status') || undefined }));
  });

  app.post('/restores', requireAuth(), requirePermission('data.backup.manage', 'disaster.recovery.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createRestoreRequest(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/restores/:id/approve', requireAuth(), requirePermission('disaster.recovery.manage', 'data.backup.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.approveRestoreRequest(ctx, s, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/restores/:id/execute', requireAuth(), requirePermission('disaster.recovery.manage', 'data.backup.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.executeRestoreRequest(ctx, s, c.req.param('id')));
  });

  /* ------------------------------------------------------------ exports */
  app.get('/exports', requireAuth(), requirePermission('data.export.request', 'data.backup.manage'), async (c) => {
    return ok(c, await svc.listExports(ctx));
  });

  app.post('/exports', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.requestExport(ctx, s, c.get('parsedBody') as any));
  });

  /* ------------------------------------------------------------ imports */
  app.get('/imports', requireAuth(), requirePermission('data.backup.manage'), async (c) => {
    return ok(c, await svc.listImports(ctx));
  });

  app.post('/imports/preview', requireAuth(), requirePermission('data.backup.manage'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.previewImport(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.post('/imports/:id/commit', requireAuth(), requirePermission('data.backup.manage'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.commitImport(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  /* ----------------------------------------------------------- integrity */
  app.get('/integrity', requireAuth(), requirePermission('data.backup.manage', 'disaster.recovery.manage'), async (c) => {
    return ok(c, await svc.integrityReport(ctx));
  });
}
