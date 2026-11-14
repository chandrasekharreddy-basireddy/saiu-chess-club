import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 38 — Data Management, Backup & Recovery', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any = {}, json?: any) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const CHECKSUM = 'abc123def456abc123def456abc123de';

  async function completedBackup(admin: any) {
    const job = await post('/api/v1/data-management/backups', admin.headers, { scope: 'full' });
    const id = (await job.json()).data.id;
    await post(`/api/v1/data-management/backups/${id}/complete`, admin.headers, {
      checksum: CHECKSUM, sizeBytes: 4096, storageRef: 'offsite://bucket/2026-01.sql.gz',
    });
    return id;
  }

  it('records a backup job and only calls it valid after integrity and restore checks', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const job = await post('/api/v1/data-management/backups', admin.headers, { scope: 'full' });
    expect(job.status).toBe(201);
    const created = (await job.json()).data;
    expect(created.status).toBe('queued');
    expect(created.valid).toBe(false);

    // a backup without a checksum or size is not a backup
    const bare = await post(`/api/v1/data-management/backups/${created.id}/complete`, admin.headers, { sizeBytes: 10 });
    expect(bare.status).toBe(400);
    const unencrypted = await post(`/api/v1/data-management/backups/${created.id}/complete`, admin.headers, {
      checksum: CHECKSUM, sizeBytes: 10, encrypted: false,
    });
    expect(unencrypted.status).toBe(400);

    const done = await (await post(`/api/v1/data-management/backups/${created.id}/complete`, admin.headers, {
      checksum: CHECKSUM, sizeBytes: 4096,
    })).json();
    expect(done.data.status).toBe('completed');
    expect(done.data.sizeBytes).toBe(4096);
    expect(done.data.valid).toBe(false);

    const mismatch = await post(`/api/v1/data-management/backups/${created.id}/verify`, admin.headers, { checksum: 'ffffffffffffffffffffffffffff' });
    expect(mismatch.status).toBe(422);

    const verified = await (await post(`/api/v1/data-management/backups/${created.id}/verify`, admin.headers, { checksum: CHECKSUM })).json();
    expect(verified.data.integrityVerified).toBe(true);
    expect(verified.data.valid).toBe(false);

    const restoreTested = await (await post(`/api/v1/data-management/backups/${created.id}/restore-verify`, admin.headers, { environment: 'staging' })).json();
    expect(restoreTested.data.restoreVerified).toBe(true);
    expect(restoreTested.data.valid).toBe(true);
  });

  it('refuses a restore from an unverified backup', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const job = await post('/api/v1/data-management/backups', admin.headers, { scope: 'full' });
    const id = (await job.json()).data.id;
    await post(`/api/v1/data-management/backups/${id}/complete`, admin.headers, { checksum: CHECKSUM, sizeBytes: 2048 });

    const res = await post('/api/v1/data-management/restores', admin.headers, { backupId: id });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain('verification');
  });

  it('requires a second person to approve a restore and executes it only once', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const admin2 = await seedUser(ctx, { roles: ['administrator'] });
    const id = await completedBackup(admin);
    await post(`/api/v1/data-management/backups/${id}/verify`, admin.headers, { checksum: CHECKSUM });
    await post(`/api/v1/data-management/backups/${id}/restore-verify`, admin.headers, {});

    const req = await post('/api/v1/data-management/restores', admin2.headers, { backupId: id, reason: 'corrupted table' });
    expect(req.status).toBe(201);
    const restoreId = (await req.json()).data.id;

    // self-approval is blocked
    expect((await post(`/api/v1/data-management/restores/${restoreId}/approve`, admin2.headers, {})).status).toBe(403);
    expect((await post(`/api/v1/data-management/restores/${restoreId}/execute`, admin.headers)).status).toBe(409);

    const approved = await post(`/api/v1/data-management/restores/${restoreId}/approve`, admin.headers, {});
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('approved');

    const executed = await post(`/api/v1/data-management/restores/${restoreId}/execute`, admin.headers);
    expect(executed.status).toBe(200);
    expect((await executed.json()).data.status).toBe('executed');

    // recovery must not run twice (no duplicate notifications or ledger entries)
    expect((await post(`/api/v1/data-management/restores/${restoreId}/execute`, admin.headers)).status).toBe(409);
  });

  it('previews an import, blocks silent overwrite and commits only with confirmation', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });

    const preview = await post('/api/v1/data-management/imports/preview', admin.headers, {
      target: 'members',
      rows: [
        { email: member.user.email, name: 'Duplicate Person' },
        { email: 'new.member@saiuniversity.edu.in', name: 'New Person' },
        { name: 'No Email At All' },
      ],
    });
    expect(preview.status).toBe(201);
    const batch = (await preview.json()).data;
    expect(batch.total).toBe(3);
    expect(batch.conflicts).toBe(1);
    expect(batch.invalid).toBe(1);
    expect(batch.valid).toBe(1);
    expect(batch.requiresConfirmation).toBe(true);

    expect((await post(`/api/v1/data-management/imports/${batch.batchId}/commit`, admin.headers, {})).status).toBe(400);
    expect((await post(`/api/v1/data-management/imports/${batch.batchId}/commit`, admin.headers, { confirm: true })).status).toBe(409);

    const committed = await post(`/api/v1/data-management/imports/${batch.batchId}/commit`, admin.headers, { confirm: true, allowOverwrite: true });
    expect(committed.status).toBe(200);
    expect((await committed.json()).data.committedCount).toBe(1);
  });

  it('limits exports by permission and audits sensitive ones', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });

    expect((await post('/api/v1/data-management/exports', member.headers, { scope: 'reports' })).status).toBe(403);
    expect((await post('/api/v1/data-management/exports', admin.headers, { scope: 'nonsense' })).status).toBe(400);

    const sensitive = await post('/api/v1/data-management/exports', admin.headers, { scope: 'finance', format: 'xlsx' });
    expect(sensitive.status).toBe(201);
    expect((await sensitive.json()).data.containsSensitive).toBe(true);

    const listed = await get('/api/v1/data-management/exports', admin.headers);
    expect(listed.status).toBe(200);
    expect((await listed.json()).data.length).toBe(1);
  });

  it('keeps backup administration off-limits to ordinary members', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await post('/api/v1/data-management/backups', member.headers, {})).status).toBe(403);
    expect((await get('/api/v1/data-management/backups', member.headers)).status).toBe(403);
    expect((await get('/api/v1/data-management/integrity', member.headers)).status).toBe(403);
  });

  it('reports backup integrity across jobs', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const id = await completedBackup(admin);
    const report = await (await get('/api/v1/data-management/integrity', admin.headers)).json();
    expect(report.data.backups.total).toBe(1);
    expect(report.data.backups.valid).toBe(0);
    expect(report.data.invalidBackups).toContain(id);
  });
});
