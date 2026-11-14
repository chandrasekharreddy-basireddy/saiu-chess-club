import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 45 — Unified Institutional Performance & Reporting', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  async function seedTournaments() {
    const open = await repo.insert('tournaments', {
      id: ctx.newId(), name: 'SaiU Open 2026', status: 'registration_open', capacity: 32, createdAt: ctx.now(),
    });
    const done = await repo.insert('tournaments', {
      id: ctx.newId(), name: 'SaiU Blitz 2025', status: 'completed', capacity: 16, createdAt: ctx.now(),
    });
    await repo.insert('tournament_registrations', {
      id: ctx.newId(), tournamentId: open.id, playerId: 'p1', status: 'confirmed', createdAt: ctx.now(),
    });
    await repo.insert('tournament_registrations', {
      id: ctx.newId(), tournamentId: open.id, playerId: 'p2', status: 'confirmed', createdAt: ctx.now(),
    });
    await repo.insert('tournament_registrations', {
      id: ctx.newId(), tournamentId: open.id, playerId: 'p3', status: 'waitlisted', createdAt: ctx.now(),
    });
    return { open, done };
  }

  it('restricts institutional reports to reporting.read', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await get('/api/v1/reporting/summary', member.headers)).status).toBe(403);
    expect((await get('/api/v1/reporting/catalogue', member.headers)).status).toBe(403);

    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    expect((await get('/api/v1/reporting/summary', organizer.headers)).status).toBe(200);
  });

  it('aggregates real counts from the tournament, registration and member tables', async () => {
    await seedTournaments();
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    await seedUser(ctx, { roles: ['member'] });

    const res = await get('/api/v1/reporting/summary', organizer.headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    const metric = (key: string) => body.data.metrics.find((m: any) => m.key === key);

    expect(metric('tournaments.total').value).toBe(2);
    expect(metric('tournaments.active').value).toBe(1);
    expect(metric('registrations.confirmed').value).toBe(2);
    // two accounts were seeded above: the organizer and one member
    expect(metric('members.active').value).toBe(2);
    expect(body.data.dataFreshness.asOf).toBe('2026-01-15T09:00:00.000Z');
    expect(body.data.limitations.length).toBeGreaterThan(0);
  });

  it('documents every metric definition and source', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const body = await (await get('/api/v1/reporting/catalogue', organizer.headers)).json();
    expect(body.data.metrics.length).toBe(5);
    for (const m of body.data.metrics) {
      expect(typeof m.definition).toBe('string');
      expect(m.definition.length).toBeGreaterThan(0);
      expect(typeof m.source).toBe('string');
      expect(m.period).toBeTruthy();
    }
    expect(body.data.smallCellThreshold).toBe(5);

    const summary = await (await get('/api/v1/reporting/summary', organizer.headers)).json();
    for (const m of summary.data.metrics) {
      expect(m.definition).toBeTruthy();
      expect(m.source).toBeTruthy();
    }
  });

  it('suppresses person-level aggregates below the small-cell threshold', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    await seedUser(ctx, { roles: ['member'] });

    const small = await (await get('/api/v1/reporting/summary', organizer.headers)).json();
    const smallRole = small.data.metrics.find((m: any) => m.key === 'members.byRole');
    const memberBucket = smallRole.breakdown.find((b: any) => b.role === 'member');
    expect(memberBucket.suppressed).toBe(true);
    expect(memberBucket.count).toBeNull();

    for (let i = 0; i < 5; i++) await seedUser(ctx, { roles: ['member'] });
    const larger = await (await get('/api/v1/reporting/summary', organizer.headers)).json();
    const largerRole = larger.data.metrics.find((m: any) => m.key === 'members.byRole');
    const grownBucket = largerRole.breakdown.find((b: any) => b.role === 'member');
    expect(grownBucket.suppressed).toBe(false);
    expect(grownBucket.count).toBe(6);
  });

  it('degrades a single metric when a source table cannot be read', async () => {
    await seedTournaments();
    const organizer = await seedUser(ctx, { roles: ['organizer'] });

    const original = ctx.repo.find.bind(ctx.repo);
    ctx.repo.find = async (table: string, filter?: any, opts?: any) => {
      if (table === 'tournaments') throw new Error('table unavailable');
      return original(table, filter, opts);
    };

    const res = await get('/api/v1/reporting/summary', organizer.headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    const total = body.data.metrics.find((m: any) => m.key === 'tournaments.total');
    expect(total.value).toBeNull();
    expect(total.available).toBe(false);
    expect(body.data.metrics.find((m: any) => m.key === 'registrations.confirmed').value).toBe(2);
    expect(body.data.limitations.some((l: string) => l.includes('tournaments'))).toBe(true);

    ctx.repo.find = original;
  });

  it('builds a participation report with fill rates', async () => {
    const { open } = await seedTournaments();
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const body = await (await get('/api/v1/reporting/reports/tournaments', organizer.headers)).json();
    const row = body.data.rows.find((r: any) => r.id === open.id);
    expect(row.confirmedRegistrations).toBe(2);
    expect(row.waitlisted).toBe(1);
    expect(row.fillRate).toBe(0.06);
    expect(body.data.totals.confirmedRegistrations).toBe(2);
  });

  it('audits exports and keeps finance restricted', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const exported = await post('/api/v1/reporting/exports', organizer.headers, { reportKey: 'summary' });
    expect(exported.status).toBe(201);
    const exportRow = await exported.json();
    expect(exportRow.data.reportKey).toBe('summary');
    expect(exportRow.data.requestedBy).toBe(organizer.user.id);

    const history = await (await get('/api/v1/reporting/exports', organizer.headers)).json();
    expect(history.data.length).toBe(1);

    const financeExport = await post('/api/v1/reporting/exports', organizer.headers, { reportKey: 'finance' });
    expect(financeExport.status).toBe(403);
    expect((await get('/api/v1/reporting/reports/finance', organizer.headers)).status).toBe(403);

    const president = await seedUser(ctx, { roles: ['president'] });
    const finance = await get('/api/v1/reporting/reports/finance', president.headers);
    expect(finance.status).toBe(200);
    expect((await finance.json()).data.restricted).toBe(true);
  });
});
