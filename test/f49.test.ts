import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 49 — Academic-Year Institutional Command View', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const YEAR_2627 = { label: '2026-27', startsOn: '2026-08-01T00:00:00.000Z', endsOn: '2027-05-31T00:00:00.000Z' };
  const YEAR_2728 = { label: '2027-28', startsOn: '2027-08-01T00:00:00.000Z', endsOn: '2028-05-31T00:00:00.000Z' };

  it('creates a versioned academic year that is not current until activated', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const res = await post('/api/v1/academic-year/years', president.headers, YEAR_2627);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.isCurrent).toBe(false);
    expect(body.data.version).toBe(1);
    expect(body.data.approvedBy).toBe(president.user.id);
  });

  it('rejects reversed and overlapping academic-year ranges', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const reversed = await post('/api/v1/academic-year/years', president.headers, {
      label: 'Broken',
      startsOn: '2027-05-31T00:00:00.000Z',
      endsOn: '2026-08-01T00:00:00.000Z',
    });
    expect(reversed.status).toBe(400);

    await post('/api/v1/academic-year/years', president.headers, YEAR_2627);
    const overlapping = await post('/api/v1/academic-year/years', president.headers, {
      label: 'Clashing',
      startsOn: '2027-01-01T00:00:00.000Z',
      endsOn: '2027-12-31T00:00:00.000Z',
    });
    expect(overlapping.status).toBe(409);
  });

  it('allows exactly one current academic year', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const first = (await (await post('/api/v1/academic-year/years', president.headers, YEAR_2627)).json()).data;
    const second = (await (await post('/api/v1/academic-year/years', president.headers, YEAR_2728)).json()).data;

    const activated = await post(`/api/v1/academic-year/years/${first.id}/activate`, president.headers);
    expect((await activated.json()).data.isCurrent).toBe(true);

    await post(`/api/v1/academic-year/years/${second.id}/activate`, president.headers);

    const years = await (await get('/api/v1/academic-year/years', president.headers)).json();
    const current = years.data.items.filter((y: any) => y.isCurrent);
    expect(current.length).toBe(1);
    expect(current[0].id).toBe(second.id);

    const currentYear = await (await get('/api/v1/academic-year/current', president.headers)).json();
    expect(currentYear.data.label).toBe('2027-28');
  });

  it('builds a timeline with upcoming dates and freshness metadata', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const year = (await (await post('/api/v1/academic-year/years', president.headers, YEAR_2627)).json()).data;

    await post(`/api/v1/academic-year/years/${year.id}/events`, president.headers, {
      title: 'Semester 1 begins',
      kind: 'semester',
      startsOn: '2026-09-01T00:00:00.000Z',
    });
    await post(`/api/v1/academic-year/years/${year.id}/events`, president.headers, {
      title: 'Committee handover',
      kind: 'committee_cycle',
      startsOn: '2025-12-01T00:00:00.000Z',
    });

    const timeline = await (await get(`/api/v1/academic-year/years/${year.id}/timeline`, president.headers)).json();
    expect(timeline.data.events.length).toBe(2);
    expect(timeline.data.upcomingCount).toBe(1);
    expect(timeline.data.progressPercent).toBe(0);
    expect(timeline.data.daysRemaining).toBeGreaterThan(0);
    expect(timeline.data.metrics.upcomingCount.source).toBe('academic_year_events');
  });

  it('keeps historical years and versions a revised year', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const year = (await (await post('/api/v1/academic-year/years', president.headers, YEAR_2627)).json()).data;
    await post(`/api/v1/academic-year/years/${year.id}/activate`, president.headers);

    const revised = await post(`/api/v1/academic-year/years/${year.id}/revise`, president.headers, {
      endsOn: '2027-06-15T00:00:00.000Z',
    });
    expect(revised.status).toBe(201);
    const revisedBody = await (await revised.json()).data;
    expect(revisedBody.version).toBe(2);
    expect(revisedBody.isCurrent).toBe(true);

    const current = await (await get('/api/v1/academic-year/current', president.headers)).json();
    expect(current.data.version).toBe(2);

    const years = await (await get('/api/v1/academic-year/years', president.headers)).json();
    expect(years.data.items.filter((y: any) => y.isCurrent).length).toBe(1);
    expect(years.data.items.some((y: any) => y.status === 'superseded')).toBe(true);
  });

  it('filters the academic-year view by permission', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await get('/api/v1/academic-year/current', member.headers)).status).toBe(403);
    expect((await get('/api/v1/academic-year/years', member.headers)).status).toBe(403);
    expect((await post('/api/v1/academic-year/years', member.headers, YEAR_2627)).status).toBe(403);
  });
});
