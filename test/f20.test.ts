import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 20 — Club Finance & Fund Management', () => {
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

  /** committee member records a contribution of ₹5,000 (500000 paise); the president approves it. */
  const fundedClub = async () => {
    const treasurer = await seedUser(ctx, { roles: ['committee'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const contribution = await (
      await post('/api/v1/finance/contributions', treasurer.headers, {
        source: 'Alumni sponsorship',
        kind: 'sponsorship',
        amountPaise: 500000,
      })
    ).json();
    await post(`/api/v1/finance/contributions/${contribution.data.id}/approve`, president.headers);
    return { treasurer, president, contribution: contribution.data };
  };

  it('records a contribution and posts it to the ledger once a second person approves', async () => {
    const treasurer = await seedUser(ctx, { roles: ['committee'] });
    const president = await seedUser(ctx, { roles: ['president'] });
    const res = await post('/api/v1/finance/contributions', treasurer.headers, { source: 'Membership fees', amountPaise: 250000 });
    expect(res.status).toBe(201);
    const contribution = (await res.json()).data;
    expect(contribution.status).toBe('pending');

    const approved = await post(`/api/v1/finance/contributions/${contribution.id}/approve`, president.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('approved');
  });

  it('reports a balance that reconciles income minus expense with a balanced double entry', async () => {
    const { president } = await fundedClub();
    const balance = await (await get('/api/v1/finance/balance', president.headers)).json();
    expect(balance.data.incomePaise).toBe(500000);
    expect(balance.data.balancePaise).toBe(500000);

    const ledger = await (await get('/api/v1/finance/ledger', president.headers)).json();
    expect(ledger.data.length).toBe(2);
    const debits = ledger.data.reduce((a: number, r: any) => a + r.debitPaise, 0);
    const credits = ledger.data.reduce((a: number, r: any) => a + r.creditPaise, 0);
    expect(debits).toBe(credits);
  });

  it('keeps finance records away from ordinary members', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const balance = await get('/api/v1/finance/balance', member.headers);
    expect(balance.status).toBe(403);

    const expense = await post('/api/v1/finance/expenses', member.headers, { description: 'Chess sets', amountPaise: 100000 });
    expect(expense.status).toBe(403);
  });

  it('requires a second person to approve an expense and reduces the balance', async () => {
    const { president } = await fundedClub();
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const created = await (await post('/api/v1/finance/expenses', president.headers, {
      description: 'Inter-university travel',
      amountPaise: 200000,
      category: 'travel',
      receiptFileId: 'receipt_001',
    })).json();
    expect(created.data.status).toBe('requested');

    const selfApproval = await post(`/api/v1/finance/expenses/${created.data.id}/approve`, president.headers);
    expect(selfApproval.status).toBe(403);

    const approved = await post(`/api/v1/finance/expenses/${created.data.id}/approve`, admin.headers);
    expect(approved.status).toBe(200);

    const balance = await (await get('/api/v1/finance/balance', president.headers)).json();
    expect(balance.data.balancePaise).toBe(300000);
  });

  it('refuses an approval that would take the balance negative', async () => {
    const { president } = await fundedClub();
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const created = await (await post('/api/v1/finance/expenses', president.headers, {
      description: 'Imported tournament clocks',
      amountPaise: 900000,
      category: 'equipment',
      receiptFileId: 'receipt_002',
    })).json();

    const approved = await post(`/api/v1/finance/expenses/${created.data.id}/approve`, admin.headers);
    expect(approved.status).toBe(422);

    const balance = await (await get('/api/v1/finance/balance', president.headers)).json();
    expect(balance.data.balancePaise).toBe(500000);
  });

  it('refuses an approval without a receipt and rejects non-integer paise', async () => {
    const { treasurer, president } = await fundedClub();
    const created = await (await post('/api/v1/finance/expenses', treasurer.headers, {
      description: 'Refreshments for blitz night',
      amountPaise: 50000,
      category: 'refreshments',
    })).json();

    const noReceipt = await post(`/api/v1/finance/expenses/${created.data.id}/approve`, president.headers);
    expect(noReceipt.status).toBe(422);

    const fractional = await post('/api/v1/finance/expenses', treasurer.headers, {
      description: 'Bad amount',
      amountPaise: 1234.5,
    });
    expect(fractional.status).toBe(400);
  });

  it('closes a period with a frozen, reconciled snapshot', async () => {
    const { president } = await fundedClub();
    const closed = await post('/api/v1/finance/periods/close', president.headers, { label: 'FY 2025-26 Q3' });
    expect(closed.status).toBe(201);
    const period = (await closed.json()).data;
    expect(period.balancePaise).toBe(500000);
  });
});
