import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 47 — Centralized Operational Task Coordination', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const makeTask = async (org: any, body: any) =>
    (await (await post('/api/v1/tasks', org.headers, body)).json()).data;

  it('creates a task with owner, scope, priority and due date', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const res = await post('/api/v1/tasks', org.headers, {
      title: 'Book the main hall',
      scope: 'facility',
      priority: 'high',
      assigneeId: org.user.id,
      dueDate: '2026-02-01T09:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('open');
    expect(body.data.scope).toBe('facility');
    expect(body.data.overdue).toBe(false);
  });

  it('validates the task payload and rejects unknown scopes', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const noAssignee = await post('/api/v1/tasks', org.headers, { title: 'Nobody owns this', dueDate: '2026-02-01T09:00:00.000Z' });
    expect(noAssignee.status).toBe(400);
    const badScope = await post('/api/v1/tasks', org.headers, {
      title: 'Odd scope',
      scope: 'moon-base',
      assigneeId: org.user.id,
      dueDate: '2026-02-01T09:00:00.000Z',
    });
    expect(badScope.status).toBe(400);
  });

  it('does not let a task assignment grant operational permissions', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const member = await seedUser(ctx, { roles: ['member'] });
    await makeTask(org, { title: 'Assigned to a member', assigneeId: member.user.id, dueDate: '2026-02-01T09:00:00.000Z' });
    expect((await get('/api/v1/tasks', member.headers)).status).toBe(403);
    expect((await post('/api/v1/tasks', member.headers, { title: 'x' })).status).toBe(403);
  });

  it('enforces the status machine and an independent completion review', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const reviewer = await seedUser(ctx, { roles: ['organizer'] });
    const task = await makeTask(org, {
      title: 'Publish the round-one pairings',
      assigneeId: org.user.id,
      dueDate: '2026-02-01T09:00:00.000Z',
    });

    const skip = await post(`/api/v1/tasks/${task.id}/transition`, org.headers, { to: 'closed' });
    expect(skip.status).toBe(409);

    await post(`/api/v1/tasks/${task.id}/transition`, org.headers, { to: 'in_progress' });
    const submitted = await post(`/api/v1/tasks/${task.id}/transition`, org.headers, { to: 'submitted', evidence: 'Pairings PDF' });
    expect(submitted.status).toBe(200);

    const selfReview = await post(`/api/v1/tasks/${task.id}/transition`, org.headers, { to: 'closed' });
    expect(selfReview.status).toBe(403);

    const closed = await post(`/api/v1/tasks/${task.id}/transition`, reviewer.headers, { to: 'closed', note: 'Evidence checked' });
    expect(closed.status).toBe(200);
    expect((await closed.json()).data.status).toBe('closed');
  });

  it('derives overdue from the due date and state using ctx.now()', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const late = await makeTask(org, { title: 'Late task', assigneeId: org.user.id, dueDate: '2026-01-10T09:00:00.000Z' });
    const future = await makeTask(org, { title: 'Future task', assigneeId: org.user.id, dueDate: '2026-03-01T09:00:00.000Z' });

    expect(late.overdue).toBe(true);
    expect(future.overdue).toBe(false);

    const overdue = await (await get('/api/v1/tasks/overdue', org.headers)).json();
    expect(overdue.data.length).toBe(1);
    expect(overdue.data[0].id).toBe(late.id);

    const filtered = await (await get('/api/v1/tasks?overdue=true', org.headers)).json();
    expect(filtered.data.length).toBe(1);
  });

  it('blocks work until its dependencies are closed', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const reviewer = await seedUser(ctx, { roles: ['organizer'] });
    const upstream = await makeTask(org, { title: 'Confirm venue', assigneeId: org.user.id, dueDate: '2026-02-01T09:00:00.000Z' });
    const downstream = await makeTask(org, { title: 'Print boards', assigneeId: org.user.id, dueDate: '2026-02-05T09:00:00.000Z' });

    const dep = await post(`/api/v1/tasks/${downstream.id}/dependencies`, org.headers, { dependsOnId: upstream.id });
    expect(dep.status).toBe(201);

    const blocked = await post(`/api/v1/tasks/${downstream.id}/transition`, org.headers, { to: 'in_progress' });
    expect(blocked.status).toBe(409);

    await post(`/api/v1/tasks/${upstream.id}/transition`, org.headers, { to: 'in_progress' });
    await post(`/api/v1/tasks/${upstream.id}/transition`, org.headers, { to: 'submitted' });
    await post(`/api/v1/tasks/${upstream.id}/transition`, reviewer.headers, { to: 'closed' });

    const unblocked = await post(`/api/v1/tasks/${downstream.id}/transition`, org.headers, { to: 'in_progress' });
    expect(unblocked.status).toBe(200);

    const detail = await (await get(`/api/v1/tasks/${downstream.id}`, org.headers)).json();
    expect(detail.data.blockers.length).toBe(0);
    expect(detail.data.history.length).toBe(2);
  });
});
