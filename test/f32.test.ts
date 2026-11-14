import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 32 — Website Experience Improvement Centre', () => {
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
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const submit = async (who: any, extra: any = {}) => {
    const res = await post('/api/v1/experience', who.headers, {
      type: 'bug',
      title: 'Clock widget freezes on mobile',
      description: 'The countdown stops updating after a tab switch.',
      severity: 'high',
      page: '/arena/live',
      ...extra,
    });
    return res;
  };

  it('accepts feedback from a member with type, severity and a new triage status', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await submit(member);
    expect(res.status).toBe(201);
    const item = (await res.json()).data;
    expect(item.type).toBe('bug');
    expect(item.severity).toBe('high');
    expect(item.status).toBe('new');
    expect(item.queue).toBe('general');
    expect(item.publicVotable).toBe(true);
  });

  it('rejects an unknown feedback type and an invalid severity', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await submit(member, { type: 'complaint' })).status).toBe(400);
    expect((await submit(member, { severity: 'urgent' })).status).toBe(400);
  });

  it('blocks members from the internal feedback queue (403)', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await get('/api/v1/experience', member.headers)).status).toBe(403);

    const lead = await seedUser(ctx, { roles: ['administrator'] });
    const list = await get('/api/v1/experience', lead.headers);
    expect(list.status).toBe(200);
    expect((await list.json()).data.items).toEqual([]);
  });

  it('routes security-sensitive reports to a restricted, non-votable queue', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await submit(member, { type: 'security', title: 'Session cookie leak in shared link', severity: 'critical' });
    expect(res.status).toBe(201);
    const item = (await res.json()).data;
    expect(item.queue).toBe('restricted');
    expect(item.visibility).toBe('restricted');
    expect(item.publicVotable).toBe(false);

    expect((await post(`/api/v1/experience/${item.id}/vote`, member.headers)).status).toBe(403);
    expect((await get(`/api/v1/experience/${item.id}`, member.headers)).status).toBe(403);

    const lead = await seedUser(ctx, { roles: ['administrator'] });
    expect((await get(`/api/v1/experience/${item.id}`, lead.headers)).status).toBe(200);
    expect((await post(`/api/v1/experience/${item.id}/roadmap`, lead.headers)).status).toBe(403);
  });

  it('walks the triage state machine and refuses an invalid transition', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const lead = await seedUser(ctx, { roles: ['administrator'] });
    const item = (await (await submit(member)).json()).data;

    const jump = await post(`/api/v1/experience/${item.id}/triage`, lead.headers, { status: 'resolved' });
    expect(jump.status).toBe(409);

    const triaged = await post(`/api/v1/experience/${item.id}/triage`, lead.headers, { status: 'triaged', priority: 'high' });
    expect(triaged.status).toBe(200);
    const body = (await triaged.json()).data;
    expect(body.status).toBe('triaged');
    expect(body.priority).toBe('high');
    expect(body.triageHistory.length).toBe(2);

    const progress = await post(`/api/v1/experience/${item.id}/triage`, lead.headers, { status: 'in_progress' });
    expect(progress.status).toBe(200);
    expect((await progress.json()).data.status).toBe('in_progress');
  });

  it('links a duplicate to an existing item and refuses to re-link it', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const lead = await seedUser(ctx, { roles: ['administrator'] });
    const original = (await (await submit(member)).json()).data;
    const dupe = (await (await submit(member, { title: 'Clock widget hangs on phones' })).json()).data;

    const linked = await post(`/api/v1/experience/${dupe.id}/duplicate`, lead.headers, { duplicateOf: original.id });
    expect(linked.status).toBe(200);
    const body = (await linked.json()).data;
    expect(body.status).toBe('duplicate');
    expect(body.duplicateOf).toBe(original.id);

    expect((await post(`/api/v1/experience/${dupe.id}/duplicate`, lead.headers, { duplicateOf: original.id })).status).toBe(409);
  });

  it('requires triage before an item reaches the public roadmap, then publishes it', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const lead = await seedUser(ctx, { roles: ['administrator'] });
    const item = (await (await submit(member, { type: 'feature_request', title: 'Add a tournament calendar export', severity: 'low' })).json()).data;

    const early = await post(`/api/v1/experience/${item.id}/roadmap`, lead.headers, {});
    expect(early.status).toBe(409);
    expect((await (await get('/api/v1/experience/public/roadmap')).json()).data).toEqual([]);

    await post(`/api/v1/experience/${item.id}/triage`, lead.headers, { status: 'triaged', priority: 'medium' });
    const published = await post(`/api/v1/experience/${item.id}/roadmap`, lead.headers, { publicTitle: 'Calendar export for tournaments' });
    expect(published.status).toBe(200);
    expect((await published.json()).data.roadmapPublished).toBe(true);

    const roadmap = (await (await get('/api/v1/experience/public/roadmap')).json()).data;
    expect(roadmap.length).toBe(1);
    expect(roadmap[0].title).toBe('Calendar export for tournaments');
  });

  it('allows one prioritisation vote per user per item', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const item = (await (await submit(member, { type: 'usability', title: 'Move list is hard to scan' })).json()).data;

    const first = await post(`/api/v1/experience/${item.id}/vote`, member.headers);
    expect(first.status).toBe(201);
    expect((await first.json()).data.votes).toBe(1);

    const other = await seedUser(ctx, { roles: ['member'] });
    expect((await post(`/api/v1/experience/${item.id}/vote`, other.headers)).status).toBe(201);

    const again = await post(`/api/v1/experience/${item.id}/vote`, member.headers);
    expect(again.status).toBe(409);
  });
});
