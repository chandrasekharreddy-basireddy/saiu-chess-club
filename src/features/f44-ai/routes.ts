import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { badRequest } from '../../core/errors.js';
import * as svc from './service.js';

/** Mounted at /api/v1/ai — optional assistance; nothing here is required by core workflows. */
export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/status', requireAuth(), requirePermission('ai.use', 'ai.manage'), async (c) =>
    ok(c, {
      ...(await svc.budgetState(ctx)),
      useCases: Object.entries(svc.ALLOWED_USE_CASES).map(([key, description]) => ({ key, description })),
      note: 'AI is advisory. Core club operations function with AI disabled.',
    }),
  );

  app.post('/assist', requireAuth(), requirePermission('ai.use'), async (c) => {
    const s = c.get('session')!;
    const input = (c.get('parsedBody') as any) || {};
    if (input?.apiKey != null) throw badRequest('API keys are held server-side only');
    return ok(c, await svc.assist(ctx, s.userId, input));
  });

  app.get('/budget', requireAuth(), requirePermission('ai.manage'), async (c) =>
    ok(c, await svc.listLedger(ctx, { kind: c.req.query('kind') })),
  );

  app.post('/budget/topup', requireAuth(), requirePermission('ai.manage'), async (c) => {
    const s = c.get('session')!;
    return svc.requestTopUp(ctx, s.userId);
  });

  app.get('/calls', requireAuth(), requirePermission('ai.manage'), async (c) =>
    ok(c, await svc.listCalls(ctx, Number(c.req.query('limit')) || 50)),
  );

  app.get('/proposals', requireAuth(), requirePermission('ai.manage'), async (c) =>
    ok(c, await svc.listProposals(ctx)),
  );

  app.post('/proposals', requireAuth(), requirePermission('ai.use'), async (c) => {
    const s = c.get('session')!;
    return created(c, await svc.createProposal(ctx, s.userId, (c.get('parsedBody') as any) || {}));
  });

  app.post('/proposals/:id/decide', requireAuth(), requirePermission('ai.manage'), async (c) => {
    const s = c.get('session')!;
    return ok(c, await svc.decideProposal(ctx, s.userId, c.req.param('id'), (c.get('parsedBody') as any) || {}));
  });
}
