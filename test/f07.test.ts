import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

const PGN = `[Event "SaiU Club Championship"]
[Site "SaiU Main Hall"]
[Date "2026.01.10"]
[Round "1"]
[White "Aarav Menon"]
[Black "Diya Rao"]
[Result "1-0"]
[ECO "C50"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 d6 1-0`;

describe('Feature 07 — Chess Game Analysis & PGN Management', () => {
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

  it('previews a valid PGN without persisting it', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/analysis/games/preview', member.headers, { pgn: PGN });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.plyCount).toBe(10);
    expect(body.data.result).toBe('1-0');
    expect(body.data.headers.White).toBe('Aarav Menon');
  });

  it('rejects malformed movetext and illegal SAN squares', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const bad = `[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e9 1-0`;
    const res = await post('/api/v1/analysis/games/preview', member.headers, { pgn: bad });
    expect(res.status).toBe(400);

    const noResultTag = `[White "A"]\n[Black "B"]\n\n1. e4 e5`;
    expect((await post('/api/v1/analysis/games/preview', member.headers, { pgn: noResultTag })).status).toBe(400);
  });

  it('imports a game and exports PGN only to users allowed to access it', async () => {
    const owner = await seedUser(ctx, { roles: ['member'] });
    const other = await seedUser(ctx, { roles: ['member'] });
    const imp = await post('/api/v1/analysis/games', owner.headers, { pgn: PGN, filename: 'r1.pgn' });
    expect(imp.status).toBe(201);
    const game = (await imp.json()).data;
    expect(game.visibility).toBe('private');

    const exp = await get(`/api/v1/analysis/games/${game.id}/pgn`, owner.headers);
    expect(exp.status).toBe(200);
    expect((await exp.json()).data.pgn).toContain('[White "Aarav Menon"]');

    expect((await get(`/api/v1/analysis/games/${game.id}/pgn`, other.headers)).status).toBe(403);
  });

  it('labels engine review as analysis and never as result adjudication', async () => {
    const owner = await seedUser(ctx, { roles: ['member'] });
    const game = (await (await post('/api/v1/analysis/games', owner.headers, { pgn: PGN })).json()).data;

    const res = await post(`/api/v1/analysis/games/${game.id}/review`, owner.headers, { mode: 'engine', depth: 14 });
    expect(res.status).toBe(201);
    const review = (await res.json()).data.review;
    expect(review.officialResultAffecting).toBe(false);
    expect(review.label).toBe('analysis');

    const bad = await post(`/api/v1/analysis/games/${game.id}/review`, owner.headers, { mode: 'engine', depth: 99 });
    expect(bad.status).toBe(400);
  });

  it('stops optional AI explanations once credits are exhausted', async () => {
    const owner = await seedUser(ctx, { roles: ['member'] });
    const game = (await (await post('/api/v1/analysis/games', owner.headers, { pgn: PGN })).json()).data;

    const first = await post(`/api/v1/analysis/games/${game.id}/review`, owner.headers, { mode: 'guided', aiExplanation: true });
    expect(first.status).toBe(201);
    expect((await first.json()).data.creditsRemaining).toBe(1);

    await post(`/api/v1/analysis/games/${game.id}/review`, owner.headers, { mode: 'guided', aiExplanation: true });
    const third = await post(`/api/v1/analysis/games/${game.id}/review`, owner.headers, { mode: 'guided', aiExplanation: true });
    expect(third.status).toBe(429);

    // Deterministic guided review keeps working without AI credits.
    const plain = await post(`/api/v1/analysis/games/${game.id}/review`, owner.headers, { mode: 'guided' });
    expect(plain.status).toBe(201);
  });

  it('refuses PGN import to a session without analysis permission', async () => {
    const spectator = await seedUser(ctx, { roles: ['spectator'] });
    const res = await post('/api/v1/analysis/games', spectator.headers, { pgn: PGN });
    expect(res.status).toBe(403);
  });
});
