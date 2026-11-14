import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

const MAX_ITEM = 20 * 1024 * 1024;
const QUOTA = 60 * 1024 * 1024;

describe('Feature 28 — Media, Gallery & Digital Archive', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const manager = () => seedUser(ctx, { roles: ['administrator'] });

  const upload = (user: any, extra: any = {}) => post('/api/v1/media/items', user.headers, {
    title: 'Inter-university final', caption: 'Board one, round five', eventDate: '2025-03-08T10:00:00.000Z',
    tags: ['tournament', 'Finals'], sourceOwner: 'SaiU Chess Club', licence: 'CC-BY-4.0',
    storageBytes: 1024 * 1024, ...extra,
  });

  it('accepts a contributor upload as private-pending with source, licence and archive year', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await upload(member);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('pending');
    expect(body.data.archiveYear).toBe(2025);
    expect(body.data.tags).toEqual(['tournament', 'finals']);
    expect(body.data.sourceOwner).toBe('SaiU Chess Club');

    // private by default: the public gallery cannot see it
    expect((await get(`/api/v1/media/items/${body.data.id}`)).status).toBe(404);
  });

  it('requires source/owner and licence metadata, and caps single-item size', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await upload(member, { licence: undefined })).status).toBe(400);
    expect((await upload(member, { sourceOwner: undefined })).status).toBe(400);
    expect((await upload(member, { storageBytes: MAX_ITEM + 1 })).status).toBe(400);
  });

  it('only media managers moderate, and consent is required before publication', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const mgr = await manager();
    const id = (await (await upload(member, { identifiablePeople: true })).json()).data.id;

    expect((await post(`/api/v1/media/items/${id}/approve`, member.headers)).status).toBe(403);
    expect((await post(`/api/v1/media/items/${id}/approve`, mgr.headers)).status).toBe(422);

    expect((await post(`/api/v1/media/items/${id}/consent`, mgr.headers, { consentStatus: 'granted', evidence: 'signed form 2025-03-09' })).status).toBe(200);
    expect((await post(`/api/v1/media/items/${id}/approve`, mgr.headers)).status).toBe(200);
    expect((await post(`/api/v1/media/items/${id}/publish`, mgr.headers)).status).toBe(200);

    const pub = await (await get(`/api/v1/media/items/${id}`)).json();
    expect(pub.data.title).toBe('Inter-university final');
    expect(pub.data.sourceOwner).toBeUndefined();
  });

  it('enforces the per-contributor upload quota', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    await repo.insert('media_items', {
      id: 'seeded_big', title: 'Archive dump', status: 'published', contributorId: member.user.id,
      storageBytes: QUOTA - 1000, sourceOwner: 'SaiU Chess Club', licence: 'CC-BY-4.0', tags: [], archiveYear: 2024,
    });
    const res = await upload(member, { storageBytes: 5000 });
    expect(res.status).toBe(429);
  });

  it('serves the public gallery filtered by tag and archive year', async () => {
    const mgr = await manager();
    const member = await seedUser(ctx, { roles: ['member'] });
    const a = (await (await upload(member, { title: 'Finals 2025', tags: ['tournament'] })).json()).data.id;
    const b = (await (await upload(member, { title: 'Practice 2024', tags: ['practice'], eventDate: '2024-08-01T10:00:00.000Z' })).json()).data.id;
    for (const id of [a, b]) {
      await post(`/api/v1/media/items/${id}/approve`, mgr.headers);
      await post(`/api/v1/media/items/${id}/publish`, mgr.headers);
    }

    const all = await (await get('/api/v1/media/items')).json();
    expect(all.data.total).toBe(2);

    const tagged = await (await get('/api/v1/media/items?tag=tournament')).json();
    expect(tagged.data.total).toBe(1);
    expect(tagged.data.items[0].title).toBe('Finals 2025');

    const years = await (await get('/api/v1/media/archive/years')).json();
    expect(years.data.map((y: any) => y.archiveYear).sort()).toEqual([2024, 2025]);
  });

  it('audits a takedown and removes the item from the public archive', async () => {
    const mgr = await manager();
    const member = await seedUser(ctx, { roles: ['member'] });
    const id = (await (await upload(member)).json()).data.id;
    await post(`/api/v1/media/items/${id}/approve`, mgr.headers);
    await post(`/api/v1/media/items/${id}/publish`, mgr.headers);

    const report = await post(`/api/v1/media/items/${id}/report`, member.headers, { reason: 'I did not consent to this photo' });
    expect(report.status).toBe(201);
    const reqId = (await report.json()).data.id;

    const takedown = await post(`/api/v1/media/items/${id}/takedown`, mgr.headers, { reason: 'consent withdrawn' });
    expect(takedown.status).toBe(200);
    expect((await takedown.json()).data.status).toBe('removed');
    expect((await get(`/api/v1/media/items/${id}`)).status).toBe(404);

    const resolved = await post(`/api/v1/media/takedown-requests/${reqId}/resolve`, mgr.headers, { outcome: 'removed' });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data.status).toBe('removed');
  });
});
