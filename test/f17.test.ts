import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 17 — Calendar & Academic Year Management', () => {
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

  const YEAR = { name: '2025-26', startsAt: '2025-07-01T00:00:00.000Z', endsAt: '2026-06-30T18:29:59.000Z' };

  const approvedYear = async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const created = await (await post('/api/v1/calendar/academic-years', org.headers, YEAR)).json();
    await post(`/api/v1/calendar/academic-years/${created.data.id}/approve`, president.headers);
    return { org, president, year: created.data };
  };

  it('proposes an academic year and approves it by a second official', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const res = await post('/api/v1/calendar/academic-years', org.headers, YEAR);
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    expect(created.status).toBe('proposed');

    const approved = await post(`/api/v1/calendar/academic-years/${created.id}/approve`, president.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('approved');
  });

  it('blocks self-approval of academic-year boundaries and member writes', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const created = await (await post('/api/v1/calendar/academic-years', org.headers, YEAR)).json();
    const selfApproval = await post(`/api/v1/calendar/academic-years/${created.data.id}/approve`, org.headers);
    expect(selfApproval.status).toBe(403);

    const member = await seedUser(ctx, { roles: ['member'] });
    const memberWrite = await post('/api/v1/calendar/entries', member.headers, {
      title: 'Unauthorised booking',
      startsAt: '2026-02-01T10:00:00.000Z',
      endsAt: '2026-02-01T11:00:00.000Z',
    });
    expect(memberWrite.status).toBe(403);
  });

  it('detects a venue conflict between two overlapping entries', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const first = await post('/api/v1/calendar/entries', org.headers, {
      title: 'Blitz night',
      venueId: 'main-hall',
      startsAt: '2026-02-01T10:00:00.000Z',
      endsAt: '2026-02-01T12:00:00.000Z',
    });
    expect(first.status).toBe(201);

    const clash = await post('/api/v1/calendar/entries', org.headers, {
      title: 'Coaching clinic',
      venueId: 'main-hall',
      startsAt: '2026-02-01T11:00:00.000Z',
      endsAt: '2026-02-01T13:00:00.000Z',
    });
    expect(clash.status).toBe(409);
    const body = await clash.json();
    expect(body.error.details.kind).toBe('venue');
  });

  it('stores UTC, renders local time and drives season membership from year boundaries', async () => {
    const { org, year } = await approvedYear();
    const created = await (
      await post('/api/v1/calendar/entries', org.headers, {
        title: 'Rapid arena',
        venueId: 'annexe',
        timezone: 'Asia/Kolkata',
        startsAt: '2026-02-01T09:00:00.000Z',
        endsAt: '2026-02-01T11:00:00.000Z',
      })
    ).json();
    expect(created.data.startsAt).toBe('2026-02-01T09:00:00.000Z');

    const detail = await (await get(`/api/v1/calendar/entries/${created.data.id}`)).json();
    expect(detail.data.localStart.time).toBe('14:30');
    expect(detail.data.localStart.offsetMinutes).toBe(330);

    const member = await seedUser(ctx, { roles: ['member'] });
    const membership = await (await get(`/api/v1/calendar/season-membership?userId=${member.user.id}&at=2026-03-01T00:00:00.000Z`, org.headers)).json();
    expect(membership.data.academicYearId).toBe(year.id);
    expect(membership.data.isSeasonMember).toBe(true);
  });

  it('versions an academic year instead of rewriting the approved boundaries', async () => {
    const { org, president, year } = await approvedYear();
    const revised = await post(`/api/v1/calendar/academic-years/${year.id}/revise`, org.headers, { endsAt: '2026-07-31T00:00:00.000Z' });
    expect(revised.status).toBe(201);
    const next = (await revised.json()).data;
    expect(next.version).toBe(2);
    expect(next.status).toBe('proposed');
    const old = await (await get(`/api/v1/calendar/academic-years?status=superseded`)).json();
    expect(old.data[0].id).toBe(year.id);
    const reApproved = await post(`/api/v1/calendar/academic-years/${next.id}/approve`, president.headers);
    expect(reApproved.status).toBe(200);
  });
});
