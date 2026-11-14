import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 05 — Chess Arena & Game Modes', () => {
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

  it('creates a friendly game with no rating impact and a classified time control', async () => {
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/arena/games', a.headers, {
      mode: 'friendly',
      opponentId: b.user.id,
      timeControl: { initial: 300, increment: 3 },
    });
    expect(res.status).toBe(201);
    const { game } = (await res.json()).data;
    expect(game.status).toBe('ready');
    expect(game.ratingImpact).toBe(false);
    expect(game.timeControl.category).toBe('blitz');
    expect(game.timeControl.label).toBe('5+3');
  });

  it('blocks self-play and refuses ordinary creation of an official game', async () => {
    const a = await seedUser(ctx, { roles: ['member'] });
    const self = await post('/api/v1/arena/games', a.headers, { mode: 'friendly', opponentId: a.user.id });
    expect(self.status).toBe(400);

    const official = await post('/api/v1/arena/games', a.headers, { mode: 'official', timeControl: { initial: 600, increment: 0 } });
    expect(official.status).toBe(422);

    const bullet = await post('/api/v1/arena/games', a.headers, { mode: 'practice', timeControl: { initial: 60, increment: 0 } });
    expect(bullet.status).toBe(201);
    expect((await bullet.json()).data.game.timeControl.category).toBe('bullet');

    const bad = await post('/api/v1/arena/games', a.headers, { mode: 'friendly', timeControl: { initial: 10, increment: 0 } });
    expect(bad.status).toBe(400);
  });

  it('starts a private game only after the invitee accepts the invitation', async () => {
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const stranger = await seedUser(ctx, { roles: ['member'] });

    const res = await post('/api/v1/arena/games', a.headers, { mode: 'private', opponentId: b.user.id, timeControl: { initial: 600, increment: 0 } });
    expect(res.status).toBe(201);
    const { game, invitation } = (await res.json()).data;
    expect(game.status).toBe('awaiting_invitation');
    expect(invitation.status).toBe('pending');

    const earlyStart = await post(`/api/v1/arena/games/${game.id}/start`, a.headers);
    expect(earlyStart.status).toBe(409);

    const wrongUser = await post(`/api/v1/arena/invitations/${invitation.id}/accept`, stranger.headers);
    expect(wrongUser.status).toBe(403);

    const accepted = await post(`/api/v1/arena/invitations/${invitation.id}/accept`, b.headers);
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).data.game.status).toBe('ready');

    const started = await post(`/api/v1/arena/games/${game.id}/start`, a.headers);
    expect(started.status).toBe(200);
    expect((await started.json()).data.status).toBe('live');
  });

  it('applies rating impact once, only after a valid finalisation, and stores the PGN', async () => {
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const game = (await (
      await post('/api/v1/arena/games', a.headers, { mode: 'rated', opponentId: b.user.id, timeControl: { initial: 600, increment: 0 } })
    ).json()).data.game;
    await post(`/api/v1/arena/games/${game.id}/start`, a.headers);

    const midGame = (await (await get(`/api/v1/arena/games/${game.id}`, a.headers)).json()).data;
    expect(midGame.ratingApplied).toBe(false);

    const done = await post(`/api/v1/arena/games/${game.id}/finalize`, a.headers, { result: 'white', moves: ['e4', 'e5', 'Qh5'] });
    expect(done.status).toBe(200);
    const finished = (await done.json()).data;
    expect(finished.status).toBe('completed');
    expect(finished.ratingApplied).toBe(true);
    expect(finished.ratingPipelineStatus).toBe('queued');
    expect(finished.pgn).toContain('1. e4 e5 2. Qh5');
    expect(finished.pgn).toContain('1-0');

    const twice = await post(`/api/v1/arena/games/${game.id}/finalize`, a.headers, { result: 'draw' });
    expect(twice.status).toBe(409);

    const pgn = (await (await get(`/api/v1/arena/games/${game.id}/pgn`, b.headers)).json()).data;
    expect(pgn.pgn).toBe(finished.pgn);

    const hist = (await (await get('/api/v1/arena/history', a.headers)).json()).data;
    expect(hist.total).toBe(1);
  });

  it('never applies rating to friendly or practice games', async () => {
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const game = (await (
      await post('/api/v1/arena/games', a.headers, { mode: 'practice', opponentId: b.user.id, timeControl: { initial: 180, increment: 0 } })
    ).json()).data.game;
    await post(`/api/v1/arena/games/${game.id}/start`, a.headers);
    const done = (await (await post(`/api/v1/arena/games/${game.id}/finalize`, a.headers, { result: 'draw', pgn: '[Result "1/2-1/2"]' })).json()).data;
    expect(done.ratingApplied).toBe(false);
    expect(done.ratingPipelineStatus).toBe('not_applicable');
  });

  it('records disconnects with documented clock behaviour and resyncs on reconnect', async () => {
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const game = (await (
      await post('/api/v1/arena/games', a.headers, { mode: 'rated', opponentId: b.user.id, timeControl: { initial: 900, increment: 10 } })
    ).json()).data.game;
    await post(`/api/v1/arena/games/${game.id}/start`, a.headers);

    const off = (await (await post(`/api/v1/arena/games/${game.id}/disconnect`, a.headers)).json()).data;
    expect(off.clockBehavior).toBe('clock_runs_while_disconnected');
    expect(off.game.disconnectedSide).toBe('white');
    expect(off.clock.whiteMs).toBe(900_000);

    const back = (await (await post(`/api/v1/arena/games/${game.id}/reconnect`, a.headers)).json()).data;
    expect(back.game.disconnectedSide).toBeNull();
    expect(back.authoritative).toBe(true);
  });

  it('treats behaviour reports as submissions for staff review, never automatic findings', async () => {
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const game = (await (
      await post('/api/v1/arena/games', a.headers, { mode: 'friendly', opponentId: b.user.id, timeControl: { initial: 300, increment: 0 } })
    ).json()).data.game;

    const report = await post(`/api/v1/arena/games/${game.id}/reports`, b.headers, {
      category: 'suspected_engine',
      detail: 'Moved instantly for 20 moves',
    });
    expect(report.status).toBe(201);
    const body = (await report.json()).data;
    expect(body.status).toBe('submitted');
    expect(body.isFinding).toBe(false);
    expect(body.sanctionApplied).toBe(false);

    const memberReview = await post(`/api/v1/arena/reports/${body.id}/review`, a.headers, { outcome: 'warning_issued', note: 'x' });
    expect(memberReview.status).toBe(403);

    const org = await seedUser(ctx, { roles: ['organizer'] });
    const reviewed = await post(`/api/v1/arena/reports/${body.id}/review`, org.headers, {
      outcome: 'referred',
      note: 'Passed to the fair-play committee',
    });
    expect(reviewed.status).toBe(200);
    const reviewedBody = (await reviewed.json()).data;
    expect(reviewedBody.status).toBe('reviewed');
    expect(reviewedBody.outcome).toBe('referred');
    expect(reviewedBody.sanctionApplied).toBe(false);
  });
});
