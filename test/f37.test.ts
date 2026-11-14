import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 37 — Digital Services & External Integrations', () => {
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

  async function registerBrevo(admin: any, quota = 2) {
    const res = await post('/api/v1/integrations', admin.headers, {
      provider: 'brevo',
      purpose: 'Transactional email for notices and certificates',
      freeQuotaLimit: quota,
    });
    return res;
  }

  it('registers an approved integration disabled by default with a quota', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const res = await registerBrevo(admin);
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    expect(created.provider).toBe('brevo');
    expect(created.enabled).toBe(false);
    expect(created.quota.limit).toBe(2);
    expect(created.quota.used).toBe(0);
  });

  it('refuses activation until the free-tier terms are reviewed', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const id = (await (await registerBrevo(admin)).json()).data.id;

    const tooEarly = await post(`/api/v1/integrations/${id}/enable`, admin.headers);
    expect(tooEarly.status).toBe(422);

    expect((await post(`/api/v1/integrations/${id}/terms-review`, admin.headers, { termsReviewed: true })).status).toBe(200);
    const enabled = await post(`/api/v1/integrations/${id}/enable`, admin.headers);
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).data.enabled).toBe(true);
  });

  it('enforces the free quota with 429 and refuses usage on a disabled integration', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const id = (await (await registerBrevo(admin, 2)).json()).data.id;

    const disabledUse = await post(`/api/v1/integrations/${id}/usage`, admin.headers, { units: 1 });
    expect(disabledUse.status).toBe(409);

    await post(`/api/v1/integrations/${id}/terms-review`, admin.headers, { termsReviewed: true });
    await post(`/api/v1/integrations/${id}/enable`, admin.headers);

    const first = await post(`/api/v1/integrations/${id}/usage`, admin.headers, { units: 1 });
    expect(first.status).toBe(200);
    expect((await first.json()).data.quota.remaining).toBe(1);

    expect((await post(`/api/v1/integrations/${id}/usage`, admin.headers, { units: 1 })).status).toBe(200);

    const over = await post(`/api/v1/integrations/${id}/usage`, admin.headers, { units: 1 });
    expect(over.status).toBe(429);

    const detail = await (await get(`/api/v1/integrations/${id}`, admin.headers)).json();
    expect(detail.data.quota.used).toBe(2);
    expect(detail.data.quota.remaining).toBe(0);
  });

  it('excludes payment integrations and refuses to store secrets', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });

    const payment = await post('/api/v1/integrations', admin.headers, {
      provider: 'brevo', category: 'payment', purpose: 'take money',
    });
    expect(payment.status).toBe(400);

    const unknownProvider = await post('/api/v1/integrations', admin.headers, { provider: 'stripe', purpose: 'x' });
    expect(unknownProvider.status).toBe(422);

    const secret = await post('/api/v1/integrations', admin.headers, {
      provider: 'brevo', purpose: 'email', apiKey: 'xkeysib-live-000',
    });
    expect(secret.status).toBe(400);

    const paid = await post('/api/v1/integrations', admin.headers, { provider: 'sarvam_ai', purpose: 'ai', paidPlan: true });
    expect(paid.status).toBe(400);

    const overBudget = await post('/api/v1/integrations', admin.headers, {
      provider: 'sarvam_ai', purpose: 'ai', currencyBudgetInr: 500,
    });
    expect(overBudget.status).toBe(422);
  });

  it('keeps the registry admin-only and reports health + quota on the dashboard', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });

    const id = (await (await registerBrevo(admin, 1)).json()).data.id;
    await post(`/api/v1/integrations/${id}/terms-review`, admin.headers, { termsReviewed: true });
    await post(`/api/v1/integrations/${id}/enable`, admin.headers);
    await post(`/api/v1/integrations/${id}/usage`, admin.headers, { units: 1 });
    const health = await post(`/api/v1/integrations/${id}/health`, admin.headers, { status: 'degraded', latencyMs: 850 });
    expect(health.status).toBe(200);
    expect((await health.json()).data.healthStatus).toBe('degraded');

    const dashboard = await get('/api/v1/integrations/status', admin.headers);
    expect(dashboard.status).toBe(200);
    const data = (await dashboard.json()).data;
    expect(data.total).toBe(1);
    expect(data.nearQuota.length).toBe(1);
    expect(JSON.stringify(data)).not.toContain('xkeysib');

    expect((await get('/api/v1/integrations', member.headers)).status).toBe(403);
    expect((await get('/api/v1/integrations/status', member.headers)).status).toBe(403);
    // but the provider catalogue is readable by any signed-in user
    expect((await get('/api/v1/integrations/providers', member.headers)).status).toBe(200);
  });

  it('audits enable and disable and isolates health failures', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const id = (await (await registerBrevo(admin)).json()).data.id;
    await post(`/api/v1/integrations/${id}/terms-review`, admin.headers, { termsReviewed: true });
    await post(`/api/v1/integrations/${id}/enable`, admin.headers);

    const disabled = await post(`/api/v1/integrations/${id}/disable`, admin.headers);
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).data.enabled).toBe(false);

    const bad = await post(`/api/v1/integrations/${id}/health`, admin.headers, { status: 'on-fire' });
    expect(bad.status).toBe(400);

    const down = await post(`/api/v1/integrations/${id}/health`, admin.headers, { status: 'down', error: 'timeout' });
    expect(down.status).toBe(200);
    expect((await down.json()).data.lastError).toBe('timeout');
    // unrelated core features keep working while the integration is down
    expect((await get('/api/v1/integrations/providers', admin.headers)).status).toBe(200);
  });
});
