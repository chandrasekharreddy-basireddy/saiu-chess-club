import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 23 — Facility, Venue & Infrastructure Management', () => {
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

  const newVenue = async (admin: any) =>
    (
      await (
        await post('/api/v1/facilities/venues', admin.headers, {
          name: 'Main Chess Hall',
          building: 'Student Centre',
          room: 'SC-201',
          capacity: 40,
          boardCount: 20,
          accessibility: 'Wheelchair ramp at west entrance, lift to floor 2',
          safetyNotes: 'Max 40 occupants; fire exit at east wall',
        })
      ).json()
    ).data;

  const book = (venueId: string, headers: any, startsAt: string, endsAt: string, extra: any = {}) =>
    post(`/api/v1/facilities/venues/${venueId}/bookings`, headers, {
      startsAt,
      endsAt,
      purpose: 'Club night',
      attendees: 24,
      ...extra,
    });

  it('creates a venue with explicit capacity and blocks non-approvers', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const res = await post('/api/v1/facilities/venues', admin.headers, {
      name: 'Main Chess Hall',
      capacity: 40,
      boardCount: 20,
    });
    expect(res.status).toBe(201);
    const venue = (await res.json()).data;
    expect(venue.capacity).toBe(40);
    expect(venue.status).toBe('active');

    const member = await seedUser(ctx, { roles: ['member'] });
    const denied = await post('/api/v1/facilities/venues', member.headers, { name: 'Rogue Hall', capacity: 5 });
    expect(denied.status).toBe(403);

    const publicList = (await (await get('/api/v1/facilities/venues')).json()).data;
    expect(publicList.total).toBe(1);
  });

  it('rejects overlapping bookings but allows back-to-back slots', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const venue = await newVenue(admin);

    const first = await book(venue.id, member.headers, '2026-03-01T10:00:00.000Z', '2026-03-01T12:00:00.000Z');
    expect(first.status).toBe(201);
    expect((await first.json()).data.status).toBe('requested');

    const clash = await book(venue.id, member.headers, '2026-03-01T11:00:00.000Z', '2026-03-01T13:00:00.000Z');
    expect(clash.status).toBe(409);

    const adjacent = await book(venue.id, member.headers, '2026-03-01T12:00:00.000Z', '2026-03-01T14:00:00.000Z');
    expect(adjacent.status).toBe(201);
  });

  it('rejects bookings above venue capacity', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const venue = await newVenue(admin);
    const res = await book(venue.id, member.headers, '2026-03-02T10:00:00.000Z', '2026-03-02T12:00:00.000Z', {
      attendees: 60,
    });
    expect(res.status).toBe(409);
  });

  it('approves a booking only through a different person than the requester', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const admin2 = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const venue = await newVenue(admin);

    const own = await book(venue.id, admin.headers, '2026-03-03T10:00:00.000Z', '2026-03-03T12:00:00.000Z');
    const ownId = (await own.json()).data.id;
    const selfApproval = await post(`/api/v1/facilities/bookings/${ownId}/approve`, admin.headers);
    expect(selfApproval.status).toBe(403);

    const approved = await post(`/api/v1/facilities/bookings/${ownId}/approve`, admin2.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('approved');

    const memberBooking = await book(venue.id, member.headers, '2026-03-04T10:00:00.000Z', '2026-03-04T12:00:00.000Z');
    const memberBookingId = (await memberBooking.json()).data.id;
    const ok2 = await post(`/api/v1/facilities/bookings/${memberBookingId}/approve`, admin.headers);
    expect(ok2.status).toBe(200);

    const util = (await (await get(`/api/v1/facilities/venues/${venue.id}/utilization`, admin.headers)).json()).data;
    expect(util.approvedBookings).toBe(2);
    expect(util.bookedMinutes).toBe(240);
  });

  it('blocks bookings during maintenance windows and when the venue is under maintenance', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const venue = await newVenue(admin);

    const maint = await post(`/api/v1/facilities/venues/${venue.id}/maintenance`, admin.headers, {
      startsAt: '2026-03-05T15:00:00.000Z',
      endsAt: '2026-03-05T17:00:00.000Z',
      note: 'Board replacement',
    });
    expect(maint.status).toBe(201);

    const during = await book(venue.id, member.headers, '2026-03-05T16:00:00.000Z', '2026-03-05T18:00:00.000Z');
    expect(during.status).toBe(409);

    await post(`/api/v1/facilities/venues/${venue.id}/status`, admin.headers, { status: 'maintenance' });
    const blocked = await book(venue.id, member.headers, '2026-03-09T10:00:00.000Z', '2026-03-09T12:00:00.000Z');
    expect(blocked.status).toBe(409);
  });

  it('audits cancellation and refuses to re-approve a cancelled booking', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const admin2 = await seedUser(ctx, { roles: ['administrator'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    const venue = await newVenue(admin);

    const created = (await (await book(venue.id, member.headers, '2026-03-06T10:00:00.000Z', '2026-03-06T12:00:00.000Z')).json())
      .data;
    await post(`/api/v1/facilities/bookings/${created.id}/approve`, admin.headers);

    const outsider = await seedUser(ctx, { roles: ['member'] });
    expect((await post(`/api/v1/facilities/bookings/${created.id}/cancel`, outsider.headers, { reason: 'nope' })).status).toBe(403);

    const cancelled = await post(`/api/v1/facilities/bookings/${created.id}/cancel`, member.headers, { reason: 'Exam week' });
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).data.status).toBe('cancelled');

    const reapprove = await post(`/api/v1/facilities/bookings/${created.id}/approve`, admin2.headers);
    expect(reapprove.status).toBe(409);
  });
});
