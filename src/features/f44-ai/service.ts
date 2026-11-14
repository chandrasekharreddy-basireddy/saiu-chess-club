import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { quotaExceeded } from '../../core/errors.js';

/**
 * Feature 44 — Artificial Intelligence & Intelligent Assistance
 * Tables owned by this feature:
 *   ai_budget_ledger   append-only rupee/paise debit ledger against the ₹100 free credit budget
 *   ai_calls           per-call usage counters (completed / refused / fallback)
 *   ai_proposals       advisory drafts that a human must act on; never applied by AI
 *
 * Budget: ₹100 = 10000 paise, free credits only. There is no paid top-up, no auto-recharge
 * and no paid fallback — `requestTopUp` always refuses. When the budget is exhausted AI calls
 * are refused with 429; the platform degrades to a deterministic non-AI response instead of
 * an error page, so every core workflow keeps working with AI switched off.
 *
 * Provider: the Sarvam API key lives server-side only and is never returned, logged or
 * accepted from a client. Actual provider invocation sits behind `invokeProvider()`; the
 * module ships with a deterministic local renderer (no provider SDK / network access is
 * available to feature modules), and every response is labelled as generated + advisory.
 */

export const LEDGER = 'ai_budget_ledger';
export const CALLS = 'ai_calls';
export const PROPOSALS = 'ai_proposals';

/** ₹100 of free credits, in paise. Never increased: no top-ups, no auto-recharge. */
export const CREDIT_BUDGET_PAISE = 10000;
/** Deterministic price: 1 paise per 20 characters of prompt, minimum 1 paise. */
export const PAISE_PER_CHARS = 20;

export const ALLOWED_USE_CASES: Record<string, string> = {
  'performance.insights': 'Performance insights and summaries',
  'learning.recommendations': 'Learning recommendations',
  'analysis.explanation': 'Explanations of chess analysis',
  'opening.study': 'Opening-study explanations',
  'tournament.summary': 'Tournament summaries',
  'coaching.suggestions': 'Coaching support suggestions',
  'admin.summary': 'Administrative summaries',
  'knowledge.assistant': 'Knowledge assistant and natural-language search',
  'insights.dashboard': 'Insights dashboard narrative',
};

/** Records AI is never allowed to propose a change to (advisory only, human must act). */
export const AUTHORITATIVE_TARGETS = [
  'ratings', 'pairings', 'results', 'eligibility', 'roles', 'policies', 'finance',
];

export const PROPOSAL_STATUSES = ['pending_human_approval', 'approved_by_human', 'rejected'];

export function costOf(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.length / PAISE_PER_CHARS));
}

export async function spentPaise(ctx: FeatureContext): Promise<number> {
  const entries = await ctx.repo.find(LEDGER, { kind: 'debit' });
  return entries.reduce((sum: number, e: Row) => sum + (Number(e.paise) || 0), 0);
}

export async function budgetState(ctx: FeatureContext) {
  const spent = await spentPaise(ctx);
  const remaining = Math.max(0, CREDIT_BUDGET_PAISE - spent);
  return {
    budgetPaise: CREDIT_BUDGET_PAISE,
    budgetRupees: CREDIT_BUDGET_PAISE / 100,
    spentPaise: spent,
    remainingPaise: remaining,
    remainingRupees: remaining / 100,
    exhausted: remaining <= 0,
    aiEnabled: remaining > 0,
    paidTopUps: false,
    autoRecharge: false,
    paidFallback: false,
  };
}

/** Deterministic, non-AI response used whenever AI cannot be used. */
export function fallbackResponse(useCase: string, prompt: string, reason: string) {
  const chars = typeof prompt === 'string' ? prompt.length : 0;
  return {
    source: 'deterministic',
    degraded: true,
    reason,
    useCase,
    costPaise: 0,
    advisoryOnly: true,
    canMutateRecords: false,
    humanApprovalRequired: true,
    label: 'Not AI-generated — deterministic fallback',
    text:
      `Deterministic summary for ${useCase}: ${chars} characters of supplied context were reviewed `
      + 'without AI assistance. Core club operations are unaffected and no authoritative record was changed.',
  };
}

/**
 * Provider seam. A production deployment plugs the Sarvam client in here; the shipped
 * implementation renders a deterministic draft so the feature is fully testable offline.
 */
function invokeProvider(useCase: string, prompt: string) {
  return {
    text:
      `Advisory draft (${ALLOWED_USE_CASES[useCase] || useCase}): generated from ${prompt.length} characters `
      + 'of approved, minimised context. This is guidance only — a human must review it before acting.',
    providerInvoked: false,
  };
}

export async function assist(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  const useCase = input.useCase;
  if (!useCase || !ALLOWED_USE_CASES[useCase]) {
    throw unprocessable(
      `useCase must be one of the allowlisted use cases: ${Object.keys(ALLOWED_USE_CASES).join(', ')}`,
    );
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  if (!prompt.trim()) throw badRequest('prompt is required');
  if (input.topUpPaise != null || input.autoRecharge || input.paidFallback) {
    throw forbidden('No paid top-ups, auto-recharge or paid fallback are permitted; only ₹100 of free credits may be used');
  }
  if (input.apiKey != null) {
    throw badRequest('API keys are held server-side only and must never be supplied by a client');
  }
  const mode = input.mode || 'ai';
  if (!['ai', 'auto'].includes(mode)) throw badRequest("mode must be 'ai' or 'auto'");

  const cost = costOf(prompt);
  const budget = await budgetState(ctx);
  const remaining = budget.remainingPaise;

  if (cost > remaining) {
    const reason = remaining <= 0 ? 'budget_exhausted' : 'insufficient_budget';
    await ctx.repo.insert(CALLS, {
      id: ctx.newId(),
      actorId,
      useCase,
      promptChars: prompt.length,
      costPaise: 0,
      outcome: mode === 'auto' ? 'fallback' : 'refused',
      reason,
      at: ctx.now(),
      createdAt: ctx.now(),
    });
    await ctx.audit.record({
      action: 'ai.call.refused',
      actorId,
      targetType: 'ai_call',
      targetId: null,
      detail: { useCase, requestedPaise: cost, remainingPaise: remaining, mode },
    });
    if (mode === 'auto') {
      return { ...fallbackResponse(useCase, prompt, reason), remainingPaise: remaining };
    }
    throw quotaExceeded(
      `AI credit budget exhausted: ₹${(remaining / 100).toFixed(2)} of ₹${(CREDIT_BUDGET_PAISE / 100).toFixed(2)} remains `
      + `and this call needs ₹${(cost / 100).toFixed(2)}. AI is disabled; core workflows continue without it.`,
    );
  }

  const balanceAfter = remaining - cost;
  const callId = ctx.newId();
  const ledgerRow = await ctx.repo.insert(LEDGER, {
    id: ctx.newId(),
    callId,
    kind: 'debit',
    paise: cost,
    balanceAfterPaise: balanceAfter,
    useCase,
    actorId,
    at: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.repo.insert(CALLS, {
    id: callId,
    actorId,
    useCase,
    promptChars: prompt.length,
    costPaise: cost,
    outcome: 'completed',
    ledgerId: ledgerRow.id,
    at: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'ai.call.complete',
    actorId,
    targetType: 'ai_call',
    targetId: callId,
    detail: { useCase, costPaise: cost, balanceAfterPaise: balanceAfter },
  });

  const draft = invokeProvider(useCase, prompt);
  return {
    callId,
    useCase,
    source: 'ai',
    degraded: false,
    costPaise: cost,
    balanceAfterPaise: balanceAfter,
    remainingPaise: balanceAfter,
    provider: 'sarvam',
    providerInvoked: draft.providerInvoked,
    text: draft.text,
    label: 'AI-generated — advisory only',
    advisoryOnly: true,
    canMutateRecords: false,
    humanApprovalRequired: true,
  };
}

export async function listLedger(ctx: FeatureContext, filter: Row = {}) {
  const q: Row = {};
  if (filter.kind) q.kind = filter.kind;
  const entries = await ctx.repo.find(LEDGER, q, { orderBy: 'at' });
  const state = await budgetState(ctx);
  return { entries, totalDebitPaise: state.spentPaise, ...state };
}

/** No top-up path exists by design. */
export function requestTopUp(_ctx: FeatureContext, _actorId: string): never {
  throw forbidden('No paid top-ups or auto-recharge are permitted; the AI budget is fixed at ₹100 of free credits');
}

export async function listCalls(ctx: FeatureContext, limit = 50): Promise<Row[]> {
  return ctx.repo.find(CALLS, {}, { orderBy: 'at', desc: true, limit: Number(limit) || 50 });
}

// -------------------------------------------------------------- proposals ---

export async function createProposal(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  const target = String(input.targetTable || '').trim().toLowerCase();
  if (!target) throw badRequest('targetTable is required');
  if (AUTHORITATIVE_TARGETS.includes(target)) {
    throw unprocessable(
      `AI cannot propose changes to authoritative records (${target}). Ratings, pairings, results, `
      + 'eligibility, roles, policies and financial records are changed by authorised people only.',
    );
  }
  if (!input.summary?.trim()) throw badRequest('summary is required');
  const row = await ctx.repo.insert(PROPOSALS, {
    id: ctx.newId(),
    targetTable: target,
    summary: input.summary.trim(),
    useCase: input.useCase && ALLOWED_USE_CASES[input.useCase] ? input.useCase : 'admin.summary',
    status: 'pending_human_approval',
    advisoryOnly: true,
    applied: false,
    appliedByAi: false,
    requiresManualEntry: true,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'ai.proposal.create',
    actorId,
    targetType: 'ai_proposal',
    targetId: row.id,
    detail: { targetTable: target, applied: false },
  });
  return row;
}

export async function decideProposal(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: Row = {},
): Promise<Row> {
  const row = await ctx.repo.get(PROPOSALS, id);
  if (!row) throw notFound('Proposal not found');
  if (row.status !== 'pending_human_approval') {
    throw conflict(`Proposal is already ${row.status}`);
  }
  const decision = input.decision;
  if (!['approve', 'reject'].includes(decision)) throw badRequest("decision must be 'approve' or 'reject'");
  const updated = await ctx.repo.update(PROPOSALS, id, {
    status: decision === 'approve' ? 'approved_by_human' : 'rejected',
    decidedBy: actorId,
    decidedAt: ctx.now(),
    decisionNote: input.note ?? null,
    // Even an approved proposal is never applied by the system: a person makes the change.
    applied: false,
    requiresManualEntry: true,
  });
  await ctx.audit.record({
    action: `ai.proposal.${decision}`,
    actorId,
    targetType: 'ai_proposal',
    targetId: id,
    detail: { targetTable: row.targetTable, applied: false },
  });
  return updated as Row;
}

export async function listProposals(ctx: FeatureContext): Promise<Row[]> {
  return ctx.repo.find(PROPOSALS, {}, { orderBy: 'createdAt', desc: true });
}
