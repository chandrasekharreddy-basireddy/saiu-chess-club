import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 11 — Chess Community & Social Interaction', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const patch = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const del = (path: string, headers: any) => app.request(path, { method: 'DELETE', headers });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('lets a member publish a post and shows it in the feed', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/community/posts', member.headers, { title: 'Sicilian Najdorf tips', body: 'Share your lines.' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.moderationState).toBe('visible');

    const feed = await (await get('/api/v1/community/posts', member.headers)).json();
    expect(feed.data.total).toBe(1);
    expect(feed.data.items[0].title).toBe('Sicilian Najdorf tips');
  });

  it('refuses posting without the community.post permission', async () => {
    const spectator = await seedUser(ctx, { roles: ['spectator'] });
    const res = await post('/api/v1/community/posts', spectator.headers, { title: 'x', body: 'y' });
    expect(res.status).toBe(403);
  });

  it('requires a title and body', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/community/posts', member.headers, { title: '   ' });
    expect(res.status).toBe(400);
  });

  it('hides a post through moderator action and blocks new comments on it', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const committee = await seedUser(ctx, { roles: ['committee'] });
    const created = await (await post('/api/v1/community/posts', member.headers, { title: 'Off topic', body: 'spam' })).json();
    const id = created.data.id;

    const mod = await post(`/api/v1/community/posts/${id}/moderate`, committee.headers, { state: 'hidden', reason: 'spam' });
    expect(mod.status).toBe(200);
    expect((await mod.json()).data.moderationState).toBe('hidden');

    const feed = await (await get('/api/v1/community/posts', member.headers)).json();
    expect(feed.data.total).toBe(0);

    const comment = await post(`/api/v1/community/posts/${id}/comments`, member.headers, { body: 'still here' });
    expect(comment.status).toBe(409);
  });

  it('keeps moderation away from members without community.moderate', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const id = (await (await post('/api/v1/community/posts', member.headers, { title: 'My game', body: 'analysis' })).json()).data.id;
    const res = await post(`/api/v1/community/posts/${id}/moderate`, member.headers, { state: 'removed', reason: 'nope' });
    expect(res.status).toBe(403);
  });

  it('handles a content report: confidential queue, unverified case, moderator resolution', async () => {
    const author = await seedUser(ctx, { roles: ['member'] });
    const reporter = await seedUser(ctx, { roles: ['member'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const id = (await (await post('/api/v1/community/posts', author.headers, { title: 'Rude', body: 'insults' })).json()).data.id;

    const rep = await post(`/api/v1/community/posts/${id}/report`, reporter.headers, { reason: 'harassment' });
    expect(rep.status).toBe(201);
    const report = (await rep.json()).data;
    expect(report.status).toBe('open');
    expect(report.verified).toBe(false);

    const dup = await post(`/api/v1/community/posts/${id}/report`, reporter.headers, { reason: 'harassment again' });
    expect(dup.status).toBe(409);

    expect((await get('/api/v1/community/reports', reporter.headers)).status).toBe(403);

    const queue = await (await get('/api/v1/community/reports', president.headers)).json();
    expect(queue.data.total).toBe(1);

    const resolved = await post(`/api/v1/community/reports/${report.id}/resolve`, president.headers, {
      outcome: 'upheld', reason: 'confirmed harassment', hideContent: true,
    });
    expect(resolved.status).toBe(200);
    const after = (await resolved.json()).data;
    expect(after.status).toBe('resolved');
    expect(after.verified).toBe(true);

    const hiddenPost = await repo.get('community_posts', id);
    expect(hiddenPost.moderationState).toBe('hidden');
  });

  it('enforces blocking server-side on comments', async () => {
    const author = await seedUser(ctx, { roles: ['member'] });
    const other = await seedUser(ctx, { roles: ['member'] });
    const id = (await (await post('/api/v1/community/posts', author.headers, { title: 'Open thread', body: 'hello' })).json()).data.id;

    expect((await post(`/api/v1/community/members/${other.user.id}/block`, author.headers)).status).toBe(201);

    const blocked = await post(`/api/v1/community/posts/${id}/comments`, other.headers, { body: 'hi' });
    expect(blocked.status).toBe(403);

    const third = await seedUser(ctx, { roles: ['member'] });
    expect((await post(`/api/v1/community/posts/${id}/comments`, third.headers, { body: 'hi' })).status).toBe(201);
  });

  it('lets an author edit and delete their own post only', async () => {
    const author = await seedUser(ctx, { roles: ['member'] });
    const other = await seedUser(ctx, { roles: ['member'] });
    const id = (await (await post('/api/v1/community/posts', author.headers, { title: 'Draft', body: 'one' })).json()).data.id;

    expect((await patch(`/api/v1/community/posts/${id}`, other.headers, { body: 'hijack' })).status).toBe(403);
    expect((await patch(`/api/v1/community/posts/${id}`, author.headers, { body: 'two' })).status).toBe(200);
    expect((await del(`/api/v1/community/posts/${id}`, author.headers)).status).toBe(200);
    expect((await get(`/api/v1/community/posts/${id}`, author.headers)).status).toBe(404);
  });
});
