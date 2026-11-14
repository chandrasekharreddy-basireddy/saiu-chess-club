import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

const SEASON = {
  name: 'SaiU 2026 Championship',
  year: 2026,
  startsAt: '2026-02-01T00:00:00.000Z',
  endsAt: '2026-06-30T00:00:00.000Z',
};

describe('Feature 08 — Rankings, Championships & Seasonal Awards', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any = {}, json?: any) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  async function setupSeason(org: any, opts: { kind?: string; minGames?: number; pool?: string } = {}) {
    const season = (await (await post('/api/v1/rankings/seasons', org.headers, SEASON)).json()).data;
    const category = (
      await (
        await post(`/api/v1/rankings/seasons/${season.id}/categories`, org.headers, {
          kind: opts.kind || 'club_champion',
          name: opts.kind === 'most_improved' ? 'Most Improved Player' : 'Club Champion',
          minGames: opts.minGames ?? 0,
          pool: opts.pool,
        })
      ).json()
    ).data;
    const published = await post(`/api/v1/rankings/seasons/${season.id}/criteria/publish`, org.headers);
    expect(published.status).toBe(200);
    return { season, category };
  }

  it('creates a season for an organizer and refuses a member', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const res = await post('/api/v1/rankings/seasons', org.headers, SEASON);
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe('draft');

    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await post('/api/v1/rankings/seasons', member.headers, SEASON)).status).toBe(403);
  });

  it('requires criteria to be published before an award can be approved', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const season = (await (await post('/api/v1/rankings/seasons', org.headers, SEASON)).json()).data;
    const category = (
      await (await post(`/api/v1/rankings/seasons/${season.id}/categories`, org.headers, { kind: 'club_champion', name: 'Club Champion' })).json()
    ).data;

    const res = await post(`/api/v1/rankings/seasons/${season.id}/categories/${category.id}/approve`, president.headers, { userId: 'u1' });
    expect(res.status).toBe(409);
  });

  it('publishes criteria only before the award period starts', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const season = (await (await post('/api/v1/rankings/seasons', org.headers, SEASON)).json()).data;
    expect((await post(`/api/v1/rankings/seasons/${season.id}/criteria/publish`, org.headers)).status).toBe(409);

    await post(`/api/v1/rankings/seasons/${season.id}/categories`, org.headers, { kind: 'season_champion', name: 'Season Champion' });
    const ok2 = await post(`/api/v1/rankings/seasons/${season.id}/criteria/publish`, org.headers);
    expect(ok2.status).toBe(200);
    expect((await ok2.json()).data.status).toBe('criteria_published');
  });

  it('scores only finalized results once and ranks with a wins tie-break', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const { season } = await setupSeason(org);
    const p = `/api/v1/rankings/seasons/${season.id}/points`;

    expect((await post(p, org.headers, { resultId: 'r1', userId: 'u1', outcome: 'win', finalized: true })).status).toBe(201);
    expect((await post(p, org.headers, { resultId: 'r2', userId: 'u1', outcome: 'win', finalized: true })).status).toBe(201);
    await post(p, org.headers, { resultId: 'r3', userId: 'u2', outcome: 'win', finalized: true });
    await post(p, org.headers, { resultId: 'r4', userId: 'u2', outcome: 'draw', finalized: true });
    await post(p, org.headers, { resultId: 'r5', userId: 'u2', outcome: 'draw', finalized: true });
    await post(p, org.headers, { resultId: 'r6', userId: 'u2', outcome: 'draw', finalized: true });

    expect((await post(p, org.headers, { resultId: 'r1', userId: 'u1', outcome: 'win', finalized: true })).status).toBe(409);
    expect((await post(p, org.headers, { resultId: 'r7', userId: 'u1', outcome: 'win', finalized: false })).status).toBe(409);

    const board = (await (await get(`/api/v1/rankings/seasons/${season.id}/leaderboard`)).json()).data;
    expect(board.items[0].points).toBe(6);
    expect(board.items[0].userId).toBe('u1');
    expect(board.items[1].userId).toBe('u2');
  });

  it('computes Most Improved candidates from the rating baseline with a minimum game count', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const { season, category } = await setupSeason(org, { kind: 'most_improved', minGames: 5, pool: 'rapid' });
    const r = `/api/v1/rankings/seasons/${season.id}/ratings`;

    await post(r, org.headers, { userId: 'u1', pool: 'rapid', startRating: 1200, endRating: 1300, games: 6 });
    await post(r, org.headers, { userId: 'u2', pool: 'rapid', startRating: 1200, endRating: 1350, games: 4 });
    await post(r, org.headers, { userId: 'u3', pool: 'rapid', startRating: 1300, endRating: 1340, games: 10 });

    const cands = (await (await get(`/api/v1/rankings/seasons/${season.id}/categories/${category.id}/candidates`, org.headers)).json()).data;
    expect(cands.total).toBe(2);
    expect(cands.candidates[0].userId).toBe('u1');
    expect(cands.candidates[0].score).toBe(100);
  });

  it('blocks self-approval, publishes a unique certificate and refuses a second winner', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const { season, category } = await setupSeason(org, { kind: 'most_improved', minGames: 5, pool: 'rapid' });
    const r = `/api/v1/rankings/seasons/${season.id}/ratings`;
    await post(r, org.headers, { userId: 'u1', pool: 'rapid', startRating: 1200, endRating: 1300, games: 6 });
    await post(r, org.headers, { userId: president.user.id, pool: 'rapid', startRating: 1200, endRating: 1400, games: 8 });

    const approve = `/api/v1/rankings/seasons/${season.id}/categories/${category.id}/approve`;
    expect((await post(approve, president.headers, { userId: president.user.id })).status).toBe(403);

    const res = await post(approve, president.headers, { userId: 'u1' });
    expect(res.status).toBe(201);
    const winner = (await res.json()).data;
    expect(winner.certificateId).toMatch(/^SAIU-2026-/);
    expect((await post(approve, president.headers, { userId: 'u1' })).status).toBe(409);

    const cert = await (await get(`/api/v1/rankings/certificates/${winner.certificateId}`)).json();
    expect(cert.data.valid).toBe(true);
  });

  it('keeps sportsmanship candidate-free until a documented nomination exists', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const { season, category } = await setupSeason(org, { kind: 'sportsmanship' });
    const base = `/api/v1/rankings/seasons/${season.id}/categories/${category.id}`;

    const empty = (await (await get(`${base}/candidates`, org.headers)).json()).data;
    expect(empty.total).toBe(0);

    const nom = await post(`${base}/nominations`, member.headers, { nominatedUserId: 'u9', reason: 'Helped set up boards every round' });
    expect(nom.status).toBe(201);
    expect((await post(`${base}/nominations`, member.headers, { nominatedUserId: 'u9', reason: 'Again' })).status).toBe(409);

    const cands = (await (await get(`${base}/candidates`, org.headers)).json()).data;
    expect(cands.candidates[0].userId).toBe('u9');
  });
});
