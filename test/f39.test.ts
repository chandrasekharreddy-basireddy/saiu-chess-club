import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 39 — System Administration & Platform Control', () => {
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
  const put = (path: string, headers: any = {}, json?: any) =>
    app.request(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('exposes the allowlisted settings and hides administration from members', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });

    expect((await get('/api/v1/administration/settings', member.headers)).status).toBe(403);
    expect((await put('/api/v1/administration/settings/academic.year', member.headers, { value: '2026-27' })).status).toBe(403);

    const list = await get('/api/v1/administration/settings', admin.headers);
    expect(list.status).toBe(200);
    const settings = (await list.json()).data;
    const year = settings.find((s: any) => s.key === 'academic.year');
    expect(year.value).toBe('2025-26');
    expect(year.type).toBe('string');
    expect(year.impact).toBeTruthy();
    expect(JSON.stringify(settings)).not.toMatch(/secret|password/i);
  });

  it('rejects keys outside the allowlist, wrong types and paid-usage settings', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });

    expect((await put('/api/v1/administration/settings/platform.paidUsageEnabled', admin.headers, { value: true })).status).toBe(400);
    expect((await put('/api/v1/administration/settings/academic.year', admin.headers, { value: 2026 })).status).toBe(400);
    expect((await put('/api/v1/administration/settings/chess.defaultTimeControl', admin.headers, { value: 'bullet' })).status).toBe(422);
    // the AI credit cap cannot be raised past the free allowance
    expect((await put('/api/v1/administration/settings/integrations.aiCreditLimitInr', admin.headers, { value: 500 })).status).toBe(422);
  });

  it('validates and applies a low-risk setting, then rolls it back', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });

    const applied = await put('/api/v1/administration/settings/academic.year', admin.headers, { value: '2026-27' });
    expect(applied.status).toBe(200);
    const body = (await applied.json()).data;
    expect(body.value).toBe('2026-27');
    expect(body.status).toBe('applied');
    expect(body.version).toBe(1);

    const history = await (await get('/api/v1/administration/settings/academic.year/history', admin.headers)).json();
    expect(history.data.length).toBe(1);
    expect(history.data[0].action).toBe('update');

    const rolled = await post('/api/v1/administration/settings/academic.year/rollback', admin.headers, {});
    expect(rolled.status).toBe(200);
    expect((await rolled.json()).data.value).toBe('2025-26');

    const current = await (await get('/api/v1/administration/settings/academic.year', admin.headers)).json();
    expect(current.data.value).toBe('2025-26');
    expect(current.data.version).toBe(2);
  });

  it('requires reauthentication and a second administrator for a high-risk setting', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const admin2 = await seedUser(ctx, { roles: ['administrator'] });

    expect((await put('/api/v1/administration/settings/platform.maintenanceMode', admin.headers, { value: true })).status).toBe(403);

    const staged = await put('/api/v1/administration/settings/platform.maintenanceMode', admin.headers, {
      value: true, reauthenticated: true, reason: 'database upgrade',
    });
    expect(staged.status).toBe(200);
    expect((await staged.json()).data.status).toBe('pending_approval');

    // the requesting admin cannot approve their own change
    expect((await post('/api/v1/administration/settings/platform.maintenanceMode/approve', admin.headers, {})).status).toBe(403);

    const approved = await post('/api/v1/administration/settings/platform.maintenanceMode/approve', admin2.headers, { note: 'ok' });
    expect(approved.status).toBe(200);
    const applied = (await approved.json()).data;
    expect(applied.status).toBe('applied');
    expect(applied.value).toBe(true);

    // and it shows up on the public status board
    const status = await get('/api/v1/administration/status');
    expect(status.status).toBe(200);
    const data = (await status.json()).data;
    expect(data.maintenanceMode).toBe(true);
    expect(data.status).toBe('maintenance');
  });

  it('refuses rollback for settings that are not rollback-safe', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const res = await post('/api/v1/administration/settings/quality.releaseGateRequired/rollback', admin.headers, {});
    expect(res.status).toBe(409);
  });

  it('publishes operational status and quota usage without secrets', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const res = await get('/api/v1/administration/status');
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.status).toBe('operational');
    expect(data.release.qualityGateRequired).toBe(true);
    expect(Array.isArray(data.quota)).toBe(true);

    // status is public, but configuration history is not
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await get('/api/v1/administration/history', member.headers)).status).toBe(403);
    expect((await get('/api/v1/administration/history', admin.headers)).status).toBe(200);
  });
});
