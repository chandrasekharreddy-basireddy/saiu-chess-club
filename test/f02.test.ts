import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

const NOW = '2026-01-15T09:00:00.000Z';
const at = (mins: number) => new Date(new Date(NOW).getTime() + mins * 60_000).toISOString();

describe('Feature 02 — Tournament Attendance & No-Show Management', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx(NOW);
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

  async function setupMatch(startsAt: string) {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const white = await seedUser(ctx, { roles: ['member'] });
    const black = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/attendance/matches', org.headers, {
      tournamentId: 'tour_1',
      whitePlayerId: white.user.id,
      blackPlayerId: black.user.id,
      startsAt,
      board: 1,
    });
    expect(res.status).toBe(201);
    const match = (await res.json()).data;
    return { org, white, black, match };
  }

  it('opens check-in 15 minutes before the start and records presence', async () => {
    const { white, match } = await setupMatch(at(10));
    const res = await post(`/api/v1/attendance/matches/${match.id}/checkin`, white.headers);
    expect(res.status).toBe(201);
    const body = (await res.json()).data;
    expect(body.window.opensAt).toBe(at(-5));
    expect(body.record.status).toBe('present');
    expect(body.record.late).toBe(false);
    expect(body.record.checkInSource).toBe('self');
  });

  it('refuses check-in before the window opens', async () => {
    const { white, match } = await setupMatch(at(60));
    const res = await post(`/api/v1/attendance/matches/${match.id}/checkin`, white.headers);
    expect(res.status).toBe(409);
  });

  it('derives Late inside the grace period and flags a check-in after it', async () => {
    const lateMatch = await setupMatch(at(-5)); // started 5 min ago, inside the 10 min grace
    const lateRes = await post(`/api/v1/attendance/matches/${lateMatch.match.id}/checkin`, lateMatch.black.headers);
    expect(lateRes.status).toBe(201);
    const lateRec = (await lateRes.json()).data.record;
    expect(lateRec.status).toBe('late');
    expect(lateRec.late).toBe(true);
    expect(lateRec.beyondGrace).toBe(false);

    const overMatch = await setupMatch(at(-30)); // grace (start + 10) has elapsed
    const overRes = await post(`/api/v1/attendance/matches/${overMatch.match.id}/checkin`, overMatch.white.headers);
    const overRec = (await overRes.json()).data.record;
    expect(overRec.status).toBe('late');
    expect(overRec.beyondGrace).toBe(true);
    expect(overRec.flagged).toBe(true);
  });

  it('raises missing-player alerts after the grace period and never awards a walkover by itself', async () => {
    const { org, match } = await setupMatch(at(-30));
    const res = await post(`/api/v1/attendance/matches/${match.id}/alerts/evaluate`, org.headers);
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.alerts.length).toBe(2);

    const again = (await (await post(`/api/v1/attendance/matches/${match.id}/alerts/evaluate`, org.headers)).json()).data;
    expect(again.alerts.length).toBe(0); // idempotent: no duplicate alerts

    const board = (await (await get(`/api/v1/attendance/matches/${match.id}/board`, org.headers)).json()).data;
    expect(board.match.status).toBe('scheduled');
    expect(board.match.walkover).toBeNull();
    expect(board.alerts.length).toBe(2);

    const gate = (await (await get(`/api/v1/attendance/matches/${match.id}/result-gate`, org.headers)).json()).data;
    expect(gate.ready).toBe(false);
  });

  it('awards a walkover only with explicit organizer confirmation and a reason', async () => {
    const { org, white, match } = await setupMatch(at(-30));
    const noConfirm = await post(`/api/v1/attendance/matches/${match.id}/walkover`, org.headers, {
      winnerPlayerId: white.user.id,
      reason: 'Opponent did not appear',
    });
    expect(noConfirm.status).toBe(400);

    const okRes = await post(`/api/v1/attendance/matches/${match.id}/walkover`, org.headers, {
      winnerPlayerId: white.user.id,
      reason: 'Opponent did not appear after grace period',
      confirmed: true,
    });
    expect(okRes.status).toBe(200);
    const updated = (await okRes.json()).data;
    expect(updated.walkover.winnerPlayerId).toBe(white.user.id);
    expect(updated.status).toBe('completed');

    const gate = (await (await get(`/api/v1/attendance/matches/${match.id}/result-gate`, org.headers)).json()).data;
    expect(gate.ready).toBe(true);
  });

  it('rejects attendance marking by a plain member (403)', async () => {
    const { white, black, match } = await setupMatch(at(-5));
    const res = await post(`/api/v1/attendance/matches/${match.id}/attendance`, white.headers, {
      playerId: black.user.id,
      status: 'absent',
    });
    expect(res.status).toBe(403);
  });

  it('keeps absence explanations private to organizers', async () => {
    const { org, white, black, match } = await setupMatch(at(-30));
    const sub = await post(`/api/v1/attendance/matches/${match.id}/explanations`, white.headers, {
      category: 'illness',
      text: 'Down with fever, saw the club doctor.',
    });
    expect(sub.status).toBe(201);

    const opponent = await get(`/api/v1/attendance/matches/${match.id}/explanations`, black.headers);
    expect(opponent.status).toBe(403);

    const staff = await get(`/api/v1/attendance/matches/${match.id}/explanations`, org.headers);
    expect(staff.status).toBe(200);
    const items = (await staff.json()).data.items;
    expect(items.length).toBe(1);
    expect(items[0].visibility).toBe('organizer_only');

    const playerView = (await (await get(`/api/v1/attendance/matches/${match.id}`, black.headers)).json()).data;
    expect(playerView.ownRecord?.text).toBeUndefined();
  });

  it('records an emergency override with a reason in the match history', async () => {
    const { org, match } = await setupMatch(at(-5));
    const noReason = await post(`/api/v1/attendance/matches/${match.id}/emergency`, org.headers, { action: 'pause' });
    expect(noReason.status).toBe(400);

    const res = await post(`/api/v1/attendance/matches/${match.id}/emergency`, org.headers, {
      action: 'pause',
      reason: 'Fire alarm in the hall',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.match.status).toBe('paused');

    const history = (await (await get(`/api/v1/attendance/matches/${match.id}/history`, org.headers)).json()).data;
    expect(history.incidents.length).toBe(1);
    expect(history.events.some((e: any) => e.action === 'attendance.emergency.override')).toBe(true);
  });
});
