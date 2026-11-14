import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 06 — Player Profiles, Ratings & Leaderboards', () => {
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
  const patch = (path: string, headers: any = {}, json?: any) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('creates a profile with separate rating pools and hides private fields publicly', async () => {
    const player = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/ratings/profiles', player.headers, {
      displayName: 'Aarav Menon',
      clubId: 'SAIU-1042',
      contactEmail: 'aarav@saiuniversity.edu.in',
      department: 'Computer Science',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.ratings).toEqual({ bullet: 1200, blitz: 1200, rapid: 1200 });

    const pub = await (await get(`/api/v1/ratings/profiles/${player.user.id}`)).json();
    expect(pub.data.contactEmail).toBeUndefined();
    expect(pub.data.department).toBeUndefined();
  });

  it('applies a deterministic Elo update to both players and writes rating history', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const white = await seedUser(ctx, { roles: ['member'] });
    const black = await seedUser(ctx, { roles: ['member'] });

    const res = await post('/api/v1/ratings/results', admin.headers, {
      sourceResultId: 'match-1-board-1',
      pool: 'rapid',
      whiteId: white.user.id,
      blackId: black.user.id,
      result: '1-0',
      finalized: true,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // both start at 1200, K=40 (provisional): 1200 + 40*(1 - 0.5) = 1220 / 1180
    expect(body.data.ratings.white.after).toBe(1220);
    expect(body.data.ratings.black.after).toBe(1180);

    const hist = await (await get(`/api/v1/ratings/profiles/${white.user.id}/history?pool=rapid`)).json();
    expect(hist.data).toHaveLength(1);
    expect(hist.data[0].delta).toBe(20);
  });

  it('prevents duplicate result processing and refuses unfinalized games', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const payload = {
      sourceResultId: 'match-2-board-1',
      pool: 'blitz',
      whiteId: a.user.id,
      blackId: b.user.id,
      result: '1/2-1/2',
      finalized: true,
    };
    expect((await post('/api/v1/ratings/results', admin.headers, payload)).status).toBe(201);
    expect((await post('/api/v1/ratings/results', admin.headers, payload)).status).toBe(409);

    const unfinalized = await post('/api/v1/ratings/results', admin.headers, {
      ...payload,
      sourceResultId: 'match-2-board-2',
      finalized: false,
    });
    expect(unfinalized.status).toBe(409);
  });

  it('rejects rating writes from a member session', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/ratings/results', member.headers, {
      sourceResultId: 'x',
      pool: 'bullet',
      whiteId: 'a',
      blackId: 'b',
      result: '1-0',
      finalized: true,
    });
    expect(res.status).toBe(403);
  });

  it('ranks by rating with games-played tie-break and excludes disputed players', async () => {
    await repo.insert('player_profiles', {
      userId: 'u-low',
      displayName: 'Low Games',
      rapidRating: 1500,
      rapidGames: 5,
      rapidPeak: 1500,
      gamesPlayed: 5,
      wins: 4,
      membershipStatus: 'active',
      department: 'CSE',
      departmentVerified: true,
      hasOpenDispute: false,
    });
    await repo.insert('player_profiles', {
      userId: 'u-tie-a',
      displayName: 'Tie A',
      rapidRating: 1500,
      rapidGames: 12,
      rapidPeak: 1500,
      gamesPlayed: 12,
      wins: 6,
      membershipStatus: 'active',
      hasOpenDispute: false,
    });
    await repo.insert('player_profiles', {
      userId: 'u-disputed',
      displayName: 'Disputed',
      rapidRating: 1900,
      rapidGames: 20,
      rapidPeak: 1900,
      gamesPlayed: 20,
      wins: 18,
      membershipStatus: 'active',
      hasOpenDispute: true,
    });

    const lb = await (await get('/api/v1/ratings/leaderboard?pool=rapid&minGames=10')).json();
    expect(lb.data.total).toBe(1);
    expect(lb.data.items[0].userId).toBe('u-tie-a');
    expect(lb.data.items[0].rank).toBe(1);

    const dept = await (await get('/api/v1/ratings/leaderboard?pool=rapid&department=CSE')).json();
    expect(dept.data.items.map((r: any) => r.userId)).toEqual(['u-low']);
  });

  it('records an audited official rating correction with a reason', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const player = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/ratings/corrections', admin.headers, {
      userId: player.user.id,
      pool: 'blitz',
      newRating: 1410,
      reason: 'Misfiled round 3 result, corrected after review',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.profile.blitzRating).toBe(1410);

    const hist = await (await get(`/api/v1/ratings/profiles/${player.user.id}/history?pool=blitz`)).json();
    expect(hist.data[0].kind).toBe('correction');
    expect(hist.data[0].reason).toContain('Misfiled');
  });
});
