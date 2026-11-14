import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 30 — Feedback, Complaints & Support', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const staff = () => seedUser(ctx, { roles: ['committee'] });
  const submit = (user: any, extra: any = {}) => post('/api/v1/support/tickets', user.headers, {
    category: 'technical', subject: 'Rating page shows the wrong score', body: 'My blitz rating is stale after the last round.', ...extra,
  });

  it('opens a ticket with a priority-derived SLA due time', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await submit(member, { priority: 'high' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('open');
    expect(body.data.priority).toBe('high');
    // ctx.now() is 2026-01-15T09:00:00.000Z and high priority is 8 hours
    expect(body.data.slaDueAt).toBe('2026-01-15T17:00:00.000Z');
    expect(body.data.escalated).toBe(false);
    expect(body.data.slaStatus).toBe('on_track');
  });

  it('validates categories and priorities', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await submit(member, { category: 'parking' })).status).toBe(400);
    expect((await submit(member, { priority: 'yesterday' })).status).toBe(400);
    expect((await post('/api/v1/support/tickets', member.headers, { category: 'technical', subject: 'x' })).status).toBe(400);
  });

  it('restricts the staff queue and staff actions to support handlers', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const id = (await (await submit(member)).json()).data.id;
    expect((await get('/api/v1/support/queue', member.headers)).status).toBe(403);
    expect((await post(`/api/v1/support/tickets/${id}/assign`, member.headers, {})).status).toBe(403);
    expect((await post(`/api/v1/support/tickets/${id}/resolve`, member.headers, { resolution: 'x' })).status).toBe(403);
  });

  it('walks the open -> in_progress -> resolved -> closed lifecycle', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const handler = await staff();
    const id = (await (await submit(member)).json()).data.id;

    // resolve before any acknowledgement is still allowed from open, close is not
    expect((await post(`/api/v1/support/tickets/${id}/close`, member.headers)).status).toBe(409);

    const assigned = await post(`/api/v1/support/tickets/${id}/assign`, handler.headers, {});
    expect(assigned.status).toBe(200);
    expect((await assigned.json()).data.status).toBe('in_progress');

    const resolved = await post(`/api/v1/support/tickets/${id}/resolve`, handler.headers, { resolution: 'Rating cache refreshed' });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data.status).toBe('resolved');

    const closed = await post(`/api/v1/support/tickets/${id}/close`, member.headers);
    expect(closed.status).toBe(200);
    expect((await closed.json()).data.status).toBe('closed');

    // a closed ticket cannot be resolved again
    expect((await post(`/api/v1/support/tickets/${id}/resolve`, handler.headers, { resolution: 'again' })).status).toBe(409);
  });

  it('keeps internal notes hidden from the submitter', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const handler = await staff();
    const id = (await (await submit(member)).json()).data.id;
    await post(`/api/v1/support/tickets/${id}/assign`, handler.headers, {});
    expect((await post(`/api/v1/support/tickets/${id}/notes`, handler.headers, { body: 'Checked the rating job; internal escalation may follow.' })).status).toBe(201);

    const own = await (await get(`/api/v1/support/tickets/${id}`, member.headers)).json();
    expect(own.data.internalNotes).toBeUndefined();
    expect(own.data.status).toBe('in_progress');

    const staffView = await (await get(`/api/v1/support/tickets/${id}`, handler.headers)).json();
    expect(staffView.data.internalNotes.length).toBe(1);
  });

  it('limits reopening to the submitter under policy', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const other = await seedUser(ctx, { roles: ['member'] });
    const handler = await staff();
    const id = (await (await submit(member)).json()).data.id;
    await post(`/api/v1/support/tickets/${id}/assign`, handler.headers, {});
    await post(`/api/v1/support/tickets/${id}/resolve`, handler.headers, { resolution: 'fixed' });

    expect((await post(`/api/v1/support/tickets/${id}/reopen`, other.headers, { reason: 'not mine' })).status).toBe(403);

    const first = await post(`/api/v1/support/tickets/${id}/reopen`, member.headers, { reason: 'still broken' });
    expect(first.status).toBe(200);
    const fbody = await first.json();
    expect(fbody.data.status).toBe('open');
    expect(fbody.data.reopenCount).toBe(1);

    await post(`/api/v1/support/tickets/${id}/assign`, handler.headers, {});
    await post(`/api/v1/support/tickets/${id}/resolve`, handler.headers, { resolution: 'fixed again' });
    expect((await post(`/api/v1/support/tickets/${id}/reopen`, member.headers, { reason: 'again' })).status).toBe(200);

    await post(`/api/v1/support/tickets/${id}/assign`, handler.headers, {});
    await post(`/api/v1/support/tickets/${id}/resolve`, handler.headers, { resolution: 'third fix' });
    expect((await post(`/api/v1/support/tickets/${id}/reopen`, member.headers, { reason: 'third time' })).status).toBe(409);
  });

  it('routes confidential complaints to a narrower permission and records escalation', async () => {
    const complainant = await seedUser(ctx, { roles: ['member'] });
    const bystander = await seedUser(ctx, { roles: ['member'] });
    const ordinaryStaff = await staff();
    const confidentialStaff = await seedUser(ctx, { roles: ['committee'], permissions: ['support.handle', 'support.confidential.handle'] });

    const created = await (await submit(complainant, {
      category: 'confidential_complaint', subject: 'Misconduct at the campus tournament', body: 'Details enclosed.',
    })).json();
    expect(created.data.confidential).toBe(true);
    expect(created.data.queue).toBe('restricted');
    const id = created.data.id;

    expect((await get(`/api/v1/support/tickets/${id}`, bystander.headers)).status).toBe(403);
    expect((await get(`/api/v1/support/tickets/${id}`, ordinaryStaff.headers)).status).toBe(403);
    expect((await get(`/api/v1/support/tickets/${id}`, confidentialStaff.headers)).status).toBe(200);

    const queue = await (await get('/api/v1/support/queue', ordinaryStaff.headers)).json();
    expect(queue.data.length).toBe(0);

    const escalated = await post(`/api/v1/support/tickets/${id}/escalate`, confidentialStaff.headers, { reason: 'Safety concern raised' });
    expect(escalated.status).toBe(200);
    const ebody = await escalated.json();
    expect(ebody.data.escalated).toBe(true);
    expect(ebody.data.escalationReason).toBe('Safety concern raised');
    expect(ebody.data.escalatedTo).toBe('president');

    // the submitter sees the permitted status but not the internal escalation detail
    const own = await (await get(`/api/v1/support/tickets/${id}`, complainant.headers)).json();
    expect(own.data.escalated).toBe(true);
    expect(own.data.escalationReason).toBeUndefined();
    expect(own.data.internalNotes).toBeUndefined();
  });
});
