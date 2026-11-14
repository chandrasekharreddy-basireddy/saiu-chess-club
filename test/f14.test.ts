import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 14 — Volunteer & Participation Management', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  async function makeShift(organizer: any, capacity = 2) {
    const opp = (await (await post('/api/v1/volunteers/opportunities', organizer.headers, {
      title: 'SaiU Open — desk duty', description: 'Registration desk', capacity: 4,
    })).json()).data;
    const shift = (await (await post(`/api/v1/volunteers/opportunities/${opp.id}/shifts`, organizer.headers, {
      role: 'registration_desk', startsAt: '2026-02-01T04:00:00.000Z', endsAt: '2026-02-01T08:00:00.000Z', capacity,
    })).json()).data;
    return { opp, shift };
  }

  it('lets an organizer publish an opportunity and a volunteer take a shift', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const volunteer = await seedUser(ctx, { roles: ['member'] });
    const { opp, shift } = await makeShift(organizer);
    expect(shift.capacity).toBe(2);

    const res = await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, volunteer.headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('assigned');
    expect(body.data.opportunityId).toBe(opp.id);

    const mine = await (await get('/api/v1/volunteers/shifts/mine', volunteer.headers)).json();
    expect(mine.data.length).toBe(1);
    expect(mine.data[0].shift.role).toBe('registration_desk');
  });

  it('keeps opportunity management behind volunteer.manage', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/volunteers/opportunities', member.headers, { title: 'Unofficial drive' });
    expect(res.status).toBe(403);
  });

  it('enforces shift capacity and releases a seat on withdrawal', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const { shift } = await makeShift(organizer, 1);

    const first = await (await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, a.headers)).json();
    expect(first.data.status).toBe('assigned');

    const full = await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, b.headers);
    expect(full.status).toBe(409);

    expect((await post(`/api/v1/volunteers/assignments/${first.data.id}/withdraw`, a.headers)).status).toBe(200);

    const after = await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, b.headers);
    expect(after.status).toBe(201);
  });

  it('rejects a duplicate signup for the same shift', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const a = await seedUser(ctx, { roles: ['member'] });
    const { shift } = await makeShift(organizer);
    expect((await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, a.headers)).status).toBe(201);
    expect((await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, a.headers)).status).toBe(409);
  });

  it('records attendance once and audits the check-in', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const a = await seedUser(ctx, { roles: ['member'] });
    const { shift } = await makeShift(organizer);
    const assignment = (await (await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, a.headers)).json()).data;

    expect((await post(`/api/v1/volunteers/assignments/${assignment.id}/checkin`, a.headers)).status).toBe(409);
    expect((await post(`/api/v1/volunteers/assignments/${assignment.id}/confirm`, a.headers, { accept: true })).status).toBe(200);
    const checked = await post(`/api/v1/volunteers/assignments/${assignment.id}/checkin`, a.headers);
    expect(checked.status).toBe(200);
    expect((await checked.json()).data.status).toBe('checked_in');
    expect((await post(`/api/v1/volunteers/assignments/${assignment.id}/checkin`, a.headers)).status).toBe(409);

    const stored = await repo.get('volunteer_assignments', assignment.id);
    expect(stored.checkedInAt).toBeTruthy();
  });

  it('restricts the roster and task sign-off to supervisors, requiring attendance first', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const a = await seedUser(ctx, { roles: ['member'] });
    const { opp, shift } = await makeShift(organizer);
    const assignment = (await (await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, a.headers)).json()).data;

    expect((await get(`/api/v1/volunteers/opportunities/${opp.id}/roster`, a.headers)).status).toBe(403);
    const roster = await (await get(`/api/v1/volunteers/opportunities/${opp.id}/roster`, organizer.headers)).json();
    expect(roster.data.assignments.length).toBe(1);

    await post(`/api/v1/volunteers/assignments/${assignment.id}/confirm`, a.headers, { accept: true });
    expect((await post(`/api/v1/volunteers/assignments/${assignment.id}/complete`, organizer.headers, { feedback: 'early' })).status).toBe(409);

    await post(`/api/v1/volunteers/assignments/${assignment.id}/checkin`, a.headers);
    const done = await post(`/api/v1/volunteers/assignments/${assignment.id}/complete`, organizer.headers, {
      feedback: 'Handled the desk calmly', rating: 5,
    });
    expect(done.status).toBe(200);
    expect((await done.json()).data.status).toBe('completed');

    const history = await (await get('/api/v1/volunteers/me/history', a.headers)).json();
    expect(history.data.completedAssignments).toBe(1);
    expect(history.data.totalHours).toBe(4);
  });

  it('keeps volunteers to their own assignments', async () => {
    const organizer = await seedUser(ctx, { roles: ['organizer'] });
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const { shift } = await makeShift(organizer);
    await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, a.headers);
    await post(`/api/v1/volunteers/shifts/${shift.id}/signup`, b.headers);

    const mineA = await (await get('/api/v1/volunteers/shifts/mine', a.headers)).json();
    const mineB = await (await get('/api/v1/volunteers/shifts/mine', b.headers)).json();
    expect(mineA.data.length).toBe(1);
    expect(mineB.data.length).toBe(1);
    expect(mineA.data[0].volunteerId).toBe(a.user.id);
    expect(mineB.data[0].volunteerId).toBe(b.user.id);
  });
});
