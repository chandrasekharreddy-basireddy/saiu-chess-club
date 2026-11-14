import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 46 — Club Strategy & Development Planning', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const patch = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const objective = (president: any, extra: any = {}) =>
    post('/api/v1/strategy/objectives', president.headers, {
      title: 'Grow competitive strength',
      definition: 'Reach the top three in the inter-university circuit',
      ownerId: president.user.id,
      reviewDate: '2026-06-30T00:00:00.000Z',
      ...extra,
    });

  it('creates an objective with owner, definition and review date', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const res = await objective(president);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('draft');
    expect(body.data.progressPercent).toBe(0);
    expect(body.data.ownerId).toBe(president.user.id);
  });

  it('rejects an objective that has no measurable owner or review date', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const res = await post('/api/v1/strategy/objectives', president.headers, { title: 'Unmeasurable', definition: 'Do better' });
    expect(res.status).toBe(400);
  });

  it('keeps strategy records away from ordinary members', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await get('/api/v1/strategy/objectives', member.headers)).status).toBe(403);
    expect((await post('/api/v1/strategy/objectives', member.headers, { title: 'x' })).status).toBe(403);
  });

  it('computes a deterministic, clamped progress percentage from key results', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const id = (await (await objective(president)).json()).data.id;

    const kr1 = await (await post(`/api/v1/strategy/objectives/${id}/key-results`, president.headers, {
      title: 'Average rating gain',
      target: 200,
      current: 50,
    })).json();
    expect(kr1.data.percent).toBe(25);

    await post(`/api/v1/strategy/objectives/${id}/key-results`, president.headers, {
      title: 'Titled players',
      target: 4,
      current: 4,
    });

    // (25 + 100) / 2 = 62.5 -> 63
    const detail = await (await get(`/api/v1/strategy/objectives/${id}`, president.headers)).json();
    expect(detail.data.progressPercent).toBe(63);

    // over-achievement is clamped at 100
    await patch(`/api/v1/strategy/key-results/${kr1.data.id}`, president.headers, { current: 999 });
    const after = await (await get(`/api/v1/strategy/objectives/${id}`, president.headers)).json();
    expect(after.data.progressPercent).toBe(100);
  });

  it('tracks milestones, risks and review decisions against the objective', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const id = (await (await objective(president)).json()).data.id;

    const milestone = await post(`/api/v1/strategy/objectives/${id}/milestones`, president.headers, {
      title: 'Squad selection complete',
      dueDate: '2026-09-01T00:00:00.000Z',
      ownerId: president.user.id,
    });
    expect(milestone.status).toBe(201);

    const risk = await (await post(`/api/v1/strategy/objectives/${id}/risks`, president.headers, {
      description: 'Venue booking falls through',
      likelihood: 4,
      impact: 5,
      mitigation: 'Hold a backup hall',
    })).json();
    expect(risk.data.severity).toBe('critical');

    const review = await post(`/api/v1/strategy/objectives/${id}/reviews`, president.headers, {
      scheduledFor: '2026-04-01T00:00:00.000Z',
      decisions: ['Reallocate travel budget to coaching'],
    });
    expect(review.status).toBe(201);

    const detail = await (await get(`/api/v1/strategy/objectives/${id}`, president.headers)).json();
    expect(detail.data.milestones.length).toBe(1);
    expect(detail.data.risks.length).toBe(1);
    expect(detail.data.reviews[0].decisions.length).toBe(1);
  });

  it('requires an independent approver before a public summary is released', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const id = (await (await objective(president)).json()).data.id;

    await post(`/api/v1/strategy/objectives/${id}/public-summary`, president.headers, {
      summary: 'We aim to reach the top three this year.',
    });
    const selfApprove = await post(`/api/v1/strategy/objectives/${id}/public-summary/approve`, president.headers);
    expect(selfApprove.status).toBe(403);

    const approved = await post(`/api/v1/strategy/objectives/${id}/public-summary/approve`, admin.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.publicSummaryStatus).toBe('approved');
  });
});
