import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 04 — Match Experience & Result Management', () => {
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

  /** Creates a match and walks it to `live`. */
  async function liveMatch(opts: { spectatorDelaySeconds?: number } = {}) {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const white = await seedUser(ctx, { roles: ['member'] });
    const black = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/match-room/matches', org.headers, {
      tournamentId: 'tour_1',
      whitePlayerId: white.user.id,
      blackPlayerId: black.user.id,
      timeControl: { initial: 600, increment: 0 },
      spectatorDelaySeconds: opts.spectatorDelaySeconds,
    });
    expect(res.status).toBe(201);
    const match = (await res.json()).data;
    const c1 = await post(`/api/v1/match-room/matches/${match.id}/checkin`, white.headers);
    expect((await c1.json()).data.status).toBe('checkin');
    const c2 = await post(`/api/v1/match-room/matches/${match.id}/checkin`, black.headers);
    expect((await c2.json()).data.status).toBe('ready');
    const started = await post(`/api/v1/match-room/matches/${match.id}/start`, org.headers);
    const room = (await started.json()).data;
    expect(room.status).toBe('live');
    return { org, white, black, match, room };
  }

  it('walks scheduled -> checkin -> ready -> live with server-authoritative state', async () => {
    const { match, room } = await liveMatch();
    expect(match.status).toBe('scheduled');
    expect(room.status).toBe('live');
    expect(room.seq).toBe(0);
    expect(room.turn).toBe('white');
    expect(room.version).toBeGreaterThan(1);
  });

  it('rejects out-of-turn moves, bad sequence numbers and handles duplicate delivery', async () => {
    const { white, black, match } = await liveMatch();

    const badSeq = await post(`/api/v1/match-room/matches/${match.id}/moves`, white.headers, { seq: 5, san: 'e4' });
    expect(badSeq.status).toBe(409);

    const first = await post(`/api/v1/match-room/matches/${match.id}/moves`, white.headers, { seq: 1, san: 'e4', from: 'e2', to: 'e4' });
    expect(first.status).toBe(201);
    expect((await first.json()).data.duplicate).toBe(false);

    const dup = await post(`/api/v1/match-room/matches/${match.id}/moves`, white.headers, { seq: 1, san: 'e4' });
    expect(dup.status).toBe(201);
    expect((await dup.json()).data.duplicate).toBe(true);

    const outOfTurn = await post(`/api/v1/match-room/matches/${match.id}/moves`, white.headers, { seq: 2, san: 'd4' });
    expect(outOfTurn.status).toBe(409);

    const blackMove = await post(`/api/v1/match-room/matches/${match.id}/moves`, black.headers, { seq: 2, san: 'e5', from: 'e7', to: 'e5' });
    expect(blackMove.status).toBe(201);
    expect((await blackMove.json()).data.room.turn).toBe('white');

    const state = (await (await get(`/api/v1/match-room/matches/${match.id}/state`, white.headers)).json()).data;
    expect(state.moves.length).toBe(2);
    expect(state.seq).toBe(2);
  });

  it('blocks a plain member from starting the match (403)', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const white = await seedUser(ctx, { roles: ['member'] });
    const black = await seedUser(ctx, { roles: ['member'] });
    const match = (await (
      await post('/api/v1/match-room/matches', org.headers, {
        tournamentId: 'tour_1',
        whitePlayerId: white.user.id,
        blackPlayerId: black.user.id,
        timeControl: { initial: 300, increment: 3 },
      })
    ).json()).data;
    const res = await post(`/api/v1/match-room/matches/${match.id}/start`, white.headers);
    expect(res.status).toBe(403);
  });

  it('requires both players to confirm, then finalises once and updates standings once', async () => {
    const { org, white, black, match } = await liveMatch();
    const resigned = await post(`/api/v1/match-room/matches/${match.id}/resign`, white.headers);
    expect(resigned.status).toBe(200);
    const afterResign = (await resigned.json()).data;
    expect(afterResign.status).toBe('awaiting_confirmation');
    expect(afterResign.proposedResult.result).toBe('black');

    const wConfirm = await post(`/api/v1/match-room/matches/${match.id}/confirm`, white.headers, { agree: true });
    expect((await wConfirm.json()).data.status).toBe('awaiting_confirmation');

    const bConfirm = await post(`/api/v1/match-room/matches/${match.id}/confirm`, black.headers, { agree: true });
    expect((await bConfirm.json()).data.status).toBe('confirmed');

    const finalized = await post(`/api/v1/match-room/matches/${match.id}/finalize`, org.headers, {});
    expect(finalized.status).toBe(200);
    const done = (await finalized.json()).data;
    expect(done.status).toBe('finalized');
    expect(done.finalResult).toBe('black');
    expect(done.ratingPipelineStatus).toBe('not_applicable');

    const again = await post(`/api/v1/match-room/matches/${match.id}/finalize`, org.headers, {});
    expect(again.status).toBe(409);

    const standings = (await (await get('/api/v1/match-room/tournaments/tour_1/standings', org.headers)).json()).data;
    expect(standings.length).toBe(2);
    expect(standings[0].playerId).toBe(black.user.id);
    expect(standings[0].points).toBe(1);
    expect(standings[1].points).toBe(0);
    expect(standings[1].played).toBe(1);
  });

  it('keeps a disputed result unresolved until the organizer acts, and refuses a member resolution', async () => {
    const { org, white, black, match } = await liveMatch();
    const proposed = await post(`/api/v1/match-room/matches/${match.id}/result`, org.headers, { result: 'white', reason: 'Opponent clock flag' });
    expect(proposed.status).toBe(200);
    expect((await proposed.json()).data.status).toBe('awaiting_confirmation');

    const disputed = await post(`/api/v1/match-room/matches/${match.id}/dispute`, black.headers, {
      reason: 'My flag fell after the clock was already stopped',
    });
    expect(disputed.status).toBe(200);
    expect((await disputed.json()).data.status).toBe('disputed');

    const premature = await post(`/api/v1/match-room/matches/${match.id}/confirm`, white.headers, { agree: true });
    expect(premature.status).toBe(409);

    const memberResolve = await post(`/api/v1/match-room/matches/${match.id}/resolve`, black.headers, { result: 'white', reason: 'I want the win' });
    expect(memberResolve.status).toBe(403);

    const resolved = await post(`/api/v1/match-room/matches/${match.id}/resolve`, org.headers, {
      result: 'white',
      reason: 'Game history shows the flag fell after the clock was stopped',
    });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data.status).toBe('finalized');

    const disputes = (await (await get(`/api/v1/match-room/matches/${match.id}/disputes`, org.headers)).json()).data;
    expect(disputes.length).toBe(1);
    expect(disputes[0].status).toBe('resolved');
  });

  it('enforces the spectator delay server-side', async () => {
    const { org, white, match } = await liveMatch({ spectatorDelaySeconds: 300 });
    await post(`/api/v1/match-room/matches/${match.id}/moves`, white.headers, { seq: 1, san: 'e4' });
    await post(`/api/v1/match-room/matches/${match.id}/resign`, white.headers);

    const spect = await seedUser(ctx, { roles: ['spectator'] });
    const delayed = (await (await get(`/api/v1/match-room/matches/${match.id}/spectate`, spect.headers)).json()).data;
    expect(delayed.readOnly).toBe(true);
    expect(delayed.delaySeconds).toBe(300);
    expect(delayed.moves.length).toBe(0);
    expect(delayed.result).toBeNull();

    await post(`/api/v1/match-room/matches/${match.id}/spectators`, org.headers, { delaySeconds: 0 });
    const immediate = (await (await get(`/api/v1/match-room/matches/${match.id}/spectate`, spect.headers)).json()).data;
    expect(immediate.moves.length).toBe(1);
  });

  it('pauses only with a reason and refuses moves while paused', async () => {
    const { org, white, match } = await liveMatch();
    const noReason = await post(`/api/v1/match-room/matches/${match.id}/pause`, org.headers, {});
    expect(noReason.status).toBe(400);

    const paused = await post(`/api/v1/match-room/matches/${match.id}/pause`, org.headers, { reason: 'Realtime service lost' });
    expect((await paused.json()).data.status).toBe('paused');

    const move = await post(`/api/v1/match-room/matches/${match.id}/moves`, white.headers, { seq: 1, san: 'e4' });
    expect(move.status).toBe(409);

    const resumed = await post(`/api/v1/match-room/matches/${match.id}/resume`, org.headers);
    expect((await resumed.json()).data.status).toBe('live');
  });
});
