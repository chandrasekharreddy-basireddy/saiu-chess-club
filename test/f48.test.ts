import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 48 — Critical Alerts & Emergency Escalation', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const put = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('creates a critical alert with severity, owner and a computed acknowledgement deadline', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const res = await post('/api/v1/alerts', president.headers, {
      title: 'Main hall power failure',
      category: 'facility_issue',
      severity: 'critical',
      ownerRole: 'organizer',
      detail: 'Round two cannot start',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('open');
    expect(body.data.escalationLevel).toBe(0);
    // default critical acknowledgement target is 15 minutes from ctx.now()
    expect(body.data.ackDueAt).toBe('2026-01-15T09:15:00.000Z');
  });

  it('refuses to assert cheating from technical signals alone', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const res = await post('/api/v1/alerts', president.headers, {
      title: 'Engine says this player is cheating',
      category: 'match_integrity',
      severity: 'high',
    });
    expect(res.status).toBe(422);
  });

  it('keeps alert handling away from ordinary members', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await post('/api/v1/alerts', member.headers, { title: 'x', category: 'facility_issue' })).status).toBe(403);
    expect((await get('/api/v1/alerts', member.headers)).status).toBe(403);
  });

  it('groups duplicate alerts instead of flooding responders', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const payload = { title: 'Scoreboard feed down', category: 'tournament_disruption', severity: 'high' };
    const first = await (await post('/api/v1/alerts', president.headers, payload)).json();
    const second = await (await post('/api/v1/alerts', president.headers, payload)).json();

    expect(second.data.id).toBe(first.data.id);
    expect(second.data.occurrenceCount).toBe(2);
    expect(second.data.deduplicated).toBe(true);

    const list = await (await get('/api/v1/alerts', president.headers)).json();
    expect(list.data.length).toBe(1);
  });

  it('tracks acknowledgement once and escalates unacknowledged alerts up a capped ladder', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const created = await (await post('/api/v1/alerts', president.headers, {
      title: 'Water leak in the store room',
      category: 'facility_issue',
      severity: 'high',
      ackDueAt: '2026-01-15T08:00:00.000Z',
    })).json();

    const acked = await post(`/api/v1/alerts/${created.data.id}/acknowledge`, president.headers);
    expect(acked.status).toBe(200);
    expect((await acked.json()).data.status).toBe('acknowledged');
    expect((await post(`/api/v1/alerts/${created.data.id}/acknowledge`, president.headers)).status).toBe(409);

    const second = await (await post('/api/v1/alerts', president.headers, {
      title: 'Unacknowledged facility escalation',
      category: 'facility_issue',
      severity: 'high',
      ackDueAt: '2026-01-15T08:30:00.000Z',
    })).json();

    const one = await (await post('/api/v1/alerts/escalate', president.headers)).json();
    expect(one.data.alerts.find((a: any) => a.id === second.data.id).escalationLevel).toBe(1);

    await post('/api/v1/alerts/escalate', president.headers);
    // the ladder for a 'high' alert is organizer -> president -> administrator, so level 2 is the cap
    const third = await (await post('/api/v1/alerts/escalate', president.headers)).json();
    expect(third.data.escalatedCount).toBe(0);

    const detail = await (await get(`/api/v1/alerts/${second.data.id}`, president.headers)).json();
    expect(detail.data.escalationLevel).toBe(2);
    expect(detail.data.escalatedTo).toBe('administrator');
  });

  it('requires a resolution note for critical alerts', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const created = await (await post('/api/v1/alerts', president.headers, {
      title: 'Database quota exhausted',
      category: 'provider_quota_risk',
      severity: 'critical',
    })).json();

    const bare = await post(`/api/v1/alerts/${created.data.id}/resolve`, president.headers, {});
    expect(bare.status).toBe(422);

    const resolved = await post(`/api/v1/alerts/${created.data.id}/resolve`, president.headers, {
      resolutionNote: 'Quota raised and writes verified',
    });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data.status).toBe('resolved');
  });

  it('restricts sensitive security detail by permission', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const created = await (await post('/api/v1/alerts', president.headers, {
      title: 'Unauthorised entry to the server room',
      category: 'security_incident',
      severity: 'critical',
      sensitive: true,
      detail: 'Door forced at 04:12; camera 3 offline',
    })).json();

    const asPresident = await (await get(`/api/v1/alerts/${created.data.id}`, president.headers)).json();
    expect(asPresident.data.detail).toBe('[restricted]');

    const asAdmin = await (await get(`/api/v1/alerts/${created.data.id}`, admin.headers)).json();
    expect(asAdmin.data.detail).toBe('Door forced at 04:12; camera 3 offline');
  });

  it('lets authorised officials retune the acknowledgement thresholds', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const res = await put('/api/v1/alerts/config/thresholds', president.headers, { critical: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).data.thresholds.critical).toBe(1);

    const created = await (await post('/api/v1/alerts', president.headers, {
      title: 'Threshold probe',
      category: 'governance_urgent',
      severity: 'critical',
    })).json();
    expect(created.data.ackDueAt).toBe('2026-01-15T09:01:00.000Z');
  });
});
