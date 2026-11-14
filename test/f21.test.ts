import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 21 — Equipment & Inventory Management', () => {
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

  const makeAsset = async (org: any, over: any = {}) => {
    const res = await post('/api/v1/inventory', org.headers, {
      assetTag: 'BRD-001',
      name: 'Vinyl tournament boards',
      category: 'boards',
      quantity: 10,
      replacementValue: 25000,
      ...over,
    });
    return res;
  };

  it('registers an asset with unique identifiers and unit counts', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const res = await makeAsset(org);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.assetTag).toBe('BRD-001');
    expect(body.data.status).toBe('available');
    expect(body.data.counts.available).toBe(10);

    const dup = await makeAsset(org);
    expect(dup.status).toBe(409);
  });

  it('denies asset registration to a member without inventory.manage', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await makeAsset(member);
    expect(res.status).toBe(403);
  });

  it('issues and returns units without ever going negative', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const borrower = await seedUser(ctx, { roles: ['member'] });
    const asset = (await (await makeAsset(org)).json()).data;

    const out = await post(`/api/v1/inventory/${asset.id}/checkout`, org.headers, {
      quantity: 4,
      borrowerId: borrower.user.id,
    });
    expect(out.status).toBe(200);
    const outBody = await out.json();
    expect(outBody.data.asset.counts.onLoan).toBe(4);
    expect(outBody.data.asset.counts.available).toBe(6);

    const tooMany = await post(`/api/v1/inventory/${asset.id}/checkout`, org.headers, { quantity: 7 });
    expect(tooMany.status).toBe(409);

    const overReturn = await post(`/api/v1/inventory/${asset.id}/checkin`, org.headers, { quantity: 5 });
    expect(overReturn.status).toBe(409);

    const back = await post(`/api/v1/inventory/${asset.id}/checkin`, org.headers, { quantity: 2, condition: 'good' });
    expect(back.status).toBe(200);
    const backBody = await back.json();
    expect(backBody.data.asset.counts.onLoan).toBe(2);
    expect(backBody.data.asset.counts.available).toBe(8);
  });

  it('writes off damaged stock and keeps quantity === available + onLoan + damaged + lost', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const asset = (await (await makeAsset(org)).json()).data;
    await post(`/api/v1/inventory/${asset.id}/checkout`, org.headers, { quantity: 1 });

    const wo = await post(`/api/v1/inventory/${asset.id}/write-off`, org.headers, { quantity: 3, kind: 'damaged' });
    expect(wo.status).toBe(200);
    const counts = (await wo.json()).data.counts;
    expect(counts.damaged).toBe(3);
    expect(counts.available).toBe(6);
    expect(counts.quantity).toBe(counts.available + counts.onLoan + counts.damaged + counts.lost);

    const tooMuch = await post(`/api/v1/inventory/${asset.id}/write-off`, org.headers, { quantity: 99, kind: 'lost' });
    expect(tooMuch.status).toBe(409);

    const badKind = await post(`/api/v1/inventory/${asset.id}/write-off`, org.headers, { quantity: 1, kind: 'stolen' });
    expect(badKind.status).toBe(400);
  });

  it('flags overdue loans and lists a borrower’s own loans', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const borrower = await seedUser(ctx, { roles: ['member'] });
    const asset = (await (await makeAsset(org)).json()).data;

    await post(`/api/v1/inventory/${asset.id}/checkout`, org.headers, {
      quantity: 2,
      borrowerId: borrower.user.id,
      dueAt: '2026-01-10T09:00:00.000Z', // ctx.now() is 2026-01-15
    });

    const detail = (await (await get(`/api/v1/inventory/${asset.id}`, org.headers)).json()).data;
    expect(detail.loans.length).toBe(1);
    expect(detail.loans[0].overdue).toBe(true);

    const mine = (await (await get('/api/v1/inventory/loans/mine', borrower.headers)).json()).data;
    expect(mine.length).toBe(1);
    expect(mine[0].borrowerId).toBe(borrower.user.id);
  });

  it('requires an independent approval before disposal', async () => {
    const org = await seedUser(ctx, { roles: ['organizer'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const asset = (await (await makeAsset(org)).json()).data;

    await post(`/api/v1/inventory/${asset.id}/checkout`, org.headers, { quantity: 1 });
    const whileLoaned = await post(`/api/v1/inventory/${asset.id}/disposal/request`, org.headers, { reason: 'worn out' });
    expect(whileLoaned.status).toBe(409);

    await post(`/api/v1/inventory/${asset.id}/checkin`, org.headers, { quantity: 1 });
    const requested = await post(`/api/v1/inventory/${asset.id}/disposal/request`, org.headers, { reason: 'worn out' });
    expect(requested.status).toBe(201);
    expect((await requested.json()).data.disposalStatus).toBe('requested');

    const self = await post(`/api/v1/inventory/${asset.id}/disposal/approve`, org.headers);
    expect(self.status).toBe(403);

    const approved = await post(`/api/v1/inventory/${asset.id}/disposal/approve`, president.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('disposed');

    const afterDisposal = await post(`/api/v1/inventory/${asset.id}/checkout`, org.headers, { quantity: 1 });
    expect(afterDisposal.status).toBe(409);
  });
});
