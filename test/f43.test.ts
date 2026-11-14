import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 43 — Disaster Recovery & Emergency Operations', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const planBody = {
    name: 'Platform restore plan',
    rpoMinutes: 60,
    rtoMinutes: 240,
    evidenceRef: 'backup-restore-test-2026-01',
  };

  it('creates a recovery plan with RPO/RTO minutes and evidence', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const res = await post('/api/v1/recovery/plans', admin.headers, planBody);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.rpoMinutes).toBe(60);
    expect(body.data.rtoMinutes).toBe(240);
    expect(body.data.evidenceRef).toBe('backup-restore-test-2026-01');
    expect(body.data.status).toBe('draft');
    expect(body.data.drillLog).toEqual([]);
  });

  it('refuses recovery claims that are not evidence-based', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const noEvidence = await post('/api/v1/recovery/plans', admin.headers, {
      name: 'Wishful plan',
      rpoMinutes: 0,
      rtoMinutes: 30,
    });
    expect(noEvidence.status).toBe(422);

    const badRto = await post('/api/v1/recovery/plans', admin.headers, { ...planBody, rtoMinutes: 0 });
    expect(badRto.status).toBe(400);
  });

  it('blocks members and enforces separation of duties on plan approval', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const id = (await (await post('/api/v1/recovery/plans', admin.headers, planBody)).json()).data.id;

    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await get('/api/v1/recovery/plans', member.headers)).status).toBe(403);

    const selfApproval = await post(`/api/v1/recovery/plans/${id}/approve`, admin.headers, {});
    expect(selfApproval.status).toBe(403);

    const other = await seedUser(ctx, { roles: ['administrator'] });
    const approved = await post(`/api/v1/recovery/plans/${id}/approve`, other.headers, { note: 'Backup test reviewed' });
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('approved');
  });

  it('records drills, requires improvements when the RTO is missed, and logs the drill', async () => {
    const author = await seedUser(ctx, { roles: ['administrator'] });
    const approver = await seedUser(ctx, { roles: ['administrator'] });
    const id = (await (await post('/api/v1/recovery/plans', author.headers, planBody)).json()).data.id;

    const beforeApproval = await post(`/api/v1/recovery/plans/${id}/drills`, approver.headers, {
      actualRtoMinutes: 120,
      improvements: ['Shorten restore runbook'],
    });
    expect(beforeApproval.status).toBe(409);

    await post(`/api/v1/recovery/plans/${id}/approve`, approver.headers, {});

    const breachNoImprovements = await post(`/api/v1/recovery/plans/${id}/drills`, approver.headers, {
      actualRtoMinutes: 300,
      actualRpoMinutes: 60,
    });
    expect(breachNoImprovements.status).toBe(400);

    const drill = await post(`/api/v1/recovery/plans/${id}/drills`, approver.headers, {
      actualRtoMinutes: 300,
      actualRpoMinutes: 60,
      lessons: 'Restore of the tournament tables was the slow step',
      improvements: ['Pre-stage a verified database dump', 'Automate the restore check'],
    });
    expect(drill.status).toBe(201);
    const drillBody = await drill.json();
    expect(drillBody.data.rtoBreached).toBe(true);
    expect(drillBody.data.targetRtoMinutes).toBe(240);
    expect(drillBody.data.improvementCount).toBe(2);

    const plan = await (await get(`/api/v1/recovery/plans/${id}`, approver.headers)).json();
    expect(plan.data.drillCount).toBe(1);
    expect(plan.data.rtoBreached).toBe(true);
    expect(plan.data.lastActualRtoMinutes).toBe(300);
  });

  it('exposes the incident command view with explicit recovery priorities', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    await post('/api/v1/recovery/contacts', admin.headers, {
      role: 'Incident commander',
      name: 'Club Secretary',
      contact: '+91-90000-00000',
    });
    const view = await (await get('/api/v1/recovery/command', admin.headers)).json();
    expect(view.data.priorities.length).toBe(6);
    expect(view.data.priorities[0].rank).toBe(1);
    expect(view.data.priorities[0].priority).toContain('account security');
    expect(view.data.contacts.length).toBe(1);
    expect(view.data.offlineFallbacks.length).toBeGreaterThan(0);
    expect(view.data.claims.evidenceBased).toBe(false);
  });

  it('pauses a tournament for continuity without awarding walkovers', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const res = await post('/api/v1/recovery/continuity/pause', admin.headers, {
      tournamentId: 'tour_123',
      reason: 'Database provider outage during round 4',
      preservedStateRef: 'round-4-confirmed-results',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.walkoverAwarded).toBe(false);
    expect(body.data.manualDecisionRecorded).toBe(true);
    expect(body.data.status).toBe('paused');

    const noNote = await post(`/api/v1/recovery/continuity/${body.data.id}/reconcile`, admin.headers, {});
    expect(noNote.status).toBe(400);

    const reconciled = await post(`/api/v1/recovery/continuity/${body.data.id}/reconcile`, admin.headers, {
      reconciliationNote: 'Paper score sheets transcribed; no results changed',
    });
    expect(reconciled.status).toBe(200);
    expect((await reconciled.json()).data.status).toBe('reconciled');
  });
});
