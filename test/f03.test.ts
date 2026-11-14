import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 03 — Tournament Formats & Blocked Mode', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  async function players(n: number) {
    const out: any[] = [];
    for (let i = 0; i < n; i++) out.push(await seedUser(ctx, { roles: ['member'] }));
    return out;
  }

  it('validates and stores a Swiss configuration', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const ps = await players(4);
    const res = await post('/api/v1/formats/configs', org.headers, {
      tournamentId: 'tour_1',
      format: 'swiss',
      rounds: 5,
      participantIds: ps.map((p) => p.user.id),
      timeControl: { initial: 600, increment: 0 },
    });
    expect(res.status).toBe(201);
    const data = (await res.json()).data;
    expect(data.status).toBe('validated');
    expect(data.rounds).toBe(5);
    expect(data.tieBreakers.length).toBeGreaterThan(0);
    expect(data.locked).toBe(false);
  });

  it('rejects format configuration by a plain member (403)', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/formats/configs', member.headers, {
      tournamentId: 'tour_1',
      format: 'swiss',
      participantIds: ['a', 'b'],
    });
    expect(res.status).toBe(403);
  });

  it('refuses offline mode and unconfigured kiosk mode (422)', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const offline = await post('/api/v1/formats/configs', org.headers, {
      tournamentId: 'tour_1',
      format: 'swiss',
      participantIds: ['a', 'b'],
      networkMode: 'offline',
    });
    expect(offline.status).toBe(422);

    const kiosk = await post('/api/v1/formats/configs', org.headers, {
      tournamentId: 'tour_2',
      format: 'swiss',
      participantIds: ['a', 'b'],
      blockedMode: { enabled: true, variant: 'managed_kiosk' },
    });
    expect(kiosk.status).toBe(422);

    const browser = await post('/api/v1/formats/configs', org.headers, {
      tournamentId: 'tour_3',
      format: 'swiss',
      participantIds: ['a', 'b'],
      blockedMode: { enabled: true, variant: 'browser_supervised' },
    });
    expect(browser.status).toBe(201);
    expect((await browser.json()).data.blockedMode.enforcedBy).toBe('browser_supervision_only');
  });

  it('generates deterministic round-robin pairings and refuses duplicates', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const ps = await players(4);
    const ids = ps.map((p) => p.user.id);
    const cfg = (await (
      await post('/api/v1/formats/configs', org.headers, { tournamentId: 'tour_1', format: 'round_robin', participantIds: ids })
    ).json()).data;
    expect(cfg.rounds).toBe(3);

    const res = await post(`/api/v1/formats/configs/${cfg.id}/pairings`, org.headers, { round: 1 });
    expect(res.status).toBe(201);
    const pairings = (await res.json()).data.pairings;
    expect(pairings.length).toBe(2);
    expect(pairings[0].whiteId).toBe(ids[0]);
    expect(pairings[0].blackId).toBe(ids[3]);
    expect(pairings[1].whiteId).toBe(ids[1]);
    expect(pairings[1].blackId).toBe(ids[2]);

    const dup = await post(`/api/v1/formats/configs/${cfg.id}/pairings`, org.headers, { round: 1 });
    expect(dup.status).toBe(409);
  });

  it('locks the format on the first official match and requires Blocked Mode', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const noBlocked = (await (
      await post('/api/v1/formats/configs', org.headers, { tournamentId: 'tour_1', format: 'swiss', participantIds: ['a', 'b'] })
    ).json()).data;
    const refused = await post(`/api/v1/formats/configs/${noBlocked.id}/start`, org.headers, { matchId: 'm_1' });
    expect(refused.status).toBe(409);

    const blocked = (await (
      await post('/api/v1/formats/configs', org.headers, {
        tournamentId: 'tour_2',
        format: 'swiss',
        participantIds: ['a', 'b'],
        blockedMode: { enabled: true, variant: 'browser_supervised' },
      })
    ).json()).data;
    const started = await post(`/api/v1/formats/configs/${blocked.id}/start`, org.headers, { matchId: 'm_1' });
    expect(started.status).toBe(200);
    expect((await started.json()).data.locked).toBe(true);

    const again = await post(`/api/v1/formats/configs/${blocked.id}/start`, org.headers, { matchId: 'm_2' });
    expect(again.status).toBe(409);
  });

  it('requires an independent approver to reset a locked format', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const cfg = (await (
      await post('/api/v1/formats/configs', org.headers, {
        tournamentId: 'tour_1',
        format: 'swiss',
        participantIds: ['a', 'b'],
        blockedMode: { enabled: true, variant: 'browser_supervised' },
      })
    ).json()).data;
    await post(`/api/v1/formats/configs/${cfg.id}/start`, org.headers, { matchId: 'm_1' });

    const req = await post(`/api/v1/formats/configs/${cfg.id}/reset`, org.headers, { reason: 'Wrong participant list' });
    expect(req.status).toBe(201);
    const reset = (await req.json()).data;

    const selfApprove = await post(`/api/v1/formats/configs/${cfg.id}/reset/${reset.id}/approve`, org.headers, {});
    expect(selfApprove.status).toBe(403);

    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const approved = await post(`/api/v1/formats/configs/${cfg.id}/reset/${reset.id}/approve`, admin.headers, {});
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.config.locked).toBe(false);
  });

  it('treats technical signals as organizer alerts, not proof of cheating', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const ps = await players(1);
    const res = await post('/api/v1/formats/matches/match_1/signals', ps[0].headers, { type: 'focus_lost', detail: { at: 'move 12' } });
    expect(res.status).toBe(201);
    const signal = (await res.json()).data;
    expect(signal.isProofOfCheating).toBe(false);
    expect(signal.automaticPenalty).toBe(false);
    expect(signal.organizerAlerted).toBe(true);

    const noReason = await post(`/api/v1/formats/signals/${signal.id}/decide`, org.headers, { decision: 'investigate' });
    expect(noReason.status).toBe(400);

    const decided = await post(`/api/v1/formats/signals/${signal.id}/decide`, org.headers, {
      decision: 'investigate',
      reason: 'Asked both players to stay in view',
    });
    expect(decided.status).toBe(200);
    const decidedBody = (await decided.json()).data;
    expect(decidedBody.status).toBe('reviewed');
    expect(decidedBody.automaticPenalty).toBe(false);

    const list = (await (await get('/api/v1/formats/matches/match_1/signals', org.headers)).json()).data;
    expect(list.items.length).toBe(1);
  });

  it('keeps spectators read-only, delayed and revocable', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const spectator = await seedUser(ctx, { roles: ['spectator'] });
    const req = await post('/api/v1/formats/matches/match_1/spectators', org.headers, { spectatorId: spectator.user.id });
    expect(req.status).toBe(201);
    const grant = (await req.json()).data;
    expect(grant.status).toBe('pending');
    expect(grant.readOnly).toBe(true);
    expect(grant.delaySeconds).toBe(300);

    const approved = await post(`/api/v1/formats/spectators/${grant.id}/approve`, org.headers, {});
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('approved');

    const revoked = await post(`/api/v1/formats/spectators/${grant.id}/revoke`, org.headers, { reason: 'Live state leak concern' });
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).data.status).toBe('revoked');
  });
});
