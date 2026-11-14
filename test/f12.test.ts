import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 12 — Club Membership & Student Community', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  /** Administrator seeds the university domain allowlist and the membership categories. */
  async function setup() {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    await post('/api/v1/membership/allowlist', admin.headers, { domain: 'saiuniversity.edu.in', applicantType: 'student' });
    await post('/api/v1/membership/categories', admin.headers, { code: 'club-standard', name: 'Standard Club Membership', mode: 'approval' });
    await post('/api/v1/membership/categories', admin.headers, { code: 'open-drive', name: 'Open Drive Membership', mode: 'automatic' });
    return admin;
  }

  it('admits an eligible student automatically under an automatic category', async () => {
    await setup();
    const student = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/membership/applications', student.headers, {
      category: 'open-drive', applicantType: 'student', termsAccepted: true,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('active');
    expect(body.data.eligibilityStatus).toBe('eligible');
    expect(body.data.effectiveFrom).toBeTruthy();
    expect(body.data.effectiveTo).toBeTruthy();
  });

  it('rejects an applicant whose email domain is not on the allowlist', async () => {
    await setup();
    const outsider = await seedUser(ctx, { roles: ['member'], email: 'outsider@gmail.com' });
    const res = await post('/api/v1/membership/applications', outsider.headers, {
      category: 'open-drive', applicantType: 'student', termsAccepted: true,
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.details.reason).toBe('email_domain_not_allowlisted');
    expect(await repo.count('membership_applications', { applicantId: outsider.user.id })).toBe(0);
  });

  it('requires membership terms to be accepted', async () => {
    await setup();
    const student = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/membership/applications', student.headers, { category: 'club-standard' });
    expect(res.status).toBe(400);
  });

  it('runs the approval lifecycle: submit, queue, independent approval, active membership', async () => {
    const admin = await setup();
    const student = await seedUser(ctx, { roles: ['member'] });
    const reviewer = await seedUser(ctx, { roles: ['committee'], permissions: ['membership.approve'] });

    const submitted = await post('/api/v1/membership/applications', student.headers, {
      category: 'club-standard', applicantType: 'student', termsAccepted: true,
    });
    expect(submitted.status).toBe(201);
    const application = (await submitted.json()).data;
    expect(application.status).toBe('pending_review');

    const queue = await (await get('/api/v1/membership/applications?status=pending_review', reviewer.headers)).json();
    expect(queue.data.total).toBe(1);

    const decided = await post(`/api/v1/membership/applications/${application.id}/decide`, reviewer.headers, {
      decision: 'approve', reason: 'verified over the board',
    });
    expect(decided.status).toBe(200);
    const active = (await decided.json()).data;
    expect(active.status).toBe('active');
    expect(active.decidedBy).toBe(reviewer.user.id);

    // membership status is reported separately from account eligibility
    const mine = await (await get('/api/v1/membership/me', student.headers)).json();
    expect(mine.data.membershipStatus).toBe('active');
    expect(mine.data.eligibilityStatus).toBe('eligible');
    expect(admin.user.id).toBeTruthy();
  });

  it('blocks self-approval of a membership application', async () => {
    await setup();
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const own = (await (await post('/api/v1/membership/applications', admin.headers, {
      category: 'club-standard', applicantType: 'student', termsAccepted: true,
    })).json()).data;
    const res = await post(`/api/v1/membership/applications/${own.id}/decide`, admin.headers, { decision: 'approve' });
    expect(res.status).toBe(403);
    expect((await repo.get('membership_applications', own.id)).status).toBe('pending_review');
  });

  it('hides the review queue from members and blocks duplicate applications', async () => {
    await setup();
    const student = await seedUser(ctx, { roles: ['member'] });
    const first = await post('/api/v1/membership/applications', student.headers, {
      category: 'club-standard', applicantType: 'student', termsAccepted: true,
    });
    expect(first.status).toBe(201);

    expect((await get('/api/v1/membership/applications', student.headers)).status).toBe(403);

    const dupe = await post('/api/v1/membership/applications', student.headers, {
      category: 'club-standard', applicantType: 'student', termsAccepted: true,
    });
    expect(dupe.status).toBe(409);
  });

  it('keeps the alumni path separate from the student allowlist entry', async () => {
    await setup();
    const alumnus = await seedUser(ctx, { roles: ['alumnus'] });
    const res = await post('/api/v1/membership/applications', alumnus.headers, {
      category: 'club-standard', applicantType: 'alumni', termsAccepted: true,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.details.reason).toBe('domain_not_allowed_for_applicant_type');

    const admin = await seedUser(ctx, { roles: ['administrator'] });
    await post('/api/v1/membership/allowlist', admin.headers, { domain: 'saiuniversity.edu.in', applicantType: 'alumni' });
    const ok2 = await post('/api/v1/membership/applications', alumnus.headers, {
      category: 'club-standard', applicantType: 'alumni', termsAccepted: true,
    });
    expect(ok2.status).toBe(201);
    expect((await ok2.json()).data.status).toBe('pending_review');
  });
});
