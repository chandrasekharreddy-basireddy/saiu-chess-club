import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 40 — Performance, Reliability & Quality Assurance', () => {
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

  it('defines performance budgets for critical flows only', async () => {
    const qa = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });

    expect((await post('/api/v1/quality/budgets', member.headers, { flow: 'login', p95Ms: 400 })).status).toBe(403);

    const created = await post('/api/v1/quality/budgets', qa.headers, { flow: 'login', p95Ms: 400, errorRatePct: 0.5 });
    expect(created.status).toBe(201);
    expect((await created.json()).data.flow).toBe('login');

    expect((await post('/api/v1/quality/budgets', qa.headers, { flow: 'not_a_flow', p95Ms: 100 })).status).toBe(400);
    expect((await post('/api/v1/quality/budgets', qa.headers, { flow: 'login', p95Ms: 100 })).status).toBe(409);
    expect((await post('/api/v1/quality/budgets', qa.headers, { flow: 'leaderboard', p95Ms: 0 })).status).toBe(400);
  });

  it('records a test run with pass/fail counts and a derived status', async () => {
    const qa = await seedUser(ctx, { roles: ['administrator'] });

    const run = await post('/api/v1/quality/test-runs', qa.headers, {
      suite: 'auth-and-sessions', passed: 14, failed: 0, skipped: 2,
      durationMs: 5200, accessibility: { checked: true, violations: 0 }, devices: ['mobile', 'desktop'],
    });
    expect(run.status).toBe(201);
    const recorded = (await run.json()).data;
    expect(recorded.passed).toBe(14);
    expect(recorded.failed).toBe(0);
    expect(recorded.total).toBe(16);
    expect(recorded.status).toBe('passed');

    const failing = await (await post('/api/v1/quality/test-runs', qa.headers, {
      suite: 'arena', passed: 9, failed: 2, accessibility: { checked: true, violations: 0 },
    })).json();
    expect(failing.data.status).toBe('failed');

    expect((await post('/api/v1/quality/test-runs', qa.headers, { suite: 'empty', passed: 0, failed: 0 })).status).toBe(400);
    expect((await get(`/api/v1/quality/test-runs/${recorded.id}`, qa.headers)).status).toBe(200);
  });

  it('refuses a release while any recorded run has failures', async () => {
    const qa = await seedUser(ctx, { roles: ['administrator'] });

    const good = await (await post('/api/v1/quality/test-runs', qa.headers, {
      suite: 'registration', passed: 20, failed: 0, accessibility: { checked: true, violations: 0 },
    })).json();
    const bad = await (await post('/api/v1/quality/test-runs', qa.headers, {
      suite: 'match-room', passed: 8, failed: 3, accessibility: { checked: true, violations: 0 },
    })).json();

    const blocked = await post('/api/v1/quality/release-gates', qa.headers, {
      version: '1.0.0', testRunIds: [good.data.id, bad.data.id],
    });
    expect(blocked.status).toBe(409);
    const blockedBody = await blocked.json();
    expect(blockedBody.ok).toBe(false);
    expect(blockedBody.error.message).toContain('blocked');

    const noRuns = await post('/api/v1/quality/release-gates', qa.headers, { version: '1.0.0', testRunIds: [] });
    expect(noRuns.status).toBe(400);

    const released = await post('/api/v1/quality/release-gates', qa.headers, { version: '1.0.1', testRunIds: [good.data.id] });
    expect(released.status).toBe(201);
    const gate = (await released.json()).data;
    expect(gate.status).toBe('passed');
    expect(gate.totalFailed).toBe(0);

    const gates = await (await get('/api/v1/quality/release-gates', qa.headers)).json();
    expect(gates.data.length).toBe(2);
    expect(gates.data.some((g: any) => g.status === 'blocked')).toBe(true);
  });

  it('blocks a release when accessibility violations remain', async () => {
    const qa = await seedUser(ctx, { roles: ['administrator'] });
    const run = await (await post('/api/v1/quality/test-runs', qa.headers, {
      suite: 'site', passed: 11, failed: 0, accessibility: { checked: true, violations: 4 },
    })).json();
    const res = await post('/api/v1/quality/release-gates', qa.headers, { version: '1.0.2', testRunIds: [run.data.id] });
    expect(res.status).toBe(409);
  });

  it('rejects telemetry that carries personal data or secrets', async () => {
    const qa = await seedUser(ctx, { roles: ['administrator'] });

    const personal = await post('/api/v1/quality/metrics', qa.headers, {
      name: 'api_latency', value: 120, tags: { email: 'player@saiuniversity.edu.in' },
    });
    expect(personal.status).toBe(400);

    const secret = await post('/api/v1/quality/metrics', qa.headers, {
      name: 'auth_token_refresh', value: 12,
    });
    expect(secret.status).toBe(400);

    const clean = await post('/api/v1/quality/metrics', qa.headers, {
      name: 'api_latency_p95', value: 210, unit: 'ms', route: '/api/v1/tournaments',
    });
    expect(clean.status).toBe(201);

    const summary = await (await get('/api/v1/quality/summary', qa.headers)).json();
    expect(summary.data.avgLatencyMs).toBe(210);
    expect(summary.data.budgetsDefined).toBe(0);
  });

  it('tracks and resolves incidents exactly once', async () => {
    const qa = await seedUser(ctx, { roles: ['administrator'] });

    const opened = await post('/api/v1/quality/incidents', qa.headers, {
      title: 'Arena websocket disconnects', severity: 'sev2',
    });
    expect(opened.status).toBe(201);
    const incident = (await opened.json()).data;
    expect(incident.status).toBe('open');

    expect((await post('/api/v1/quality/incidents', qa.headers, { title: 'x', severity: 'sev9' })).status).toBe(400);

    const resolved = await post(`/api/v1/quality/incidents/${incident.id}/resolve`, qa.headers, { resolution: 'relay restarted' });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data.status).toBe('resolved');
    expect((await post(`/api/v1/quality/incidents/${incident.id}/resolve`, qa.headers, {})).status).toBe(409);

    const summary = await (await get('/api/v1/quality/summary', qa.headers)).json();
    expect(summary.data.openIncidents).toBe(0);
  });

  it('guards load tests against provider free quotas', async () => {
    const qa = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });

    expect((await post('/api/v1/quality/load-test/check', member.headers, {})).status).toBe(403);

    const unconfirmed = await post('/api/v1/quality/load-test/check', qa.headers, { targetsThirdParty: true });
    expect(unconfirmed.status).toBe(422);

    const ok = await post('/api/v1/quality/load-test/check', qa.headers, { targetsThirdParty: true, providerQuotaConfirmed: true });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.compliant).toBe(true);
  });
});
