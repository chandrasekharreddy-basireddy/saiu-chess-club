import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 41 — Legal Compliance, Privacy Governance & Data Protection', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('registers a versioned policy with an owner and effective date', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const res = await post('/api/v1/compliance/policies', admin.headers, {
      title: 'Privacy Notice',
      effectiveDate: '2026-02-01T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.version).toBe(1);
    expect(body.data.ownerId).toBe(admin.user.id);
    expect(body.data.status).toBe('draft');
    expect(body.data.effectiveDate).toBe('2026-02-01T00:00:00.000Z');

    const second = await (await post('/api/v1/compliance/policies', admin.headers, { title: 'Privacy Notice' })).json();
    expect(second.data.version).toBe(2);
  });

  it('refuses an unsupported legal-compliance claim and blocks unauthorised users', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const claim = await post('/api/v1/compliance/policies', admin.headers, {
      title: 'DPDP Attestation',
      claimsLegalCompliance: true,
    });
    expect(claim.status).toBe(400);

    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await post('/api/v1/compliance/policies', member.headers, { title: 'Nope' })).status).toBe(403);
    expect((await get('/api/v1/compliance/requests', member.headers)).status).toBe(403);
  });

  it('records and withdraws consent, and separates consent from mandatory processing', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const granted = await (await post('/api/v1/compliance/consents', member.headers, { purpose: 'newsletter' })).json();
    expect(granted.data.status).toBe('granted');
    expect(granted.data.basis).toBe('consent');

    const withdrawn = await post(`/api/v1/compliance/consents/${granted.data.id}/withdraw`, member.headers);
    expect(withdrawn.status).toBe(200);
    expect((await withdrawn.json()).data.status).toBe('withdrawn');

    const contract = await (await post('/api/v1/compliance/consents', member.headers, {
      purpose: 'membership_dues',
      basis: 'contract',
    })).json();
    const refused = await post(`/api/v1/compliance/consents/${contract.data.id}/withdraw`, member.headers);
    expect(refused.status).toBe(409);
  });

  it('runs a data-subject access request through its lifecycle with a tracked due date', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const officer = await seedUser(ctx, { roles: ['administrator'] });

    const created = await (await post('/api/v1/compliance/requests', member.headers, { type: 'access' })).json();
    expect(created.data.status).toBe('received');
    expect(created.data.dueAt).toBe('2026-02-14T09:00:00.000Z');
    const id = created.data.id;

    const skip = await post(`/api/v1/compliance/requests/${id}/transition`, officer.headers, { status: 'completed' });
    expect(skip.status).toBe(409);

    for (const status of ['identity_verified', 'scoped', 'reviewed', 'approved', 'completed']) {
      const step = await post(`/api/v1/compliance/requests/${id}/transition`, officer.headers, { status });
      expect(step.status).toBe(200);
    }
    const done = await (await get(`/api/v1/compliance/requests/${id}`, officer.headers)).json();
    expect(done.data.status).toBe('completed');
    expect(done.data.history.length).toBe(6);
    expect(done.data.overdue).toBe(false);
  });

  it('enforces separation of duties on request decisions', async () => {
    const officer = await seedUser(ctx, { roles: ['committee'], permissions: ['privacy.request.handle'] });
    const created = await (await post('/api/v1/compliance/requests', officer.headers, { type: 'export' })).json();
    const id = created.data.id;
    for (const status of ['identity_verified', 'scoped', 'reviewed']) {
      await post(`/api/v1/compliance/requests/${id}/transition`, officer.headers, { status });
    }
    const selfApproval = await post(`/api/v1/compliance/requests/${id}/transition`, officer.headers, { status: 'approved' });
    expect(selfApproval.status).toBe(403);
  });

  it('reviews erasure against legitimate recordkeeping obligations', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const officer = await seedUser(ctx, { roles: ['administrator'] });
    const created = await (await post('/api/v1/compliance/requests', member.headers, { type: 'erasure' })).json();
    const id = created.data.id;
    for (const status of ['identity_verified', 'scoped', 'reviewed']) {
      await post(`/api/v1/compliance/requests/${id}/transition`, officer.headers, { status });
    }
    const hold = await post(`/api/v1/compliance/requests/${id}/legal-hold`, officer.headers, {
      reason: 'Open dispute over club dues',
    });
    expect(hold.status).toBe(200);

    const blocked = await post(`/api/v1/compliance/requests/${id}/transition`, officer.headers, { status: 'approved' });
    expect(blocked.status).toBe(409);

    const noReason = await post(`/api/v1/compliance/requests/${id}/transition`, officer.headers, { status: 'denied' });
    expect(noReason.status).toBe(400);

    const denied = await post(`/api/v1/compliance/requests/${id}/transition`, officer.headers, {
      status: 'denied',
      reason: 'Recordkeeping obligation until the dispute closes',
    });
    expect(denied.status).toBe(200);
    expect((await denied.json()).data.status).toBe('denied');
  });

  it('requires a reviewed retention period and records incident escalation', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const unreviewed = await post('/api/v1/compliance/retention-rules', admin.headers, {
      dataCategory: 'tournament_results',
      retentionMonths: 60,
    });
    expect(unreviewed.status).toBe(422);

    const rule = await post('/api/v1/compliance/retention-rules', admin.headers, {
      dataCategory: 'tournament_results',
      retentionMonths: 60,
      reviewedBy: 'Legal Cell, SaiU',
    });
    expect(rule.status).toBe(201);
    expect((await rule.json()).data.retentionMonths).toBe(60);

    const incident = await (await post('/api/v1/compliance/incidents', admin.headers, {
      title: 'Mailing list copied to a personal drive',
      severity: 'high',
      personalDataInvolved: true,
    })).json();
    expect(incident.data.status).toBe('open');
    const escalated = await post(`/api/v1/compliance/incidents/${incident.data.id}/escalate`, admin.headers, {
      escalatedTo: 'Registrar, SaiU',
    });
    expect(escalated.status).toBe(200);
    expect((await escalated.json()).data.escalationLevel).toBe(1);
  });
});
