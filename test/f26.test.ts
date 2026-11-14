import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 26 — Public Website & Club Branding', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const editor = () => seedUser(ctx, { roles: ['administrator'] });
  const reviewer = () => seedUser(ctx, { roles: ['committee'], permissions: ['site.experience.manage'] });

  /** create -> submit -> approve (independent reviewer) -> publish */
  async function publishBlock(author: any, rev: any, payload: any) {
    const made = await (await post('/api/v1/site/blocks', author.headers, payload)).json();
    const id = made.data.id;
    await post(`/api/v1/site/blocks/${id}/submit`, author.headers);
    await post(`/api/v1/site/blocks/${id}/approve`, rev.headers);
    const published = await (await post(`/api/v1/site/blocks/${id}/publish`, author.headers)).json();
    return { id, block: published.data };
  }

  it('creates a content block as a draft that the public cannot see', async () => {
    const admin = await editor();
    const res = await post('/api/v1/site/blocks', admin.headers, {
      kind: 'hero', title: 'SaiU Chess Club', body: 'Play. Learn. Compete.', internalNotes: 'not for publication',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('draft');
    expect(body.data.version).toBe(1);

    const publicRead = await get('/api/v1/site/blocks/hero');
    expect(publicRead.status).toBe(404);
  });

  it('rejects authoring by a plain member (admin-only write)', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/site/blocks', member.headers, { kind: 'about', title: 'Nope' });
    expect(res.status).toBe(403);
    expect((await get('/api/v1/site/admin/blocks', member.headers)).status).toBe(403);
  });

  it('runs the draft -> review -> approval -> publish workflow and hides internal fields', async () => {
    const admin = await editor();
    const rev = await reviewer();
    const made = await (await post('/api/v1/site/blocks', admin.headers, {
      kind: 'hero', title: 'SaiU Chess Club', body: 'Play. Learn. Compete.', internalNotes: 'draft notes',
      seo: { title: 'SaiU Chess Club', description: 'University chess club', ownerEmail: 'private@example.com' },
    })).json();
    const id = made.data.id;

    // cannot publish before approval
    expect((await post(`/api/v1/site/blocks/${id}/publish`, admin.headers)).status).toBe(409);
    expect((await post(`/api/v1/site/blocks/${id}/submit`, admin.headers)).status).toBe(200);

    // separation of duties: the author may not approve their own block
    expect((await post(`/api/v1/site/blocks/${id}/approve`, admin.headers)).status).toBe(403);
    expect((await post(`/api/v1/site/blocks/${id}/approve`, rev.headers)).status).toBe(200);

    const published = await post(`/api/v1/site/blocks/${id}/publish`, admin.headers);
    expect(published.status).toBe(200);
    expect((await published.json()).data.status).toBe('published');

    const pub = await (await get('/api/v1/site/blocks/hero')).json();
    expect(pub.data.body).toBe('Play. Learn. Compete.');
    expect(pub.data.internalNotes).toBeUndefined();
    expect(pub.data.authorId).toBeUndefined();
    expect(pub.data.seo.ownerEmail).toBeUndefined();
  });

  it('versions content: republishing archives the previous published block', async () => {
    const admin = await editor();
    const rev = await reviewer();
    const first = await publishBlock(admin, rev, { kind: 'about', title: 'About v1', body: 'first' });
    expect(first.block.version).toBe(1);

    const second = await publishBlock(admin, rev, { kind: 'about', title: 'About v2', body: 'second' });
    expect(second.block.version).toBe(2);
    expect(second.block.supersedesId).toBe(first.id);

    const live = await (await get('/api/v1/site/blocks?kind=about')).json();
    expect(live.data.length).toBe(1);
    expect(live.data[0].title).toBe('About v2');
  });

  it('publishes a contact block without protected contact information', async () => {
    const admin = await editor();
    const rev = await reviewer();
    const { block } = await publishBlock(admin, rev, {
      kind: 'contact',
      title: 'Contact the club',
      body: 'Write to us during term time.',
      contact: { email: 'chessclub@saiuniversity.edu.in', officeHours: 'Mon-Fri 10:00-16:00', internalExtension: '2231', privateMobile: '+91-9000000000' },
    });
    expect(block.status).toBe('published');

    const pub = await (await get('/api/v1/site/blocks/contact')).json();
    expect(pub.data.contact.email).toBe('chessclub@saiuniversity.edu.in');
    expect(pub.data.contact.officeHours).toBe('Mon-Fri 10:00-16:00');
    expect(pub.data.contact.internalExtension).toBeUndefined();
    expect(pub.data.contact.privateMobile).toBeUndefined();
  });

  it('validates block kinds and refuses edits to published content', async () => {
    const admin = await editor();
    const rev = await reviewer();
    expect((await post('/api/v1/site/blocks', admin.headers, { kind: 'pricing', title: 'x' })).status).toBe(400);

    const { id } = await publishBlock(admin, rev, { kind: 'mission', title: 'Mission', body: 'text' });
    const edit = await app.request(`/api/v1/site/blocks/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', ...admin.headers }, body: JSON.stringify({ title: 'Changed' }),
    });
    expect(edit.status).toBe(409);
  });
});
