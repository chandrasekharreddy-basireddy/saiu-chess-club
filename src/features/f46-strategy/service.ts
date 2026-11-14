import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound, forbidden } from '../../core/errors.js';

/**
 * Tables (created implicitly on first insert)
 *
 * strategy_objectives   club goals: title, definition, ownerId, reviewDate, status, version
 * strategy_key_results  measurable indicators per objective (title, target, current, unit)
 * strategy_milestones   dated checkpoints per objective (title, dueDate, ownerId, status)
 * strategy_risks        risk / dependency register per objective (likelihood x impact)
 * strategy_reviews      review meetings and the decisions recorded against them
 *
 * Progress rule: each key result contributes min(100, round(current / target * 100));
 * an objective's progress is the rounded mean of its key results, clamped to 0..100.
 * An objective with no key results reports 0 (never NaN).
 */

export const OBJ = 'strategy_objectives';
export const KR = 'strategy_key_results';
export const MILESTONE = 'strategy_milestones';
export const RISK = 'strategy_risks';
export const REVIEW = 'strategy_reviews';

export const OBJECTIVE_STATUSES = ['draft', 'active', 'achieved', 'archived'];
export const MILESTONE_STATUSES = ['pending', 'done', 'missed'];

function num(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Clamp any computed percentage into the integer range 0..100. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Deterministic progress for a single key result. */
export function keyResultPercent(kr: Row): number {
  const target = num(kr?.target);
  if (target <= 0) return 0;
  return clampPercent((num(kr?.current) / target) * 100);
}

/** Deterministic progress for an objective: mean of its key-result percentages. */
export function objectiveProgress(keyResults: Row[]): number {
  if (!Array.isArray(keyResults) || keyResults.length === 0) return 0;
  const total = keyResults.reduce((sum, kr) => sum + keyResultPercent(kr), 0);
  return clampPercent(total / keyResults.length);
}

/** likelihood and impact are 1..5; score = likelihood * impact. */
export function riskSeverity(likelihood: number, impact: number): string {
  const score = num(likelihood) * num(impact);
  if (score >= 16) return 'critical';
  if (score >= 9) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function parseDate(value: any, field: string): string {
  const raw = text(value);
  if (!raw) throw badRequest(`${field} is required`);
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw badRequest(`${field} must be an ISO date`);
  return new Date(ms).toISOString();
}

export async function createObjective(ctx: FeatureContext, actorId: string, input: any) {
  if (!input || typeof input !== 'object') throw badRequest('Objective payload is required');
  const title = text(input.title);
  if (!title) throw badRequest('Objective title is required');
  const definition = text(input.definition) || text(input.description);
  if (!definition) throw badRequest('Objective definition is required');
  if (!text(input.ownerId)) throw badRequest('Objective owner is required');
  const reviewDate = parseDate(input.reviewDate, 'reviewDate');
  const status = input.status == null ? 'draft' : String(input.status);
  if (!OBJECTIVE_STATUSES.includes(status)) throw badRequest(`Unknown objective status: ${status}`);

  const row = await ctx.repo.insert(OBJ, {
    id: ctx.newId(),
    title,
    definition,
    ownerId: String(input.ownerId),
    reviewDate,
    status,
    version: 1,
    publicSummary: null,
    publicSummaryStatus: 'none',
    publicSummaryAuthor: null,
    publicSummaryApprovedBy: null,
    archivedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'strategy.objective.create',
    actorId,
    targetType: 'strategy_objective',
    targetId: row.id,
    detail: { title, ownerId: row.ownerId },
  });
  return { ...row, keyResults: [], progressPercent: 0 };
}

export async function listObjectives(ctx: FeatureContext, filter: any = {}) {
  const status = text(filter.status);
  const objectives = await ctx.repo.find(OBJ, status ? { status } : {}, { orderBy: 'createdAt', desc: true });
  const keyResults = await ctx.repo.find(KR, {}, { orderBy: 'createdAt' });
  return objectives.map((objective) => {
    const own = keyResults.filter((kr) => kr.objectiveId === objective.id);
    return { ...objective, keyResultCount: own.length, progressPercent: objectiveProgress(own) };
  });
}

export async function getObjective(ctx: FeatureContext, id: string) {
  const objective = await ctx.repo.get(OBJ, id);
  if (!objective) throw notFound('Strategy objective not found');
  const keyResults = await ctx.repo.find(KR, { objectiveId: id }, { orderBy: 'createdAt' });
  const milestones = await ctx.repo.find(MILESTONE, { objectiveId: id }, { orderBy: 'dueDate' });
  const risks = await ctx.repo.find(RISK, { objectiveId: id }, { orderBy: 'createdAt' });
  const reviews = await ctx.repo.find(REVIEW, { objectiveId: id }, { orderBy: 'scheduledFor' });
  return {
    ...objective,
    keyResults: keyResults.map((kr) => ({ ...kr, percent: keyResultPercent(kr) })),
    milestones,
    risks,
    reviews,
    progressPercent: objectiveProgress(keyResults),
  };
}

async function requireObjective(ctx: FeatureContext, id: string) {
  const objective = await ctx.repo.get(OBJ, id);
  if (!objective) throw notFound('Strategy objective not found');
  if (objective.status === 'archived') throw conflict('Archived objectives are read-only');
  return objective;
}

export async function addKeyResult(ctx: FeatureContext, actorId: string, objectiveId: string, input: any) {
  await requireObjective(ctx, objectiveId);
  const title = text(input?.title);
  if (!title) throw badRequest('Key result title is required');
  const target = num(input?.target);
  if (!(target > 0)) throw badRequest('Key result target must be greater than zero');
  const current = input?.current == null ? 0 : num(input.current);
  if (current < 0) throw badRequest('Key result current value cannot be negative');

  const row = await ctx.repo.insert(KR, {
    id: ctx.newId(),
    objectiveId,
    title,
    target,
    current,
    unit: text(input?.unit) || 'count',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  const all = await ctx.repo.find(KR, { objectiveId }, { orderBy: 'createdAt' });
  await ctx.audit.record({
    action: 'strategy.key_result.create',
    actorId,
    targetType: 'strategy_key_result',
    targetId: row.id,
    detail: { objectiveId, target },
  });
  return { ...row, percent: keyResultPercent(row), objectiveProgressPercent: objectiveProgress(all) };
}

export async function updateKeyResult(ctx: FeatureContext, actorId: string, keyResultId: string, input: any) {
  const kr = await ctx.repo.get(KR, keyResultId);
  if (!kr) throw notFound('Key result not found');
  await requireObjective(ctx, kr.objectiveId);
  const patch: Row = {};
  if (input?.current != null) {
    const current = num(input.current);
    if (current < 0) throw badRequest('Key result current value cannot be negative');
    patch.current = current;
  }
  if (input?.target != null) {
    const target = num(input.target);
    if (!(target > 0)) throw badRequest('Key result target must be greater than zero');
    patch.target = target;
  }
  if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');
  const updated = await ctx.repo.update(KR, keyResultId, patch);
  const all = await ctx.repo.find(KR, { objectiveId: kr.objectiveId }, { orderBy: 'createdAt' });
  await ctx.audit.record({
    action: 'strategy.key_result.update',
    actorId,
    targetType: 'strategy_key_result',
    targetId: keyResultId,
    detail: patch,
  });
  return { ...updated, percent: keyResultPercent(updated), objectiveProgressPercent: objectiveProgress(all) };
}

export async function addMilestone(ctx: FeatureContext, actorId: string, objectiveId: string, input: any) {
  await requireObjective(ctx, objectiveId);
  const title = text(input?.title);
  if (!title) throw badRequest('Milestone title is required');
  const dueDate = parseDate(input?.dueDate, 'dueDate');
  const ownerId = text(input?.ownerId) || null;
  const row = await ctx.repo.insert(MILESTONE, {
    id: ctx.newId(),
    objectiveId,
    title,
    dueDate,
    ownerId,
    status: 'pending',
    completedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'strategy.milestone.create',
    actorId,
    targetType: 'strategy_milestone',
    targetId: row.id,
    detail: { objectiveId, dueDate },
  });
  return row;
}

export async function addRisk(ctx: FeatureContext, actorId: string, objectiveId: string, input: any) {
  await requireObjective(ctx, objectiveId);
  const description = text(input?.description) || text(input?.title);
  if (!description) throw badRequest('Risk description is required');
  const likelihood = num(input?.likelihood ?? 3);
  const impact = num(input?.impact ?? 3);
  if (likelihood < 1 || likelihood > 5) throw badRequest('likelihood must be between 1 and 5');
  if (impact < 1 || impact > 5) throw badRequest('impact must be between 1 and 5');
  const row = await ctx.repo.insert(RISK, {
    id: ctx.newId(),
    objectiveId,
    description,
    likelihood,
    impact,
    severity: riskSeverity(likelihood, impact),
    mitigation: text(input?.mitigation) || null,
    ownerId: text(input?.ownerId) || null,
    status: 'open',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'strategy.risk.create',
    actorId,
    targetType: 'strategy_risk',
    targetId: row.id,
    detail: { objectiveId, severity: row.severity },
  });
  return row;
}

export async function addReview(ctx: FeatureContext, actorId: string, objectiveId: string, input: any) {
  await requireObjective(ctx, objectiveId);
  const scheduledFor = parseDate(input?.scheduledFor, 'scheduledFor');
  const decisions = Array.isArray(input?.decisions) ? input.decisions.map((d: any) => String(d)) : [];
  if (decisions.length === 0) throw badRequest('A review must record at least one decision');
  const row = await ctx.repo.insert(REVIEW, {
    id: ctx.newId(),
    objectiveId,
    scheduledFor,
    heldAt: input?.heldAt ? parseDate(input.heldAt, 'heldAt') : null,
    decisions,
    attendees: Array.isArray(input?.attendees) ? input.attendees.map((a: any) => String(a)) : [],
    notes: text(input?.notes) || null,
    recordedBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'strategy.review.record',
    actorId,
    targetType: 'strategy_review',
    targetId: row.id,
    detail: { objectiveId, decisions: decisions.length },
  });
  return row;
}

/** A public summary is proposed, then approved by somebody other than its author. */
export async function submitPublicSummary(ctx: FeatureContext, actorId: string, objectiveId: string, input: any) {
  const objective = await requireObjective(ctx, objectiveId);
  const summary = text(input?.summary);
  if (!summary) throw badRequest('Public summary text is required');
  if (objective.publicSummaryStatus === 'approved') throw conflict('The public summary is already approved');
  const updated = await ctx.repo.update(OBJ, objectiveId, {
    publicSummary: summary,
    publicSummaryStatus: 'pending_approval',
    publicSummaryAuthor: actorId,
    publicSummaryApprovedBy: null,
  });
  await ctx.audit.record({
    action: 'strategy.summary.submit',
    actorId,
    targetType: 'strategy_objective',
    targetId: objectiveId,
  });
  return updated;
}

export async function approvePublicSummary(ctx: FeatureContext, actorId: string, objectiveId: string) {
  const objective = await ctx.repo.get(OBJ, objectiveId);
  if (!objective) throw notFound('Strategy objective not found');
  if (objective.publicSummaryStatus !== 'pending_approval') throw conflict('There is no public summary awaiting approval');
  if (objective.publicSummaryAuthor && objective.publicSummaryAuthor === actorId) {
    throw forbidden('Separation of duties: the author cannot approve their own public summary');
  }
  const updated = await ctx.repo.update(OBJ, objectiveId, {
    publicSummaryStatus: 'approved',
    publicSummaryApprovedBy: actorId,
    publicSummaryApprovedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'strategy.summary.approve',
    actorId,
    targetType: 'strategy_objective',
    targetId: objectiveId,
  });
  return updated;
}

/** Historical plans stay queryable: archiving bumps the version instead of deleting. */
export async function archiveObjective(ctx: FeatureContext, actorId: string, objectiveId: string) {
  const objective = await ctx.repo.get(OBJ, objectiveId);
  if (!objective) throw notFound('Strategy objective not found');
  if (objective.status === 'archived') throw conflict('Objective is already archived');
  const updated = await ctx.repo.update(OBJ, objectiveId, {
    status: 'archived',
    archivedAt: ctx.now(),
    version: num(objective.version) + 1,
  });
  await ctx.audit.record({
    action: 'strategy.objective.archive',
    actorId,
    targetType: 'strategy_objective',
    targetId: objectiveId,
    detail: { version: updated?.version },
  });
  return updated;
}
