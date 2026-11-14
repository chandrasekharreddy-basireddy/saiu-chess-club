import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 22 — Transport & Travel Management', () => {
  let app: any, ctx: any, repo: any;

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
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const newTrip = async (org: any, seatCapacity = 2) =>
    (
      await (
        await post('/api/v1/travel', org.headers, {
          title: 'Inter-University Rapid 2026',
          destination: 'Pune',
          purpose: 'Zonal championship',
          startsAt: '2026-02-10T03:30:00.000Z',
          endsAt: '2026-02-11T12:00:00.000Z',
          seatCapacity,
        })
      ).json()
    ).data;

  it('creates a travel request that is explicitly unapproved and processes no payment', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const res = await post('/api/v1/travel', org.headers, {
      title: 'Inter-University Rapid 2026',
      destination: 'Pune',
      startsAt: '2026-02-10T03:30:00.000Z',
      endsAt: '2026-02-11T12:00:00.000Z',
      seatCapacity: 12,
    });
    expect(res.status).toBe(201);
    const trip = (await res.json()).data;
    expect(trip.status).toBe('draft');
    expect(trip.paymentProcessed).toBe(false);
    expect(trip.externalBookingRequired).toBe(true);
  });

  it('rejects travel creation by a member and invalid dates', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const denied = await post('/api/v1/travel', member.headers, { title: 'X', destination: 'Y' });
    expect(denied.status).toBe(403);

    const org = await seedUser(ctx, { roles: ['organizer'] });
    const bad = await post('/api/v1/travel', org.headers, {
      title: 'Backwards',
      destination: 'Pune',
      startsAt: '2026-02-11T03:30:00.000Z',
      endsAt: '2026-02-10T03:30:00.000Z',
      seatCapacity: 4,
    });
    expect(bad.status).toBe(400);
  });

  it('requires an approval from somebody other than the requester', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const org2 = await seedUser(ctx, { roles: ['organizer'] });
    const trip = await newTrip(org);

    const submitted = await post(`/api/v1/travel/${trip.id}/submit`, org.headers);
    expect(submitted.status).toBe(200);
    expect((await submitted.json()).data.status).toBe('pending_approval');

    const self = await post(`/api/v1/travel/${trip.id}/approve`, org.headers);
    expect(self.status).toBe(403);

    const approved = await post(`/api/v1/travel/${trip.id}/approve`, org2.headers);
    expect(approved.status).toBe(200);
    const body = (await approved.json()).data;
    expect(body.status).toBe('approved');
    expect(body.approvedBy).toBe(org2.user.id);
  });

  it('enforces seat capacity on the manifest', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const trip = await newTrip(org, 2);
    await post(`/api/v1/travel/${trip.id}/submit`, org.headers);
    await post(`/api/v1/travel/${trip.id}/approve`, (await seedUser(ctx, { roles: ['organizer'] })).headers);

    const p1 = await seedUser(ctx, { roles: ['member'] });
    const p2 = await seedUser(ctx, { roles: ['member'] });
    const p3 = await seedUser(ctx, { roles: ['member'] });
    const ids: string[] = [];
    for (const p of [p1, p2, p3]) {
      const added = await post(`/api/v1/travel/${trip.id}/passengers`, org.headers, { userId: p.user.id });
      expect(added.status).toBe(201);
      ids.push((await added.json()).data.id);
    }

    expect((await post(`/api/v1/travel/${trip.id}/passengers/${ids[0]}/confirm`, p1.headers)).status).toBe(200);
    expect((await post(`/api/v1/travel/${trip.id}/passengers/${ids[1]}/confirm`, p2.headers)).status).toBe(200);
    const overflow = await post(`/api/v1/travel/${trip.id}/passengers/${ids[2]}/confirm`, p3.headers);
    expect(overflow.status).toBe(409);

    const manifest = (await (await get(`/api/v1/travel/${trip.id}/manifest`, org.headers)).json()).data;
    expect(manifest.confirmed).toBe(2);
    expect(manifest.remainingSeats).toBe(0);
    expect(manifest.full).toBe(true);
  });

  it('keeps participant data private to participants and officials', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const trip = await newTrip(org, 3);
    const insider = await seedUser(ctx, { roles: ['member'] });
    const outsider = await seedUser(ctx, { roles: ['member'] });
    const other = await seedUser(ctx, { roles: ['member'] });

    await post(`/api/v1/travel/${trip.id}/passengers`, org.headers, {
      userId: insider.user.id,
      emergencyContact: '+91-9000000001',
    });
    await post(`/api/v1/travel/${trip.id}/passengers`, org.headers, {
      userId: other.user.id,
      emergencyContact: '+91-9000000002',
    });

    expect((await get(`/api/v1/travel/${trip.id}/manifest`, outsider.headers)).status).toBe(403);

    const seen = (await (await get(`/api/v1/travel/${trip.id}/manifest`, insider.headers)).json()).data;
    const othersRow = seen.passengers.find((p: any) => p.userId === other.user.id);
    const ownRow = seen.passengers.find((p: any) => p.userId === insider.user.id);
    expect(othersRow.emergencyContact).toBe(null); // redacted for a fellow traveller
    expect(ownRow.emergencyContact).toBe('+91-9000000001');

    const officialView = (await (await get(`/api/v1/travel/${trip.id}/manifest`, org.headers)).json()).data;
    expect(officialView.passengers.find((p: any) => p.userId === other.user.id).emergencyContact).toBe('+91-9000000002');
  });

  it('notifies affected participants when their booking changes', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const trip = await newTrip(org, 2);
    const p1 = await seedUser(ctx, { roles: ['member'] });
    const added = (await (await post(`/api/v1/travel/${trip.id}/passengers`, org.headers, { userId: p1.user.id })).json()).data;

    const cancelled = await post(`/api/v1/travel/${trip.id}/passengers/${added.id}/cancel`, org.headers, {
      reason: 'Bus cancelled',
    });
    expect(cancelled.status).toBe(200);
    const body = (await cancelled.json()).data;
    expect(body.passenger.status).toBe('cancelled');
    expect(body.notice.userId).toBe(p1.user.id);

    const notices = (await (await get(`/api/v1/travel/${trip.id}/notices`, p1.headers)).json()).data;
    expect(notices.length).toBe(1);
    expect(notices[0].message).toContain('Bus cancelled');
  });

  it('refuses to complete a trip that was never approved', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const trip = await newTrip(org);
    const res = await post(`/api/v1/travel/${trip.id}/complete`, org.headers, { report: 'done' });
    expect(res.status).toBe(409);
  });
});
