import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 16 — Club Events & Activities', () => {
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

  const makeEvent = async (org: any, extra: any = {}) => {
    const res = await post('/api/v1/events', org.headers, { title: 'Weekly Practice', capacity: 2, ...extra });
    return (await res.json()).data;
  };

  it('creates a draft event and publishes it', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const res = await post('/api/v1/events', org.headers, { title: 'Opening Simul', category: 'workshop', capacity: 10 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('draft');

    const published = await post(`/api/v1/events/${body.data.id}/publish`, org.headers);
    expect(published.status).toBe(200);
    expect((await published.json()).data.status).toBe('published');
  });

  it('blocks members from managing events but lets them register', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const ev = await makeEvent(org);
    await post(`/api/v1/events/${ev.id}/publish`, org.headers);

    const forbiddenRes = await post('/api/v1/events', member.headers, { title: 'Rogue event' });
    expect(forbiddenRes.status).toBe(403);

    const reg = await post(`/api/v1/events/${ev.id}/register`, member.headers);
    expect(reg.status).toBe(201);
  });

  it('enforces capacity with a waitlist and rejects duplicate registration', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const ev = await makeEvent(org, { capacity: 1 });
    await post(`/api/v1/events/${ev.id}/publish`, org.headers);

    const p1 = await seedUser(ctx, { roles: ['member'] });
    const p2 = await seedUser(ctx, { roles: ['member'] });

    const first = await (await post(`/api/v1/events/${ev.id}/register`, p1.headers)).json();
    expect(first.data.status).toBe('registered');

    const second = await (await post(`/api/v1/events/${ev.id}/register`, p2.headers)).json();
    expect(second.data.status).toBe('waitlisted');

    const dup = await post(`/api/v1/events/${ev.id}/register`, p1.headers);
    expect(dup.status).toBe(409);
  });

  it('promotes the first waitlisted attendee when someone withdraws', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const ev = await makeEvent(org, { capacity: 1 });
    await post(`/api/v1/events/${ev.id}/publish`, org.headers);

    const p1 = await seedUser(ctx, { roles: ['member'] });
    const p2 = await seedUser(ctx, { roles: ['member'] });
    await post(`/api/v1/events/${ev.id}/register`, p1.headers);
    const waitlisted = await (await post(`/api/v1/events/${ev.id}/register`, p2.headers)).json();
    expect(waitlisted.data.status).toBe('waitlisted');

    const withdrawn = await post(`/api/v1/events/${ev.id}/withdraw`, p1.headers);
    expect(withdrawn.status).toBe(200);

    const detail = await (await get(`/api/v1/events/${ev.id}`)).json();
    expect(detail.data.seatsTaken).toBe(1);
    const promoted = detail.data.registrations.find((r: any) => r.userId === p2.user.id);
    expect(promoted.status).toBe('registered');
  });

  it('keeps manual-approval registrations pending until an organizer decides', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const ev = await makeEvent(org, { registrationMode: 'manual', capacity: 5 });
    await post(`/api/v1/events/${ev.id}/publish`, org.headers);
    const member = await seedUser(ctx, { roles: ['member'] });

    const reg = await (await post(`/api/v1/events/${ev.id}/register`, member.headers)).json();
    expect(reg.data.status).toBe('pending');

    const approved = await post(`/api/v1/events/${ev.id}/registrations/${reg.data.id}/approve`, org.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('registered');
  });

  it('refuses registration on an unpublished event', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const ev = await makeEvent(org);
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post(`/api/v1/events/${ev.id}/register`, member.headers);
    expect(res.status).toBe(409);
  });
});
