import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 33 — Knowledge Base, Documentation & Resource Centre', () => {
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
  const patch = (path: string, headers: any, json?: any) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const editor = () => seedUser(ctx, { roles: ['member'], permissions: ['kb.read', 'kb.publish'] });

  const create = (who: any, extra: any = {}) =>
    post('/api/v1/knowledge-base', who.headers, {
      title: 'Club Chess Rules',
      body: 'Touch-move applies in all club events.',
      audience: 'public',
      visibility: 'public',
      category: 'rules',
      tags: ['rules', 'chess'],
      ...extra,
    });

  it('keeps a new article in draft and hides it from public reads', async () => {
    const ed = await editor();
    const res = await create(ed);
    expect(res.status).toBe(201);
    const article = (await res.json()).data;
    expect(article.status).toBe('draft');
    expect(article.slug).toBe('club-chess-rules');
    expect(article.version).toBe(1);
    expect(article.ownerId).toBe(ed.user.id);

    expect((await get('/api/v1/knowledge-base/club-chess-rules')).status).toBe(404);
  });

  it('publishes an article and serves it publicly by slug', async () => {
    const ed = await editor();
    const article = (await (await create(ed)).json()).data;
    const pub = await post(`/api/v1/knowledge-base/${article.id}/publish`, ed.headers);
    expect(pub.status).toBe(200);
    expect((await pub.json()).data.status).toBe('published');

    const read = await get('/api/v1/knowledge-base/club-chess-rules');
    expect(read.status).toBe(200);
    const body = (await read.json()).data;
    expect(body.title).toBe('Club Chess Rules');
    expect(body.publishedBy).toBe(ed.user.id);
  });

  it('rejects a duplicate slug', async () => {
    const ed = await editor();
    expect((await create(ed)).status).toBe(201);
    const dup = await create(ed, { title: 'Something else entirely', slug: 'club-chess-rules' });
    expect(dup.status).toBe(409);
  });

  it('preserves the previous revision when an article is updated', async () => {
    const ed = await editor();
    const article = (await (await create(ed)).json()).data;
    const upd = await patch(`/api/v1/knowledge-base/${article.id}`, ed.headers, {
      body: 'Touch-move applies; clocks start after the first move.',
    });
    expect(upd.status).toBe(200);
    expect((await upd.json()).data.version).toBe(2);

    const versions = (await (await get(`/api/v1/knowledge-base/${article.id}/versions`, ed.headers)).json()).data;
    expect(versions.currentVersion).toBe(2);
    const old = versions.versions.find((v: any) => v.version === 1);
    expect(old.body).toBe('Touch-move applies in all club events.');
  });

  it('requires a second authorized editor to publish an official policy (separation of duties)', async () => {
    const author = await editor();
    const reviewer = await editor();
    const policy = (await (await create(author, { title: 'Code of Conduct', isPolicy: true, category: 'policy' })).json()).data;

    const selfPublish = await post(`/api/v1/knowledge-base/${policy.id}/publish`, author.headers);
    expect(selfPublish.status).toBe(403);

    const approved = await post(`/api/v1/knowledge-base/${policy.id}/publish`, reviewer.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('published');
  });

  it('refuses article management to a plain member (403)', async () => {
    const ed = await editor();
    const member = await seedUser(ctx, { roles: ['member'] });
    const article = (await (await create(ed)).json()).data;

    expect((await create(member)).status).toBe(403);
    expect((await get(`/api/v1/knowledge-base/${article.id}/versions`, member.headers)).status).toBe(403);
    expect((await get('/api/v1/knowledge-base/reviews/due', member.headers)).status).toBe(403);
  });

  it('search respects permissions and never returns drafts', async () => {
    const ed = await editor();
    const member = await seedUser(ctx, { roles: ['member'] });

    const open = (await (await create(ed, { title: 'Chess openings primer', slug: 'chess-openings-primer' })).json()).data;
    await post(`/api/v1/knowledge-base/${open.id}/publish`, ed.headers);

    const restricted = (await (
      await create(ed, { title: 'Chess committee minutes', slug: 'chess-committee-minutes', audience: 'committee', visibility: 'restricted' })
    ).json()).data;
    await post(`/api/v1/knowledge-base/${restricted.id}/publish`, ed.headers);

    await create(ed, { title: 'Chess draft notes', slug: 'chess-draft-notes' });

    const asMember = (await (await get('/api/v1/knowledge-base/search?q=chess', member.headers)).json()).data;
    const slugs = asMember.items.map((i: any) => i.slug);
    expect(slugs).toContain('chess-openings-primer');
    expect(slugs).not.toContain('chess-committee-minutes');
    expect(slugs).not.toContain('chess-draft-notes');

    const asEditor = (await (await get('/api/v1/knowledge-base/search?q=chess', ed.headers)).json()).data;
    const editorSlugs = asEditor.items.map((i: any) => i.slug);
    expect(editorSlugs).toContain('chess-committee-minutes');
    expect(editorSlugs).not.toContain('chess-draft-notes');
  });

  it('archives an article, flags expired guidance and rejects unknown slugs', async () => {
    const ed = await editor();
    const stale = (await (
      await create(ed, { title: 'Old tournament instructions', slug: 'old-tournament-instructions', reviewDueAt: '2026-01-01T00:00:00.000Z' })
    ).json()).data;
    await post(`/api/v1/knowledge-base/${stale.id}/publish`, ed.headers);

    const due = (await (await get('/api/v1/knowledge-base/reviews/due', ed.headers)).json()).data;
    expect(due.map((d: any) => d.slug)).toContain('old-tournament-instructions');
    expect(due[0].expired).toBe(true);

    expect((await post(`/api/v1/knowledge-base/${stale.id}/archive`, ed.headers)).status).toBe(200);
    expect((await get('/api/v1/knowledge-base/old-tournament-instructions')).status).toBe(404);
    expect((await get('/api/v1/knowledge-base/no-such-article')).status).toBe(404);
  });
});
