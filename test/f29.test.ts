import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 29 — Search & Discovery', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  /** rows owned by other features, written straight through the repo */
  async function seedContent() {
    await repo.insert('tournaments', {
      id: 'trn_1', name: 'SaiU Chess Championship 2026', description: 'Classical chess tournament for all students',
      status: 'registration_open', createdAt: ctx.now(),
    });
    await repo.insert('tournaments', {
      id: 'trn_draft', name: 'Unannounced Chess Trial', description: 'chess trial, not published yet',
      status: 'draft', createdAt: ctx.now(),
    });
    await repo.insert('notices', {
      id: 'not_1', title: 'Chess club AGM notice', body: 'The annual general meeting of the chess club is on 20 Feb.',
      status: 'published', visibility: 'public', createdAt: ctx.now(),
    });
    await repo.insert('notices', {
      id: 'not_members', title: 'Chess team internal selection', body: 'Members-only chess selection notes',
      status: 'published', visibility: 'members', createdAt: ctx.now(),
    });
    await repo.insert('events', {
      id: 'evt_1', title: 'Chess blitz evening', description: 'An open chess blitz evening in the student centre',
      status: 'published', createdAt: ctx.now(),
    });
    await repo.insert('media_items', {
      id: 'med_1', title: 'Chess finals gallery', caption: 'Photos from the chess finals', status: 'published',
      archiveYear: 2025, tags: ['chess'], createdAt: ctx.now(),
    });
    await repo.insert('media_items', {
      id: 'med_private', title: 'Chess rehearsal photos', caption: 'chess rehearsal, unmoderated', status: 'pending',
      archiveYear: 2026, tags: [], createdAt: ctx.now(),
    });
    await repo.insert('kb_articles', {
      id: 'kb_1', title: 'How do I join the chess club?', body: 'Membership of the chess club is open to every enrolled student.',
      status: 'published', createdAt: ctx.now(),
    });
  }

  it('searches several tables and returns typed results with a url', async () => {
    await seedContent();
    const res = await get('/api/v1/search?q=chess');
    expect(res.status).toBe(200);
    const body = await res.json();
    const types = body.data.items.map((i: any) => i.type);
    expect(types).toContain('tournament');
    expect(types).toContain('notice');
    expect(types).toContain('event');
    expect(types).toContain('media');
    for (const item of body.data.items) {
      expect(typeof item.type).toBe('string');
      expect(item.url).toContain('/api/v1/');
    }
    expect(body.data.total).toBeGreaterThanOrEqual(4);
  });

  it('matches case-insensitively over title and body', async () => {
    await seedContent();
    const lower = await (await get('/api/v1/search?q=chess')).json();
    const upper = await (await get('/api/v1/search?q=CHESS')).json();
    expect(upper.data.total).toBe(lower.data.total);

    const byBody = await (await get('/api/v1/search?q=blitz%20evening')).json();
    expect(byBody.data.items[0].type).toBe('event');
    expect(byBody.data.items[0].snippet).toContain('blitz');
  });

  it('excludes unpublished rows and members-only notices for anonymous visitors', async () => {
    await seedContent();
    const anon = await (await get('/api/v1/search?q=chess&limit=50')).json();
    const ids = anon.data.items.map((i: any) => i.id);
    expect(ids).not.toContain('trn_draft');
    expect(ids).not.toContain('med_private');
    expect(ids).not.toContain('not_members');
    expect(ids).not.toContain('kb_1'); // knowledge base needs a session

    const member = await seedUser(ctx, { roles: ['member'] });
    const asMember = await (await get('/api/v1/search?q=chess&limit=50', member.headers)).json();
    const memberIds = asMember.data.items.map((i: any) => i.id);
    expect(memberIds).toContain('not_members');
    expect(memberIds).toContain('kb_1');
  });

  it('supports q, type filter, limit and pagination', async () => {
    await seedContent();
    const first = await (await get('/api/v1/search?q=chess&limit=2')).json();
    expect(first.data.items.length).toBe(2);
    expect(first.data.limit).toBe(2);
    expect(first.data.hasMore).toBe(true);

    const second = await (await get('/api/v1/search?q=chess&limit=2&offset=2')).json();
    expect(second.data.offset).toBe(2);
    expect(second.data.items.length).toBeGreaterThan(0);
    expect(second.data.items[0].id).not.toBe(first.data.items[0].id);

    const onlyNotices = await (await get('/api/v1/search?q=chess&type=notice')).json();
    expect(onlyNotices.data.items.every((i: any) => i.type === 'notice')).toBe(true);
  });

  it('rejects a missing or too-short query and unknown types', async () => {
    expect((await get('/api/v1/search')).status).toBe(400);
    expect((await get('/api/v1/search?q=c')).status).toBe(400);
    expect((await get('/api/v1/search?q=chess&type=finance')).status).toBe(400);
  });

  it('rate-limits repeated queries and reports index health to admins only', async () => {
    await seedContent();
    const member = await seedUser(ctx, { roles: ['member'] });
    for (let i = 0; i < 30; i++) {
      await repo.insert('search_queries', { id: `q_${i}`, userId: member.user.id, q: 'chess', createdAt: ctx.now() });
    }
    const limited = await get('/api/v1/search?q=chess', member.headers);
    expect(limited.status).toBe(429);

    expect((await get('/api/v1/search/health', member.headers)).status).toBe(403);
    const president = await seedUser(ctx, { roles: ['president'] });
    const health = await get('/api/v1/search/health', president.headers);
    expect(health.status).toBe(200);
    const hbody = await health.json();
    expect(Array.isArray(hbody.data.sources)).toBe(true);
    expect(hbody.data.sources.find((s: any) => s.type === 'tournament').tableFound).toBe(true);
  });

  it('returns an empty state rather than failing when a source table is absent', async () => {
    // only one table exists; every other source is missing
    await repo.insert('notices', { id: 'not_solo', title: 'Chess notice', body: 'chess', status: 'published', createdAt: ctx.now() });
    const res = await get('/api/v1/search?q=chess');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(1);
    expect(body.data.items[0].type).toBe('notice');
  });
});
