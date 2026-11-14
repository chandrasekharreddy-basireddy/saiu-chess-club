import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';
import { createSession, hashPassword } from '../src/core/auth.js';

describe('Feature 36 — Privacy, Security & Account Protection', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    repo = h.repo;
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
  const del = (path: string, headers: any = {}) => app.request(path, { method: 'DELETE', headers });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('lists own sessions and revokes the others so they stop working across APIs', async () => {
    const u = await seedUser(ctx, { roles: ['member'] });
    const extra = await createSession(ctx, u.user.id);

    const list = await get('/api/v1/security/sessions', u.headers);
    expect(list.status).toBe(200);
    const listed = await list.json();
    expect(listed.data.sessions.length).toBe(2);
    expect(listed.data.sessions.filter((s: any) => s.current).length).toBe(1);
    expect(JSON.stringify(listed.data.sessions)).not.toContain('token');

    const revokedAll = await del('/api/v1/security/sessions', u.headers);
    expect(revokedAll.status).toBe(200);
    expect((await revokedAll.json()).data.revoked).toBe(1);

    // the revoked token is rejected by every API from now on
    const stale = await get('/api/v1/security/privacy', { authorization: `Bearer ${extra.token}` });
    expect(stale.status).toBe(401);
    // the current session still works
    expect((await get('/api/v1/security/privacy', u.headers)).status).toBe(200);
  });

  it('only lets an admin revoke somebody else\'s session', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const victim = await seedUser(ctx, { roles: ['member'] });
    const victimSessions = await repo.find('sessions', { userId: victim.user.id });

    const denied = await del(`/api/v1/security/sessions/${victimSessions[0].id}`, member.headers);
    expect(denied.status).toBe(403);

    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const allowed = await del(`/api/v1/security/sessions/${victimSessions[0].id}`, admin.headers);
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data.channels).toContain('websocket');
  });

  it('locks an account after five failed sign-in attempts and refuses while cooling', async () => {
    const email = 'locked@saiuniversity.edu.in';
    for (let i = 0; i < 4; i += 1) {
      const res = await post('/api/v1/security/login-attempts', {}, { email });
      expect(res.status).toBe(200);
    }
    const fifth = await post('/api/v1/security/login-attempts', {}, { email });
    expect(fifth.status).toBe(200);
    const locked = (await fifth.json()).data;
    expect(locked.locked).toBe(true);
    expect(locked.lockedUntil).toBeTruthy();
    expect(locked.remaining).toBe(0);

    const sixth = await post('/api/v1/security/login-attempts', {}, { email });
    expect(sixth.status).toBe(429);

    // once the cooling period has elapsed the counter starts again
    const row = await repo.findOne('security_login_attempts', { email });
    await repo.update('security_login_attempts', row.id, { lockedUntil: '2020-01-01T00:00:00.000Z', failures: 5 });
    const afterCooling = await post('/api/v1/security/login-attempts', {}, { email });
    expect(afterCooling.status).toBe(200);
    expect((await afterCooling.json()).data.locked).toBe(false);
  });

  it('defaults protected fields to private and refuses retention overrides', async () => {
    const u = await seedUser(ctx, { roles: ['member'] });
    const before = await (await get('/api/v1/security/privacy', u.headers)).json();
    expect(before.data.profileVisibility).toBe('private');
    expect(before.data.showEmail).toBe(false);

    const upd = await put('/api/v1/security/privacy', u.headers, { profileVisibility: 'members', showRating: true });
    expect(upd.status).toBe(200);
    expect((await upd.json()).data.showRating).toBe(true);

    expect((await put('/api/v1/security/privacy', u.headers, { profileVisibility: 'secret' })).status).toBe(400);
    expect((await put('/api/v1/security/privacy', u.headers, { retentionOverride: true })).status).toBe(422);
  });

  it('restricts role assignment to security.role.assign and blocks self-escalation', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const target = await seedUser(ctx, { roles: ['member'] });

    const denied = await post('/api/v1/security/roles/assign', member.headers, { userId: target.user.id, roles: ['organizer'] });
    expect(denied.status).toBe(403);

    const granted = await post('/api/v1/security/roles/assign', admin.headers, { userId: target.user.id, roles: ['organizer'] });
    expect(granted.status).toBe(200);
    expect((await granted.json()).data.roles).toEqual(['organizer']);
    expect((await repo.get('users', target.user.id)).roles).toEqual(['organizer']);

    const self = await post('/api/v1/security/roles/assign', admin.headers, { userId: admin.user.id, roles: ['member'] });
    expect(self.status).toBe(403);

    const unknown = await post('/api/v1/security/roles/assign', admin.headers, { userId: target.user.id, roles: ['wizard'] });
    expect(unknown.status).toBe(422);
  });

  it('requires reauthentication for password change and for MFA recovery', async () => {
    const u = await seedUser(ctx, { roles: ['member'] });
    await repo.update('users', u.user.id, { passwordHash: await hashPassword('S3cret!pass') });

    const wrong = await post('/api/v1/security/password/change', u.headers, { currentPassword: 'nope', newPassword: 'N3wpass!!' });
    expect(wrong.status).toBe(403);
    const short = await post('/api/v1/security/password/change', u.headers, { currentPassword: 'S3cret!pass', newPassword: 'short' });
    expect(short.status).toBe(400);
    const changed = await post('/api/v1/security/password/change', u.headers, { currentPassword: 'S3cret!pass', newPassword: 'N3wpass!!' });
    expect(changed.status).toBe(200);

    const enabled = await post('/api/v1/security/mfa/enable', u.headers, { method: 'totp' });
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).data.enabled).toBe(true);
    // MFA recovery is controlled: disabling needs the password again
    expect((await post('/api/v1/security/mfa/disable', u.headers, {})).status).toBe(400);
    expect((await post('/api/v1/security/mfa/disable', u.headers, { password: 'wrong-one' })).status).toBe(403);
  });

  it('routes account requests through a review workflow and keeps telemetry privileged', async () => {
    const u = await seedUser(ctx, { roles: ['member'] });
    const admin = await seedUser(ctx, { roles: ['administrator'] });

    const req = await post('/api/v1/security/requests', u.headers, { type: 'data_access' });
    expect(req.status).toBe(201);
    const request = (await req.json()).data;
    expect(request.status).toBe('pending');

    expect((await post(`/api/v1/security/requests/${request.id}/review`, u.headers, { decision: 'approved' })).status).toBe(403);
    const reviewed = await post(`/api/v1/security/requests/${request.id}/review`, admin.headers, { decision: 'approved' });
    expect(reviewed.status).toBe(200);
    expect((await reviewed.json()).data.status).toBe('approved');

    expect((await post('/api/v1/security/requests', u.headers, { type: 'nonsense' })).status).toBe(400);

    // ordinary users must not read sensitive security telemetry
    expect((await get('/api/v1/security/events', u.headers)).status).toBe(403);
    expect((await get('/api/v1/security/events', admin.headers)).status).toBe(200);
  });

  it('supports blocked-user controls', async () => {
    const u = await seedUser(ctx, { roles: ['member'] });
    const other = await seedUser(ctx, { roles: ['member'] });

    expect((await post(`/api/v1/security/users/${other.user.id}/block`, u.headers)).status).toBe(201);
    expect((await post(`/api/v1/security/users/${other.user.id}/block`, u.headers)).status).toBe(409);
    expect((await post(`/api/v1/security/users/${u.user.id}/block`, u.headers)).status).toBe(400);
    expect((await (await get('/api/v1/security/blocked', u.headers)).json()).data.length).toBe(1);
    expect((await del(`/api/v1/security/users/${other.user.id}/block`, u.headers)).status).toBe(200);
  });
});
