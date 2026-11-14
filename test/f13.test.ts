import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 13 — Achievements, Certificates & Recognition', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('issues a manual achievement with a reason and refuses one without', async () => {
    const coach = await seedUser(ctx, { roles: ['coach'] });
    const player = await seedUser(ctx, { roles: ['member'] });

    const noReason = await post('/api/v1/achievements/achievements', coach.headers, {
      recipientId: player.user.id, type: 'special_recognition', title: 'Club spirit',
    });
    expect(noReason.status).toBe(400);

    const res = await post('/api/v1/achievements/achievements', coach.headers, {
      recipientId: player.user.id, type: 'special_recognition', title: 'Club spirit', reason: 'Outstanding conduct at the state meet',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('approved');
    expect(body.data.reason).toBe('Outstanding conduct at the state meet');
  });

  it('keeps achievement issuance behind the achievement.issue permission', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const other = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/achievements/achievements', member.headers, {
      recipientId: other.user.id, type: 'special_recognition', title: 'Nope', reason: 'not allowed',
    });
    expect(res.status).toBe(403);
  });

  it('issues a certificate with a deterministic verification code and refuses a second one', async () => {
    const coach = await seedUser(ctx, { roles: ['coach'] });
    const player = await seedUser(ctx, { roles: ['member'] });
    const ach = (await (await post('/api/v1/achievements/achievements', coach.headers, {
      recipientId: player.user.id, type: 'tournament_placement', title: '1st place — SaiU Blitz Open',
      sourceType: 'verified_event', sourceId: 'tour_42',
    })).json()).data;

    const first = await post(`/api/v1/achievements/achievements/${ach.id}/certificate`, coach.headers, {});
    expect(first.status).toBe(201);
    const cert = (await first.json()).data;
    expect(cert.verificationCode).toMatch(/^SCC-[0-9A-F]{8}-[0-9A-F]{8}$/);
    expect(cert.templateVersion).toBe(1);

    const again = await post(`/api/v1/achievements/achievements/${ach.id}/certificate`, coach.headers, {});
    expect(again.status).toBe(409);
    expect((await again.json()).error.details.verificationCode).toBe(cert.verificationCode);
  });

  it('serves a privacy-minimised public verification page with no auth', async () => {
    const coach = await seedUser(ctx, { roles: ['coach'] });
    const player = await seedUser(ctx, { roles: ['member'], name: 'Aarav Menon', email: 'aarav@saiuniversity.edu.in' });
    const ach = (await (await post('/api/v1/achievements/achievements', coach.headers, {
      recipientId: player.user.id, type: 'championship', title: 'Club Champion 2026', sourceType: 'verified_event', sourceId: 'champ_26',
    })).json()).data;
    const cert = (await (await post(`/api/v1/achievements/achievements/${ach.id}/certificate`, coach.headers, {})).json()).data;

    const res = await get(`/api/v1/achievements/verify/${cert.verificationCode}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.valid).toBe(true);
    expect(body.data.holderName).toBe('Aarav Menon');
    expect(body.data.achievementTitle).toBe('Club Champion 2026');
    expect(body.data.email).toBeUndefined();
    expect(JSON.stringify(body.data)).not.toContain('saiuniversity.edu.in');

    expect((await get('/api/v1/achievements/verify/SCC-00000000-00000000')).status).toBe(404);
  });

  it('refuses a certificate for a disputed result and revokes an issued one', async () => {
    const coach = await seedUser(ctx, { roles: ['coach'] });
    const player = await seedUser(ctx, { roles: ['member'] });

    const disputedAch = (await (await post('/api/v1/achievements/achievements', coach.headers, {
      recipientId: player.user.id, type: 'tournament_placement', title: '2nd place — Inter-college', sourceType: 'verified_event', sourceId: 'ic_9',
    })).json()).data;
    await post(`/api/v1/achievements/achievements/${disputedAch.id}/dispute`, coach.headers, { reason: 'result under appeal' });
    const blocked = await post(`/api/v1/achievements/achievements/${disputedAch.id}/certificate`, coach.headers, {});
    expect(blocked.status).toBe(409);

    const good = (await (await post('/api/v1/achievements/achievements', coach.headers, {
      recipientId: player.user.id, type: 'learning_milestone', title: 'Completed endgame module', sourceType: 'verified_event', sourceId: 'lesson_7',
    })).json()).data;
    const cert = (await (await post(`/api/v1/achievements/achievements/${good.id}/certificate`, coach.headers, {})).json()).data;

    expect((await post(`/api/v1/achievements/certificates/${cert.id}/revoke`, coach.headers, {})).status).toBe(400);
    const revoked = await post(`/api/v1/achievements/certificates/${cert.id}/revoke`, coach.headers, { reason: 'issued in error' });
    expect(revoked.status).toBe(200);

    const verified = await (await get(`/api/v1/achievements/verify/${cert.verificationCode}`)).json();
    expect(verified.data.valid).toBe(false);
    expect(verified.data.status).toBe('revoked');
  });

  it('lists Hall of Fame entries only for recipients who consented', async () => {
    const coach = await seedUser(ctx, { roles: ['coach'] });
    const player = await seedUser(ctx, { roles: ['member'], name: 'Ishita Rao' });
    const ach = (await (await post('/api/v1/achievements/achievements', coach.headers, {
      recipientId: player.user.id, type: 'championship', title: 'Rapid Champion 2026', sourceType: 'verified_event', sourceId: 'rapid_26',
    })).json()).data;
    await post(`/api/v1/achievements/achievements/${ach.id}/certificate`, coach.headers, {});

    expect((await (await get('/api/v1/achievements/hall-of-fame')).json()).data.length).toBe(0);

    const other = await seedUser(ctx, { roles: ['member'] });
    expect((await post(`/api/v1/achievements/achievements/${ach.id}/consent`, other.headers, { consentPublic: true })).status).toBe(403);

    expect((await post(`/api/v1/achievements/achievements/${ach.id}/consent`, player.headers, { consentPublic: true })).status).toBe(200);

    const fame = await (await get('/api/v1/achievements/hall-of-fame')).json();
    expect(fame.data.length).toBe(1);
    expect(fame.data[0].holderName).toBe('Ishita Rao');
    expect(fame.data[0].certificateVerificationCode).toMatch(/^SCC-/);
  });

  it('requires independent approval for a nominated achievement', async () => {
    const coach = await seedUser(ctx, { roles: ['coach'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const player = await seedUser(ctx, { roles: ['member'] });

    const nom = (await (await post('/api/v1/achievements/achievements', coach.headers, {
      recipientId: player.user.id, type: 'volunteer_contribution', title: 'Tournament desk volunteer', sourceType: 'nomination',
    })).json()).data;
    expect(nom.status).toBe('nominated');

    expect((await post(`/api/v1/achievements/achievements/${nom.id}/certificate`, coach.headers, {})).status).toBe(409);
    expect((await post(`/api/v1/achievements/achievements/${nom.id}/approve`, coach.headers, { reason: 'self approval' })).status).toBe(403);

    const approved = await post(`/api/v1/achievements/achievements/${nom.id}/approve`, president.headers, { reason: 'verified with the organizing committee' });
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('approved');
  });
});
