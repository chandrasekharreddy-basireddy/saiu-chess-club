import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 15 — Alumni & Legacy Network', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const patch = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  async function submittedRequest(user: any, email = 'old.alumni@gmail.com') {
    const res = await post('/api/v1/alumni/requests', user.headers, { contactEmail: email, graduationYear: 2023, programme: 'B.Tech CSE' });
    return { status: res.status, request: (await res.json()).data };
  }

  async function verifiedRequest(user: any) {
    const { request } = await submittedRequest(user);
    await post(`/api/v1/alumni/requests/${request.id}/verify-contact`, user.headers, { code: request.verificationCode });
    return request;
  }

  it('requires a valid contact email to open an alumni access request', async () => {
    const user = await seedUser(ctx, { roles: ['member'] });
    expect((await post('/api/v1/alumni/requests', user.headers, { graduationYear: 2023 })).status).toBe(400);
    expect((await post('/api/v1/alumni/requests', user.headers, { contactEmail: 'not-an-email' })).status).toBe(400);

    const { status, request } = await submittedRequest(user);
    expect(status).toBe(201);
    expect(request.status).toBe('pending_verification');
    expect(request.contactEmailVerified).toBe(false);
  });

  it('refuses approval until the contact email is verified, and checks the code', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const user = await seedUser(ctx, { roles: ['member'] });
    const { request } = await submittedRequest(user);

    const early = await post(`/api/v1/alumni/requests/${request.id}/approve`, admin.headers, { reason: 'ok' });
    expect(early.status).toBe(409);

    const wrong = await post(`/api/v1/alumni/requests/${request.id}/verify-contact`, user.headers, { code: 'ALU-DEADBEEF' });
    expect(wrong.status).toBe(400);

    const verified = await post(`/api/v1/alumni/requests/${request.id}/verify-contact`, user.headers, { code: request.verificationCode });
    expect(verified.status).toBe(200);
    expect((await verified.json()).data.status).toBe('pending_approval');
  });

  it('blocks an applicant from approving their own request (separation of duties)', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const own = await verifiedRequest(admin);
    const res = await post(`/api/v1/alumni/requests/${own.id}/approve`, admin.headers, { reason: 'self' });
    expect(res.status).toBe(403);
    expect((await repo.get('alumni_access_requests', own.id)).status).toBe('pending_approval');
  });

  it('approves alumni status through a different administrator, permanently and without touching permissions', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const user = await seedUser(ctx, { roles: ['member'] });
    const before = await repo.get('users', user.user.id);
    const request = await verifiedRequest(user);

    const res = await post(`/api/v1/alumni/requests/${request.id}/approve`, admin.headers, { reason: 'verified against 2023 batch list' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.request.status).toBe('approved');
    expect(body.data.profile.status).toBe('active');
    expect(body.data.profile.approvedBy).toBe(admin.user.id);
    // permanence: approval carries no expiry
    expect(body.data.profile.expiresAt).toBeUndefined();
    expect(body.data.profile.effectiveTo).toBeUndefined();

    const after = await repo.get('users', user.user.id);
    expect(after.roles).toEqual(before.roles);
    expect(after.permissions).toEqual(before.permissions);
  });

  it('keeps approval away from members without alumni.manage', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const applicant = await seedUser(ctx, { roles: ['member'] });
    const request = await verifiedRequest(applicant);
    expect((await post(`/api/v1/alumni/requests/${request.id}/approve`, member.headers, { reason: 'x' })).status).toBe(403);
    expect((await get('/api/v1/alumni/requests', member.headers)).status).toBe(403);
  });

  it('exposes the directory only with consent, hiding contact details by default', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const user = await seedUser(ctx, { roles: ['member'], name: 'Neha Kulkarni' });
    const request = await verifiedRequest(user);
    await post(`/api/v1/alumni/requests/${request.id}/approve`, admin.headers, { reason: 'ok' });

    const viewer = await seedUser(ctx, { roles: ['member'] });
    const listed = await (await get('/api/v1/alumni/directory', viewer.headers)).json();
    expect(listed.data.length).toBe(1);
    expect(listed.data[0].displayName).toBe('Neha Kulkarni');
    expect(listed.data[0].contactEmail).toBeUndefined();

    const shared = await patch('/api/v1/alumni/profiles/me', user.headers, { shareContact: true, headline: 'Chess coach' });
    expect(shared.status).toBe(200);
    const listed2 = await (await get('/api/v1/alumni/directory', viewer.headers)).json();
    expect(listed2.data[0].contactEmail).toBe('old.alumni@gmail.com');
    expect(listed2.data[0].headline).toBe('Chess coach');

    await patch('/api/v1/alumni/profiles/me', user.headers, { directoryVisible: false });
    const listed3 = await (await get('/api/v1/alumni/directory', viewer.headers)).json();
    expect(listed3.data.length).toBe(0);
  });

  it('revokes alumni status and keeps historical records attributed to the same account', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const user = await seedUser(ctx, { roles: ['member'], name: 'Rohan Iyer' });
    const request = await verifiedRequest(user);
    const approved = (await (await post(`/api/v1/alumni/requests/${request.id}/approve`, admin.headers, { reason: 'ok' })).json()).data;

    await post('/api/v1/alumni/history', admin.headers, {
      title: 'SaiU Open 2019 — Champion', year: 2019, category: 'champion', attributedUserId: user.user.id,
    });
    const mine = await (await get('/api/v1/alumni/history/mine', user.headers)).json();
    expect(mine.data.length).toBe(1);

    expect((await post(`/api/v1/alumni/profiles/${approved.profile.id}/revoke`, admin.headers, {})).status).toBe(400);
    const revoked = await post(`/api/v1/alumni/profiles/${approved.profile.id}/revoke`, admin.headers, { reason: 'eligibility withdrawn' });
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).data.status).toBe('revoked');

    const viewer = await seedUser(ctx, { roles: ['member'] });
    expect((await (await get('/api/v1/alumni/directory', viewer.headers)).json()).data.length).toBe(0);

    // history survives the status change
    const stillMine = await (await get('/api/v1/alumni/history/mine', user.headers)).json();
    expect(stillMine.data[0].title).toBe('SaiU Open 2019 — Champion');
  });
});
