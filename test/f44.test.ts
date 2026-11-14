import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 44 — Artificial Intelligence & Intelligent Assistance', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx; repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  /** 200000 chars at 1 paise per 20 chars = exactly the ₹100 (10000 paise) budget. */
  const budgetExhaustingPrompt = 'x'.repeat(200000);

  it('serves an allowlisted use case and debits the rupee-paise budget ledger', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/ai/assist', member.headers, {
      useCase: 'tournament.summary',
      prompt: 'Summarise round 3 of the club rapid event for the notice board',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.source).toBe('ai');
    expect(body.data.costPaise).toBeGreaterThan(0);
    expect(body.data.balanceAfterPaise).toBe(10000 - body.data.costPaise);
    expect(body.data.advisoryOnly).toBe(true);
    expect(body.data.canMutateRecords).toBe(false);
    expect(body.data.apiKey).toBeUndefined();

    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const ledger = await (await get('/api/v1/ai/budget', admin.headers)).json();
    expect(ledger.data.entries.length).toBe(1);
    expect(ledger.data.entries[0].kind).toBe('debit');
    expect(ledger.data.entries[0].paise).toBe(body.data.costPaise);
    expect(ledger.data.totalDebitPaise).toBe(body.data.costPaise);
    expect(ledger.data.remainingPaise).toBe(body.data.balanceAfterPaise);
  });

  it('rejects non-allowlisted use cases, client-supplied keys and unauthenticated callers', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const notAllowed = await post('/api/v1/ai/assist', member.headers, {
      useCase: 'change.ratings',
      prompt: 'Bump everyone 100 points',
    });
    expect(notAllowed.status).toBe(422);

    const withKey = await post('/api/v1/ai/assist', member.headers, {
      useCase: 'admin.summary',
      prompt: 'Summarise',
      apiKey: 'sk-client-supplied',
    });
    expect(withKey.status).toBe(400);

    expect((await post('/api/v1/ai/assist', {}, { useCase: 'admin.summary', prompt: 'x' })).status).toBe(401);
    expect((await get('/api/v1/ai/budget', member.headers)).status).toBe(403);
  });

  it('refuses calls with 429 once the ₹100 free-credit budget is exhausted', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const big = await post('/api/v1/ai/assist', member.headers, {
      useCase: 'analysis.explanation',
      prompt: budgetExhaustingPrompt,
    });
    expect(big.status).toBe(200);
    expect((await big.json()).data.remainingPaise).toBe(0);

    const refused = await post('/api/v1/ai/assist', member.headers, {
      useCase: 'analysis.explanation',
      prompt: 'Explain the Sicilian Defence',
    });
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe('QUOTA_EXCEEDED');

    const status = await (await get('/api/v1/ai/status', member.headers)).json();
    expect(status.data.exhausted).toBe(true);
    expect(status.data.aiEnabled).toBe(false);
    expect(status.data.spentPaise).toBe(10000);
    expect(status.data.paidTopUps).toBe(false);
  });

  it('degrades to a deterministic non-AI response instead of an error page', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    await post('/api/v1/ai/assist', member.headers, {
      useCase: 'analysis.explanation',
      prompt: budgetExhaustingPrompt,
    });

    const first = await post('/api/v1/ai/assist', member.headers, {
      useCase: 'learning.recommendations',
      prompt: 'Suggest study material for a 1200-rated player',
      mode: 'auto',
    });
    expect(first.status).toBe(200);
    const a = await first.json();
    expect(a.data.degraded).toBe(true);
    expect(a.data.source).toBe('deterministic');
    expect(a.data.reason).toBe('budget_exhausted');
    expect(a.data.costPaise).toBe(0);
    expect(a.data.text).toContain('without AI assistance');

    const second = await (await post('/api/v1/ai/assist', member.headers, {
      useCase: 'learning.recommendations',
      prompt: 'Suggest study material for a 1200-rated player',
      mode: 'auto',
    })).json();
    expect(second.data.text).toBe(a.data.text);
    expect(second.data.remainingPaise).toBe(0);
  });

  it('has no paid top-up or auto-recharge path', async () => {
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const topUp = await post('/api/v1/ai/budget/topup', admin.headers, { paise: 50000 });
    expect(topUp.status).toBe(403);

    const member = await seedUser(ctx, { roles: ['member'] });
    const inCall = await post('/api/v1/ai/assist', member.headers, {
      useCase: 'admin.summary',
      prompt: 'Summarise',
      topUpPaise: 50000,
    });
    expect(inCall.status).toBe(403);
  });

  it('keeps AI advisory: no proposals against authoritative records, human approval required', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const ratingChange = await post('/api/v1/ai/proposals', member.headers, {
      targetTable: 'ratings',
      summary: 'Increase everyone by 50 points',
    });
    expect(ratingChange.status).toBe(422);

    const draft = await post('/api/v1/ai/proposals', member.headers, {
      targetTable: 'notice_drafts',
      useCase: 'admin.summary',
      summary: 'Draft a notice about the inter-university fixture',
    });
    expect(draft.status).toBe(201);
    const created = await draft.json();
    expect(created.data.status).toBe('pending_human_approval');
    expect(created.data.applied).toBe(false);
    expect(created.data.requiresManualEntry).toBe(true);

    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const decided = await post(`/api/v1/ai/proposals/${created.data.id}/decide`, admin.headers, {
      decision: 'approve',
    });
    expect(decided.status).toBe(200);
    const decidedBody = await decided.json();
    expect(decidedBody.data.status).toBe('approved_by_human');
    expect(decidedBody.data.applied).toBe(false);
  });
});
