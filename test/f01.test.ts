import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 01 — Tournament Registration & Scheduling', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('creates a tournament with organizer permission', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const res = await post('/api/v1/tournaments', org.headers, { name: 'SaiU Open 2026', rounds: 6, capacity: 32 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('SaiU Open 2026');
    expect(body.data.status).toBe('draft');
  });

  it('rejects tournament creation without permission', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/tournaments', member.headers, { name: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('registers players, enforces duplicates and waitlists beyond capacity', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const t = await (await post('/api/v1/tournaments', org.headers, { name: 'Blitz', capacity: 2 })).json();
    const id = t.data.id;
    await post(`/api/v1/tournaments/${id}/registration/open`, org.headers);

    const p1 = await seedUser(ctx, { roles: ['member'] });
    const p2 = await seedUser(ctx, { roles: ['member'] });
    const p3 = await seedUser(ctx, { roles: ['member'] });

    expect((await post(`/api/v1/tournaments/${id}/register`, p1.headers)).status).toBe(201);
    expect((await post(`/api/v1/tournaments/${id}/register`, p2.headers)).status).toBe(201);
    const third = await (await post(`/api/v1/tournaments/${id}/register`, p3.headers)).json();
    expect(third.data.status).toBe('waitlisted');

    const dup = await post(`/api/v1/tournaments/${id}/register`, p1.headers);
    expect(dup.status).toBe(409);
  });

  it('promotes the waitlisted player when someone withdraws', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const id = (await (await post('/api/v1/tournaments', org.headers, { name: 'Rapid', capacity: 2 })).json()).data.id;
    await post(`/api/v1/tournaments/${id}/registration/open`, org.headers);
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const c = await seedUser(ctx, { roles: ['member'] });
    await post(`/api/v1/tournaments/${id}/register`, a.headers);
    await post(`/api/v1/tournaments/${id}/register`, b.headers);
    const wl = await (await post(`/api/v1/tournaments/${id}/register`, c.headers)).json();
    expect(wl.data.status).toBe('waitlisted');
    await post(`/api/v1/tournaments/${id}/withdraw`, a.headers);
    const detail = await (await get(`/api/v1/tournaments/${id}`)).json();
    expect(detail.data.confirmedCount).toBe(2);
    expect(detail.data.registrations.find((r: any) => r.playerId === c.user.id).status).toBe('confirmed');
  });

  it('proposes a schedule and blocks self-approval (separation of duties)', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const id = (await (await post('/api/v1/tournaments', org.headers, { name: 'Classical', rounds: 3 })).json()).data.id;
    await post(`/api/v1/tournaments/${id}/registration/open`, org.headers);
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    await post(`/api/v1/tournaments/${id}/register`, a.headers);
    await post(`/api/v1/tournaments/${id}/register`, b.headers);

    const proposed = await post(`/api/v1/tournaments/${id}/schedule/propose`, org.headers, {});
    expect(proposed.status).toBe(200);
    expect((await proposed.json()).data.scheduleStatus).toBe('proposed');

    const orgSelf = await post(`/api/v1/tournaments/${id}/schedule/approve`, org.headers);
    expect(orgSelf.status).toBe(403);

    const president = await seedUser(ctx, { roles: ['president'] });
    const approved = await post(`/api/v1/tournaments/${id}/schedule/approve`, president.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.scheduleStatus).toBe('approved');
  });

  it('refuses to schedule with fewer than two confirmed players', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const id = (await (await post('/api/v1/tournaments', org.headers, { name: 'Solo' })).json()).data.id;
    await post(`/api/v1/tournaments/${id}/registration/open`, org.headers);
    const res = await post(`/api/v1/tournaments/${id}/schedule/propose`, org.headers, {});
    expect(res.status).toBe(409);
  });
});
