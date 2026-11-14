import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 18 — Digital Notice Board & Announcement Management', () => {
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

  const createAndPublish = async (author: any, body: any) => {
    const created = await (await post('/api/v1/notices', author.headers, body)).json();
    const published = await post(`/api/v1/notices/${created.data.id}/publish`, author.headers);
    return { created: created.data, published };
  };

  it('creates and publishes a public notice', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const created = await post('/api/v1/notices', org.headers, {
      title: 'Club reopening',
      body: 'The club reopens on Monday.',
      category: 'event',
      audience: ['public'],
    });
    expect(created.status).toBe(201);
    const notice = (await created.json()).data;
    expect(notice.status).toBe('draft');

    const published = await post(`/api/v1/notices/${notice.id}/publish`, org.headers);
    expect(published.status).toBe(200);
    expect((await published.json()).data.status).toBe('published');
  });

  it('separates the public board from the members feed by audience', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    await createAndPublish(org, { title: 'Public notice', body: 'Open to all.', category: 'event', audience: ['public'] });
    await createAndPublish(org, { title: 'Members only', body: 'Internal matter.', category: 'event', audience: ['members'] });

    const publicBoard = await (await get('/api/v1/notices')).json();
    expect(publicBoard.data.items.length).toBe(1);
    expect(publicBoard.data.items[0].title).toBe('Public notice');

    const member = await seedUser(ctx, { roles: ['member'] });
    const memberFeed = await (await get('/api/v1/notices', member.headers)).json();
    expect(memberFeed.data.items.length).toBe(2);
  });

  it('requires an approver other than the author for official notices', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const created = await (await post('/api/v1/notices', org.headers, {
      title: 'Constitution amendment',
      body: 'Amended article 4.',
      category: 'official',
      audience: ['members'],
    })).json();
    expect(created.data.requiresApproval).toBe(true);

    const premature = await post(`/api/v1/notices/${created.data.id}/publish`, org.headers);
    expect(premature.status).toBe(409);

    await post(`/api/v1/notices/${created.data.id}/submit`, org.headers);
    const selfApproval = await post(`/api/v1/notices/${created.data.id}/approve`, org.headers);
    expect(selfApproval.status).toBe(403);

    const president = await seedUser(ctx, { roles: ['president'] });
    const approved = await post(`/api/v1/notices/${created.data.id}/approve`, president.headers);
    expect(approved.status).toBe(200);
    const published = await post(`/api/v1/notices/${created.data.id}/publish`, org.headers);
    expect((await published.json()).data.status).toBe('published');
  });

  it('hides expired notices and keeps version history on correction', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const expired = await createAndPublish(org, {
      title: 'Expired notice',
      body: 'No longer valid.',
      category: 'event',
      audience: ['public'],
      expiresAt: '2026-01-01T00:00:00.000Z',
    });
    const board = await (await get('/api/v1/notices')).json();
    expect(board.data.items.length).toBe(0);

    const corrected = await post(`/api/v1/notices/${expired.created.id}/correct`, org.headers, {
      body: 'Corrected text.',
      reason: 'typo in venue',
    });
    expect((await corrected.json()).data.version).toBe(2);

    const versions = await (await get(`/api/v1/notices/${expired.created.id}/versions`, org.headers)).json();
    expect(versions.data.versions.length).toBe(2);
    expect(versions.data.versions[0].body).toBe('No longer valid.');
  });

  it('blocks members from publishing and unpublish removes a notice from the board', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const denied = await post('/api/v1/notices', member.headers, { title: 'Nope', body: 'Nope', category: 'event' });
    expect(denied.status).toBe(403);

    const live = await createAndPublish(org, { title: 'Live notice', body: 'Visible.', category: 'event', audience: ['public'] });
    expect((await (await get('/api/v1/notices')).json()).data.items.length).toBe(1);

    const unpublished = await post(`/api/v1/notices/${live.created.id}/unpublish`, org.headers, { reason: 'superseded' });
    expect(unpublished.status).toBe(200);
    expect((await (await get('/api/v1/notices')).json()).data.items.length).toBe(0);
  });
});
