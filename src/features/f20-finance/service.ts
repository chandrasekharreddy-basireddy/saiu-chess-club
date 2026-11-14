/**
 * Feature 20 — Club Finance & Fund Management (slug: `finance`)
 *
 * Tables
 *  - finance_budgets        planned budgets, proposed -> approved
 *  - finance_expenses       expense requests with receipt references and approval state
 *  - finance_contributions  approved funding sources (membership fees, sponsorship, grants)
 *  - finance_ledger_entries double-entry postings; every transaction writes exactly two legs
 *                           (debit and credit of equal amount) so the ledger always reconciles
 *  - finance_periods        closed reporting periods with a frozen balance snapshot
 *
 * Money is always an integer number of paise. No payment processing exists here: this module only
 * records and approves. Receipts are referenced by id with `storage: 'private'`; card numbers and
 * bank credentials are rejected outright.
 *
 * Accounting model
 *  income  : debit  cash          / credit fund_balance
 *  expense : debit  expense       / credit cash
 *  => cash balance = income - expense, and total debits always equal total credits.
 */
import type { FeatureContext, Row } from '../../core/types.js';
import { assertNotSelfApproval } from '../../core/permissions.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';

export const BUDGETS = 'finance_budgets';
export const EXPENSES = 'finance_expenses';
export const CONTRIBUTIONS = 'finance_contributions';
export const LEDGER = 'finance_ledger_entries';
export const PERIODS = 'finance_periods';

export const EXPENSE_CATEGORIES = [
  'tournament', 'travel', 'equipment', 'coaching', 'venue', 'refreshments', 'printing', 'miscellaneous',
];

const FORBIDDEN_FIELDS = ['cardNumber', 'card_number', 'cvv', 'bankAccount', 'accountNumber', 'iban', 'upiPin'];

function sod(actorId: string, ownerId: string, what: string) {
  try {
    assertNotSelfApproval(actorId, ownerId, what);
  } catch (e: any) {
    throw forbidden(e?.message || `Separation of duties: you cannot approve ${what} you raised`);
  }
}

function rejectSensitive(body: any) {
  for (const f of FORBIDDEN_FIELDS) {
    if (body && body[f] != null) throw badRequest('Payment card details and bank credentials must never be stored');
  }
}

/** Money is integer paise, always positive. */
export function paise(v: any, field: string): number {
  if (v == null || v === '') throw badRequest(`${field} is required`);
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) throw badRequest(`${field} must be an integer number of paise`);
  if (n <= 0) throw badRequest(`${field} must be greater than zero`);
  return n;
}

function isoOrNull(v: any, field: string): string | null {
  if (v == null || v === '') return null;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) throw badRequest(`${field} must be an ISO date/time`);
  return new Date(t).toISOString();
}

/* ------------------------------------------------------------------ double-entry ledger */

async function postTransaction(
  ctx: FeatureContext,
  input: { kind: 'income' | 'expense'; amountPaise: number; description: string; refType: string; refId: string; actorId: string },
) {
  const groupId = ctx.newId();
  const legs =
    input.kind === 'income'
      ? [
          { account: 'cash', debitPaise: input.amountPaise, creditPaise: 0 },
          { account: 'fund_balance', debitPaise: 0, creditPaise: input.amountPaise },
        ]
      : [
          { account: 'expense', debitPaise: input.amountPaise, creditPaise: 0 },
          { account: 'cash', debitPaise: 0, creditPaise: input.amountPaise },
        ];
  const rows: Row[] = [];
  for (const leg of legs) {
    rows.push(
      await ctx.repo.insert(LEDGER, {
        id: ctx.newId(),
        groupId,
        kind: input.kind,
        account: leg.account,
        debitPaise: leg.debitPaise,
        creditPaise: leg.creditPaise,
        amountPaise: input.amountPaise,
        description: input.description,
        refType: input.refType,
        refId: input.refId,
        postedBy: input.actorId,
        postedAt: ctx.now(),
        createdAt: ctx.now(),
      }),
    );
  }
  await ctx.audit.record({
    action: 'finance.ledger.post',
    actorId: input.actorId,
    targetType: 'ledger_group',
    targetId: groupId,
    detail: { kind: input.kind, amountPaise: input.amountPaise, refType: input.refType, refId: input.refId },
  });
  return { groupId, legs: rows };
}

/** income - expense, plus the double-entry reconciliation proof. */
export async function ledgerSummary(ctx: FeatureContext) {
  const rows = await ctx.repo.find(LEDGER, {});
  const sum = (pick: (r: Row) => number) => rows.reduce((a, r) => a + (pick(r) || 0), 0);
  const debitsPaise = sum((r) => r.debitPaise);
  const creditsPaise = sum((r) => r.creditPaise);
  const incomePaise = sum((r) => (r.account === 'fund_balance' ? r.creditPaise : 0));
  const expensePaise = sum((r) => (r.account === 'expense' ? r.debitPaise : 0));
  const cashDebits = sum((r) => (r.account === 'cash' ? r.debitPaise : 0));
  const cashCredits = sum((r) => (r.account === 'cash' ? r.creditPaise : 0));
  return {
    currency: 'INR',
    unit: 'paise',
    incomePaise,
    expensePaise,
    balancePaise: incomePaise - expensePaise,
    cashBalancePaise: cashDebits - cashCredits,
    debitsPaise,
    creditsPaise,
    balanced: debitsPaise === creditsPaise,
    entryCount: rows.length,
  };
}

export async function listLedger(ctx: FeatureContext, filter: { kind?: string; account?: string } = {}) {
  const all = await ctx.repo.find(LEDGER, {}, { orderBy: 'createdAt' });
  return all.filter((r) => (filter.kind ? r.kind === filter.kind : true)).filter((r) => (filter.account ? r.account === filter.account : true));
}

/* ------------------------------------------------------------------ budgets */

export async function createBudget(
  ctx: FeatureContext,
  actorId: string,
  input: { name?: string; plannedPaise?: number; academicYearId?: string; category?: string; notes?: string },
) {
  rejectSensitive(input);
  const name = (input?.name || '').trim();
  if (!name) throw badRequest('Budget name is required');
  const plannedPaise = paise(input?.plannedPaise, 'plannedPaise');
  const row = await ctx.repo.insert(BUDGETS, {
    id: ctx.newId(),
    name,
    plannedPaise,
    spentPaise: 0,
    academicYearId: input?.academicYearId ?? null,
    category: input?.category ?? null,
    notes: input?.notes ?? null,
    status: 'proposed',
    createdBy: actorId,
    approvedBy: null,
    approvedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'finance.budget.create', actorId, targetType: 'budget', targetId: row.id, detail: { plannedPaise } });
  return row;
}

export async function approveBudget(ctx: FeatureContext, actorId: string, id: string) {
  const b = await ctx.repo.get(BUDGETS, id);
  if (!b) throw notFound('Budget not found');
  if (b.status !== 'proposed') throw conflict(`Only a proposed budget can be approved (current: ${b.status})`);
  sod(actorId, b.createdBy, 'a budget');
  const row = await ctx.repo.update(BUDGETS, id, { status: 'approved', approvedBy: actorId, approvedAt: ctx.now() });
  await ctx.audit.record({ action: 'finance.budget.approve', actorId, targetType: 'budget', targetId: id, detail: { plannedPaise: b.plannedPaise } });
  return row;
}

export async function listBudgets(ctx: FeatureContext, filter: { status?: string } = {}) {
  const where: Row = filter.status ? { status: filter.status } : {};
  return ctx.repo.find(BUDGETS, where, { orderBy: 'createdAt', desc: true });
}

/* ------------------------------------------------------------------ contributions (income) */

export async function recordContribution(
  ctx: FeatureContext,
  actorId: string,
  input: { source?: string; amountPaise?: number; kind?: string; reference?: string; receivedAt?: string },
) {
  rejectSensitive(input);
  const source = (input?.source || '').trim();
  if (!source) throw badRequest('Contribution source is required');
  const amountPaise = paise(input?.amountPaise, 'amountPaise');
  const row = await ctx.repo.insert(CONTRIBUTIONS, {
    id: ctx.newId(),
    source,
    kind: input?.kind || 'sponsorship',
    amountPaise,
    reference: input?.reference ?? null,
    receivedAt: isoOrNull(input?.receivedAt, 'receivedAt') || ctx.now(),
    status: 'pending',
    recordedBy: actorId,
    approvedBy: null,
    approvedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'finance.contribution.record', actorId, targetType: 'contribution', targetId: row.id, detail: { amountPaise } });
  return row;
}

export async function approveContribution(ctx: FeatureContext, actorId: string, id: string) {
  const c = await ctx.repo.get(CONTRIBUTIONS, id);
  if (!c) throw notFound('Contribution not found');
  if (c.status !== 'pending') throw conflict(`Only a pending contribution can be approved (current: ${c.status})`);
  sod(actorId, c.recordedBy, 'a contribution');
  const posted = await postTransaction(ctx, {
    kind: 'income',
    amountPaise: c.amountPaise,
    description: `Contribution from ${c.source}`,
    refType: 'contribution',
    refId: c.id,
    actorId,
  });
  const row = await ctx.repo.update(CONTRIBUTIONS, id, {
    status: 'approved',
    approvedBy: actorId,
    approvedAt: ctx.now(),
    ledgerGroupId: posted.groupId,
  });
  await ctx.audit.record({ action: 'finance.contribution.approve', actorId, targetType: 'contribution', targetId: id, detail: { amountPaise: c.amountPaise } });
  return row;
}

export async function listContributions(ctx: FeatureContext, filter: { status?: string } = {}) {
  const where: Row = filter.status ? { status: filter.status } : {};
  return ctx.repo.find(CONTRIBUTIONS, where, { orderBy: 'createdAt', desc: true });
}

/* ------------------------------------------------------------------ expenses */

export async function requestExpense(
  ctx: FeatureContext,
  actorId: string,
  input: { description?: string; amountPaise?: number; category?: string; budgetId?: string; receiptFileId?: string; payee?: string },
) {
  rejectSensitive(input);
  const description = (input?.description || '').trim();
  if (!description) throw badRequest('Expense description is required');
  const amountPaise = paise(input?.amountPaise, 'amountPaise');
  const category = input?.category || 'miscellaneous';
  if (!EXPENSE_CATEGORIES.includes(category)) throw badRequest(`category must be one of ${EXPENSE_CATEGORIES.join(', ')}`);

  let budget = null;
  if (input?.budgetId) {
    budget = await ctx.repo.get(BUDGETS, input.budgetId);
    if (!budget) throw notFound('Budget not found');
    if (budget.status !== 'approved') throw conflict('Expenses can only be charged to an approved budget');
    const remaining = (budget.plannedPaise || 0) - (budget.spentPaise || 0);
    if (amountPaise > remaining) throw unprocessable(`Expense exceeds the remaining budget of ${remaining} paise`);
  }

  const row = await ctx.repo.insert(EXPENSES, {
    id: ctx.newId(),
    description,
    amountPaise,
    category,
    payee: input?.payee ?? null,
    budgetId: input?.budgetId ?? null,
    receiptFileId: input?.receiptFileId ?? null,
    receiptStorage: input?.receiptFileId ? 'private' : null,
    status: 'requested',
    requestedBy: actorId,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    ledgerGroupId: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'finance.expense.request', actorId, targetType: 'expense', targetId: row.id, detail: { amountPaise, category } });
  return row;
}

export async function attachReceipt(ctx: FeatureContext, actorId: string, id: string, input: { receiptFileId?: string; note?: string }) {
  rejectSensitive(input);
  const e = await ctx.repo.get(EXPENSES, id);
  if (!e) throw notFound('Expense not found');
  if (e.status !== 'requested') throw conflict(`A receipt can only be attached to a requested expense (current: ${e.status})`);
  if (!input?.receiptFileId) throw badRequest('receiptFileId is required');
  const row = await ctx.repo.update(EXPENSES, id, {
    receiptFileId: input.receiptFileId,
    receiptStorage: 'private', // receipts are never public assets
    receiptNote: input?.note ?? null,
    receiptAttachedBy: actorId,
    receiptAttachedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'finance.expense.receipt', actorId, targetType: 'expense', targetId: id, detail: { receiptFileId: input.receiptFileId, storage: 'private' } });
  return row;
}

/** Approves an expense: second person, receipt on file, and the fund may never go negative. */
export async function approveExpense(ctx: FeatureContext, actorId: string, id: string) {
  const e = await ctx.repo.get(EXPENSES, id);
  if (!e) throw notFound('Expense not found');
  if (e.status !== 'requested') throw conflict(`Only a requested expense can be approved (current: ${e.status})`);
  sod(actorId, e.requestedBy, 'an expense');
  if (!e.receiptFileId) throw unprocessable('A receipt or supporting document must be attached before approval');

  const before = await ledgerSummary(ctx);
  if (before.balancePaise - e.amountPaise < 0) {
    throw unprocessable(
      `Approval would make the club balance negative (available ${before.balancePaise} paise, requested ${e.amountPaise} paise)`,
    );
  }

  if (e.budgetId) {
    const b = await ctx.repo.get(BUDGETS, e.budgetId);
    if (b) {
      const remaining = (b.plannedPaise || 0) - (b.spentPaise || 0);
      if (e.amountPaise > remaining) throw unprocessable(`Expense exceeds the remaining budget of ${remaining} paise`);
      await ctx.repo.update(BUDGETS, e.budgetId, { spentPaise: (b.spentPaise || 0) + e.amountPaise });
    }
  }

  const posted = await postTransaction(ctx, {
    kind: 'expense',
    amountPaise: e.amountPaise,
    description: e.description,
    refType: 'expense',
    refId: e.id,
    actorId,
  });
  const row = await ctx.repo.update(EXPENSES, id, {
    status: 'approved',
    approvedBy: actorId,
    approvedAt: ctx.now(),
    ledgerGroupId: posted.groupId,
  });
  const after = await ledgerSummary(ctx);
  await ctx.audit.record({
    action: 'finance.expense.approve',
    actorId,
    targetType: 'expense',
    targetId: id,
    detail: { amountPaise: e.amountPaise, balanceAfterPaise: after.balancePaise },
  });
  return { ...row, balanceAfterPaise: after.balancePaise };
}

export async function rejectExpense(ctx: FeatureContext, actorId: string, id: string, reason?: string) {
  const e = await ctx.repo.get(EXPENSES, id);
  if (!e) throw notFound('Expense not found');
  if (e.status !== 'requested') throw conflict(`Only a requested expense can be rejected (current: ${e.status})`);
  sod(actorId, e.requestedBy, 'an expense');
  const row = await ctx.repo.update(EXPENSES, id, { status: 'rejected', rejectedBy: actorId, rejectedAt: ctx.now(), rejectionReason: reason ?? null });
  await ctx.audit.record({ action: 'finance.expense.reject', actorId, targetType: 'expense', targetId: id, detail: { reason: reason ?? null } });
  return row;
}

export async function listExpenses(ctx: FeatureContext, filter: { status?: string; category?: string } = {}) {
  const all = await ctx.repo.find(EXPENSES, {}, { orderBy: 'createdAt', desc: true });
  return all
    .filter((e) => (filter.status ? e.status === filter.status : true))
    .filter((e) => (filter.category ? e.category === filter.category : true));
}

export async function getExpense(ctx: FeatureContext, id: string) {
  const e = await ctx.repo.get(EXPENSES, id);
  if (!e) throw notFound('Expense not found');
  const legs = await ctx.repo.find(LEDGER, { refType: 'expense', refId: id });
  return { ...e, ledgerLegs: legs };
}

/* ------------------------------------------------------------------ reporting / period close */

export async function financialReport(ctx: FeatureContext, actorId: string, filter: { from?: string; to?: string } = {}) {
  const summary = await ledgerSummary(ctx);
  const expenses = await ctx.repo.find(EXPENSES, { status: 'approved' });
  const contributions = await ctx.repo.find(CONTRIBUTIONS, { status: 'approved' });
  const fromMs = filter.from ? new Date(filter.from).getTime() : null;
  const toMs = filter.to ? new Date(filter.to).getTime() : null;
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime();
    return (fromMs == null || t >= fromMs) && (toMs == null || t <= toMs);
  };
  const scoped = expenses.filter((e) => inWindow(e.approvedAt || e.createdAt));
  const byCategory: Record<string, number> = {};
  for (const e of scoped) byCategory[e.category] = (byCategory[e.category] || 0) + e.amountPaise;

  const report = {
    generatedAt: ctx.now(),
    from: filter.from ?? null,
    to: filter.to ?? null,
    currency: 'INR',
    unit: 'paise',
    summary,
    expenseCount: scoped.length,
    expenseTotalPaise: scoped.reduce((a, e) => a + e.amountPaise, 0),
    byCategory,
    contributionTotalPaise: contributions.reduce((a, c) => a + c.amountPaise, 0),
    expenseIds: scoped.map((e) => e.id),
  };
  await ctx.audit.record({ action: 'finance.report.export', actorId, targetType: 'finance_report', targetId: null, detail: { from: filter.from ?? null, to: filter.to ?? null } });
  return report;
}

export async function closePeriod(ctx: FeatureContext, actorId: string, input: { label?: string; endsAt?: string } = {}) {
  const label = (input?.label || '').trim();
  if (!label) throw badRequest('A period label is required');
  const summary = await ledgerSummary(ctx);
  if (!summary.balanced) throw conflict('Ledger does not reconcile; the period cannot be closed');
  const row = await ctx.repo.insert(PERIODS, {
    id: ctx.newId(),
    label,
    endsAt: isoOrNull(input?.endsAt, 'endsAt') || ctx.now(),
    incomePaise: summary.incomePaise,
    expensePaise: summary.expensePaise,
    balancePaise: summary.balancePaise,
    entryCount: summary.entryCount,
    status: 'closed',
    closedBy: actorId,
    closedAt: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'finance.period.close', actorId, targetType: 'finance_period', targetId: row.id, detail: { balancePaise: summary.balancePaise } });
  return row;
}

export async function listPeriods(ctx: FeatureContext) {
  return ctx.repo.find(PERIODS, {}, { orderBy: 'createdAt', desc: true });
}
