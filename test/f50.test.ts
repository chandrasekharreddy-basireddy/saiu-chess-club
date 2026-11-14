import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 50 — Unified Command Centre & Institutional Operations Hub', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    repo = h.repo;
    app = buildApp(ctx);
  });

  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const seedOperations = async () => {
    const now = ctx.now();
    await repo.insert('ops_tasks', {
      id: ctx.newId(), title: 'Overdue pairings', assigneeId: 'u_ops', status: 'open',
      priority: 'high', dueDate: '2026-01-10T09:00:00.000Z', createdAt: now,
    });
    await repo.insert('ops_tasks', {
      id: ctx.newId(), title: 'Future venue booking', assigneeId: 'u_ops', status: 'in_progress',
      priority: 'normal', dueDate: '2026-02-10T09:00:00.000Z', createdAt: now,
    });
    await repo.insert('ops_alerts', {
      id: ctx.newId(), title: 'Flooded hall', severity: 'critical', status: 'open',
      escalationLevel: 1, ackDueAt: '2026-01-15T09:15:00.000Z', createdAt: now,
    });
    await repo.insert('ops_alerts', {
      id: ctx.newId(), title: 'Old resolved alert', severity: 'low', status: 'resolved',
      escalationLevel: 0, createdAt: now,
    });
    await repo.insert('academic_years', {
      id: ctx.newId(), label: '2026-27', startsOn: '2026-08-01T00:00:00.000Z',
      endsOn: '2027-05-31T00:00:00.000Z', isCurrent: true, version: 1, createdAt: now,
    });
  };

  it('serves one aggregated snapshot behind command.view', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const member = await seedUser(ctx, { roles: ['member'] });

    expect((await get('/api/v1/command-centre/snapshot', member.headers)).status).toBe(403);

    await seedOperations();
    const res = await get('/api/v1/command-centre/snapshot', president.headers);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.counts.ops_tasks).toBe(2);
    expect(body.data.summary.overdueTaskCount).toBe(1);
    expect(body.data.summary.openAlertCount).toBe(1);
    expect(body.data.summary.criticalAlertCount).toBe(1);
    expect(body.data.currentAcademicYear.label).toBe('2026-27');
  });

  it('reports source timestamps and degrades gracefully on an empty platform', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const res = await get('/api/v1/command-centre/snapshot', admin.headers);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.generatedAt).toBe('2026-01-15T09:00:00.000Z');
    expect(typeof body.data.counts.ops_tasks).toBe('number');
    expect(Array.isArray(body.data.sources)).toBe(true);
    expect(body.data.sources.length).toBeGreaterThan(0);
    expect(body.data.overdueTasks.length).toBe(0);
    expect(body.data.currentAcademicYear).toBe(null);
  });

  it('records every snapshot it serves', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    await get('/api/v1/command-centre/snapshot', president.headers);
    expect(await repo.count('command_snapshots', {})).toBe(1);
  });

  it('gives each role only its own widgets, linked to the specialist modules', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const president = await seedUser(ctx, { roles: ['president'] });

    const memberWidgets = (await (await get('/api/v1/command-centre/widgets', member.headers)).json()).data;
    const keys = memberWidgets.widgets.map((w: any) => w.key);
    expect(keys).toContain('personal-chess');
    expect(keys).not.toContain('governance-approvals');

    const presidentWidgets = (await (await get('/api/v1/command-centre/widgets', president.headers)).json()).data;
    const presidentKeys = presidentWidgets.widgets.map((w: any) => w.key);
    expect(presidentKeys).toContain('governance-approvals');
    expect(presidentWidgets.widgets.find((w: any) => w.key === 'critical-alerts').href).toBe('/api/v1/alerts');
  });
});
