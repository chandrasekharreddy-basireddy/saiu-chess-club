import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 35 — Live Match Commentary', () => {
  let app: any, ctx: any, repo: any;
  const matchId = 'match_1001';

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const patch = (path: string, headers: any, json?: any) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const put = (path: string, headers: any, json?: any) =>
    app.request(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const del = (path: string, headers: any) => app.request(path, { method: 'DELETE', headers });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('persists entries for a match with a monotonic sequence and author display name', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'], name: 'Coach Rao' });
    const first = await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, { text: 'White opens 1.e4.' });
    expect(first.status).toBe(201);
    const e1 = (await first.json()).data;
    expect(e1.seq).toBe(1);
    expect(e1.authorDisplayName).toBe('Coach Rao');

    const second = await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, {
      text: 'Black replies 1...c5, the Sicilian.',
      moveNumber: 1,
      kind: 'highlight',
    });
    const e2 = (await second.json()).data;
    expect(e2.seq).toBe(2);
    expect(e2.kind).toBe('highlight');

    const third = await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, { text: '2.Nf3 d6.' });
    expect((await third.json()).data.seq).toBe(3);

    const archive = (await (await get(`/api/v1/commentary/matches/${matchId}/archive`)).json()).data;
    expect(archive.items.map((i: any) => i.seq)).toEqual([1, 2, 3]);
    expect(archive.total).toBe(3);
  });

  it('refuses commentary from a member who is neither assigned nor authorized', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post(`/api/v1/commentary/matches/${matchId}/entries`, member.headers, { text: 'Let me post!' });
    expect(res.status).toBe(403);
    expect(await repo.count('commentary_entries', { matchId })).toBe(0);
  });

  it('lets an explicitly assigned commentator post with their assignment display name', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const member = await seedUser(ctx, { roles: ['member'], name: 'Ananya Iyer' });

    const assign = await post(`/api/v1/commentary/matches/${matchId}/commentators`, organizer.headers, {
      userId: member.user.id,
      displayName: 'Ananya (club commentator)',
    });
    expect(assign.status).toBe(201);
    expect((await post(`/api/v1/commentary/matches/${matchId}/commentators`, organizer.headers, { userId: member.user.id, displayName: 'Dup' })).status).toBe(409);

    const posted = await post(`/api/v1/commentary/matches/${matchId}/entries`, member.headers, { text: 'Both players are in time trouble.' });
    expect(posted.status).toBe(201);
    expect((await posted.json()).data.authorDisplayName).toBe('Ananya (club commentator)');
  });

  it('enforces the spectator delay server-side and lifts it when configured to zero', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, { text: 'A queen sacrifice is coming.' });

    const spectatorFeed = (await (await get(`/api/v1/commentary/matches/${matchId}/entries`)).json()).data;
    expect(spectatorFeed.delayed).toBe(true);
    expect(spectatorFeed.delaySeconds).toBe(60);
    expect(spectatorFeed.items).toEqual([]);

    const commentatorFeed = (await (await get(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers)).json()).data;
    expect(commentatorFeed.delayed).toBe(false);
    expect(commentatorFeed.items.length).toBe(1);

    const bad = await put(`/api/v1/commentary/matches/${matchId}/settings`, organizer.headers, { delaySeconds: 5000 });
    expect(bad.status).toBe(400);

    const ok0 = await put(`/api/v1/commentary/matches/${matchId}/settings`, organizer.headers, { delaySeconds: 0 });
    expect(ok0.status).toBe(200);
    const live = (await (await get(`/api/v1/commentary/matches/${matchId}/entries`)).json()).data;
    expect(live.items.length).toBe(1);
  });

  it('preserves correction history when an entry is edited', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const entry = (await (await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, { text: 'Black plays 12...Nf6.' })).json()).data;

    const fixed = await patch(`/api/v1/commentary/entries/${entry.id}`, organizer.headers, { text: 'Black plays 12...Ne7.' });
    expect(fixed.status).toBe(200);
    const body = (await fixed.json()).data;
    expect(body.text).toBe('Black plays 12...Ne7.');
    expect(body.revision).toBe(2);

    const history = (await (await get(`/api/v1/commentary/entries/${entry.id}/history`, organizer.headers)).json()).data;
    expect(history.edits.length).toBe(1);
    expect(history.edits[0].previousText).toBe('Black plays 12...Nf6.');
    expect(history.currentText).toBe('Black plays 12...Ne7.');

    expect((await patch(`/api/v1/commentary/entries/${entry.id}`, organizer.headers, { text: 'Black plays 12...Ne7.' })).status).toBe(409);
  });

  it('lets a moderator delete an entry, removing it from the feed but keeping the audit trail', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const entry = (await (await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, { text: 'Off-topic remark.' })).json()).data;

    expect((await del(`/api/v1/commentary/entries/${entry.id}`, member.headers)).status).toBe(403);

    const removed = await del(`/api/v1/commentary/entries/${entry.id}`, president.headers);
    expect(removed.status).toBe(200);
    expect((await removed.json()).data.status).toBe('deleted');

    const stored = await repo.get('commentary_entries', entry.id);
    expect(stored.deletedAt).toBeTruthy();
    expect(stored.deletedBy).toBe(president.user.id);
    expect(stored.text).toBe('Off-topic remark.');

    const feed = (await (await get(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers)).json()).data;
    expect(feed.items).toEqual([]);
    expect((await del(`/api/v1/commentary/entries/${entry.id}`, president.headers)).status).toBe(409);
  });

  it('validates commentary input and blocks private or hidden data', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    expect((await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, { text: '   ' })).status).toBe(400);
    expect((await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, { text: 'x', kind: 'video' })).status).toBe(400);
    expect((await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, { text: 'x', moveNumber: 0 })).status).toBe(400);
    expect(
      (await post(`/api/v1/commentary/matches/${matchId}/entries`, organizer.headers, { text: 'x', hiddenPairing: 'round 4 board 2' })).status,
    ).toBe(400);
  });

  it('keeps commentary feeds separate per match', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    await post('/api/v1/commentary/matches/match_a/entries', organizer.headers, { text: 'Board one update.' });
    await post('/api/v1/commentary/matches/match_b/entries', organizer.headers, { text: 'Board two update.' });

    const a = (await (await get('/api/v1/commentary/matches/match_a/entries', organizer.headers)).json()).data;
    expect(a.items.length).toBe(1);
    expect(a.items[0].text).toBe('Board one update.');
    expect(a.items[0].seq).toBe(1);
  });
});
