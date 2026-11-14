import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 42 — Cybersecurity & Security Operations', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('opens a security incident with severity, owner and containment status', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const res = await post('/api/v1/cyberops/incidents', admin.headers, {
      title: 'Repeated failed logins on treasurer account',
      severity: 'critical',
      ownerId: admin.user.id,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.severity).toBe('critical');
    expect(body.data.ownerId).toBe(admin.user.id);
    expect(body.data.containmentStatus).toBe('not_contained');
    expect(body.data.status).toBe('detected');
    expect(body.data.timeline.length).toBe(1);
  });

  it('rejects an incident without an owner and hides the register from members', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    expect((await post('/api/v1/cyberops/incidents', admin.headers, { title: 'Unattributed', severity: 'low' })).status).toBe(400);

    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await get('/api/v1/cyberops/incidents', member.headers)).status).toBe(403);
    expect((await post('/api/v1/cyberops/incidents', member.headers, { title: 'X', ownerId: 'x' })).status).toBe(403);
  });

  it('enforces the incident workflow and requires evidence references', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const id = (await (await post('/api/v1/cyberops/incidents', admin.headers, {
      title: 'Credential stuffing spike',
      severity: 'high',
      ownerId: admin.user.id,
    })).json()).data.id;

    const skip = await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, { status: 'closed' });
    expect(skip.status).toBe(409);

    expect((await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, { status: 'triaged' })).status).toBe(200);
    expect((await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, { status: 'classified' })).status).toBe(200);

    const contained = await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, { status: 'contained' });
    expect(contained.status).toBe(200);
    expect((await contained.json()).data.containmentStatus).toBe('contained');

    const noEvidence = await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, {
      status: 'evidence_preserved',
    });
    expect(noEvidence.status).toBe(422);

    const preserved = await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, {
      status: 'evidence_preserved',
      evidenceRefs: ['waf-log-2026-01-15.csv'],
    });
    expect(preserved.status).toBe(200);
    expect((await preserved.json()).data.evidenceRefs).toEqual(['waf-log-2026-01-15.csv']);
  });

  it('requires lessons before a post-incident review can be closed', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const id = (await (await post('/api/v1/cyberops/incidents', admin.headers, {
      title: 'Dependency advisory triage',
      severity: 'medium',
      ownerId: admin.user.id,
    })).json()).data.id;
    for (const status of ['triaged', 'classified', 'contained']) {
      await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, { status });
    }
    await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, {
      status: 'evidence_preserved',
      evidenceRefs: ['advisory-GHSA-xxxx'],
    });
    for (const status of ['investigating', 'recovered', 'notified']) {
      await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, { status });
    }
    const noLessons = await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, { status: 'reviewed' });
    expect(noLessons.status).toBe(422);

    const reviewed = await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, {
      status: 'reviewed',
      lessons: 'Pin dependencies and review advisories monthly',
    });
    expect(reviewed.status).toBe(200);
    expect((await reviewed.json()).data.lessons).toContain('Pin dependencies');

    const closed = await post(`/api/v1/cyberops/incidents/${id}/transition`, admin.headers, { status: 'closed' });
    expect(closed.status).toBe(200);
    expect((await closed.json()).data.closedAt).toBeTruthy();
  });

  it('treats a Blocked Mode signal as advisory, never as proof of cheating', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const alert = await (await post('/api/v1/cyberops/alerts', admin.headers, {
      title: 'Blocked Mode triggered in arena session',
      signal: 'technical_blocked_mode',
      severity: 'low',
      ownerId: admin.user.id,
    })).json();
    expect(alert.data.advisoryOnly).toBe(true);
    expect(alert.data.conclusiveCheating).toBe(false);
    expect(alert.data.requiresHumanReview).toBe(true);

    const conclusive = await post(`/api/v1/cyberops/alerts/${alert.data.id}/escalate`, admin.headers, {
      conclusiveCheating: true,
    });
    expect(conclusive.status).toBe(400);

    const escalated = await post(`/api/v1/cyberops/alerts/${alert.data.id}/escalate`, admin.headers, {
      category: 'integrity_review',
    });
    expect(escalated.status).toBe(201);
    const body = await escalated.json();
    expect(body.data.incident.advisoryOnly).toBe(true);
    expect(body.data.alert.status).toBe('escalated');
  });

  it('rotates a secret without accepting or storing its value', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const withValue = await post('/api/v1/cyberops/secrets/rotate', admin.headers, {
      name: 'SARVAM_API_KEY',
      value: 'sk-live-should-never-be-stored',
    });
    expect(withValue.status).toBe(400);

    const rotated = await post('/api/v1/cyberops/secrets/rotate', admin.headers, {
      name: 'SARVAM_API_KEY',
      reason: 'Quarterly rotation',
    });
    expect(rotated.status).toBe(201);
    const body = await rotated.json();
    expect(body.data.name).toBe('SARVAM_API_KEY');
    expect(body.data.storedValue).toBeNull();
    expect(body.data.rotatedAt).toBe('2026-01-15T09:00:00.000Z');
  });

  it('tracks vulnerability remediation and privileged account reviews', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const vuln = await (await post('/api/v1/cyberops/vulnerabilities', admin.headers, {
      component: 'hono@4.6.3',
      advisoryRef: 'GHSA-2026-0001',
      severity: 'high',
    })).json();
    expect(vuln.data.status).toBe('open');

    const noRef = await post(`/api/v1/cyberops/vulnerabilities/${vuln.data.id}/remediate`, admin.headers, {});
    expect(noRef.status).toBe(400);

    const remediated = await post(`/api/v1/cyberops/vulnerabilities/${vuln.data.id}/remediate`, admin.headers, {
      remediationRef: 'hono@4.6.7',
    });
    expect(remediated.status).toBe(200);
    expect((await remediated.json()).data.status).toBe('remediated');

    const review = await post('/api/v1/cyberops/privileged-reviews', admin.headers, {
      accountId: admin.user.id,
      outcome: 'reduced',
      notes: 'Quarterly review: admin rights narrowed to club scope',
    });
    expect(review.status).toBe(201);
    expect((await review.json()).data.outcome).toBe('reduced');
    expect((await (await get('/api/v1/cyberops/privileged-reviews', admin.headers)).json()).data.length).toBe(1);
  });
});
