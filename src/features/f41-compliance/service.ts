import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 41 — Legal Compliance, Privacy Governance & Data Protection
 * Tables owned by this feature:
 *   compliance_policies          policy register with owner, version, effective date
 *   compliance_consents          consent / lawful-basis records per data subject + purpose
 *   compliance_data_requests     access / correction / erasure / export requests + lifecycle
 *   compliance_retention_rules   retention schedule per data category
 *   compliance_privacy_incidents privacy incident register and escalation
 *
 * The platform never asserts legal compliance: policies are drafts until a person with
 * authority records a review, and the register explicitly carries `complianceClaimed: false`.
 */

export const POLICIES = 'compliance_policies';
export const CONSENTS = 'compliance_consents';
export const REQUESTS = 'compliance_data_requests';
export const RETENTION = 'compliance_retention_rules';
export const PRIVACY_INCIDENTS = 'compliance_privacy_incidents';

export const REQUEST_TYPES = ['access', 'correction', 'erasure', 'export'];
export const REQUEST_STATES = [
  'received', 'identity_verified', 'scoped', 'reviewed', 'approved', 'denied', 'completed',
] as const;

/** Forward-only lifecycle. `denied` and `completed` are terminal. */
const NEXT_STATE: Record<string, string[]> = {
  received: ['identity_verified', 'denied'],
  identity_verified: ['scoped', 'denied'],
  scoped: ['reviewed', 'denied'],
  reviewed: ['approved', 'denied'],
  approved: ['completed'],
  denied: [],
  completed: [],
};

export const BASIS_KEYS = ['consent', 'contract', 'legal_obligation', 'legitimate_interest'];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

/** Statutory-style response window used for the tracked due date (30 days). */
export const REQUEST_DUE_DAYS = 30;

function dayMs(n: number): number {
  return n * 24 * 60 * 60 * 1000;
}

/** Separation of duties, surfaced as a 403 AppError regardless of helper internals. */
function requireIndependent(actorId: string, ownerId: string, what: string) {
  try {
    assertNotSelfApproval(actorId, ownerId, what);
  } catch (e: any) {
    throw forbidden(e?.message || `Separation of duties: you cannot decide ${what} you raised`);
  }
}

function isOverdue(row: Row, nowIso: string): boolean {
  if (!row?.dueAt) return false;
  if (row.status === 'completed' || row.status === 'denied') return false;
  return new Date(nowIso).getTime() > new Date(row.dueAt).getTime();
}

// ---------------------------------------------------------------- policies ---

export async function createPolicy(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.title?.trim()) throw badRequest('Policy title is required');
  if (input.claimsLegalCompliance) {
    throw badRequest(
      'The platform must not claim legal compliance merely because controls exist; record a review instead',
    );
  }
  const ownerId = input.ownerId || actorId;
  const key = (input.key || input.title).trim().toLowerCase().replace(/\s+/g, '-');
  const prior = await ctx.repo.find(POLICIES, { key });
  const version = prior.reduce((max: number, p: Row) => Math.max(max, Number(p.version) || 0), 0) + 1;
  const row = await ctx.repo.insert(POLICIES, {
    id: ctx.newId(),
    key,
    title: input.title.trim(),
    version,
    ownerId,
    effectiveDate: input.effectiveDate || ctx.now(),
    reviewDueAt: input.reviewDueAt
      || new Date(new Date(ctx.now()).getTime() + dayMs(365)).toISOString(),
    status: 'draft',
    reviewedBy: null,
    publishedAt: null,
    complianceClaimed: false,
    notes: input.notes ?? null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'compliance.policy.create',
    actorId,
    targetType: 'policy',
    targetId: row.id,
    detail: { key, version },
  });
  return row;
}

export async function publishPolicy(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: Row = {},
): Promise<Row> {
  const policy = await ctx.repo.get(POLICIES, id);
  if (!policy) throw notFound('Policy not found');
  if (policy.status !== 'draft') throw conflict(`Only a draft policy can be published (current: ${policy.status})`);
  requireIndependent(actorId, policy.ownerId, 'a policy');
  if (!input.reviewNote?.trim()) throw badRequest('A review note from the authorised reviewer is required');

  const priorPublished = await ctx.repo.find(POLICIES, { key: policy.key, status: 'published' });
  for (const p of priorPublished) {
    await ctx.repo.update(POLICIES, p.id, { status: 'superseded' });
  }
  const updated = await ctx.repo.update(POLICIES, id, {
    status: 'published',
    reviewedBy: actorId,
    reviewNote: input.reviewNote.trim(),
    publishedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'compliance.policy.publish',
    actorId,
    targetType: 'policy',
    targetId: id,
    detail: { version: policy.version, superseded: priorPublished.length },
  });
  return updated as Row;
}

export async function listPolicies(ctx: FeatureContext, filter: Row = {}): Promise<Row[]> {
  const q: Row = {};
  if (filter.status) q.status = filter.status;
  if (filter.key) q.key = filter.key;
  return ctx.repo.find(POLICIES, q, { orderBy: 'createdAt', desc: true });
}

// ---------------------------------------------------------------- consents ---

export async function recordConsent(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.purpose?.trim()) throw badRequest('Consent purpose is required');
  const basis = input.basis || 'consent';
  if (!BASIS_KEYS.includes(basis)) throw badRequest(`basis must be one of ${BASIS_KEYS.join(', ')}`);
  const subjectId = input.subjectId || actorId;
  const existing = await ctx.repo.findOne(CONSENTS, { subjectId, purpose: input.purpose.trim() });
  if (existing && existing.status === 'granted') {
    throw conflict('Consent for this purpose is already recorded');
  }
  const row = existing
    ? await ctx.repo.update(CONSENTS, existing.id, {
        basis,
        status: 'granted',
        granted: true,
        policyVersion: input.policyVersion ?? null,
        grantedAt: ctx.now(),
        withdrawnAt: null,
        recordedBy: actorId,
      })
    : await ctx.repo.insert(CONSENTS, {
        id: ctx.newId(),
        subjectId,
        purpose: input.purpose.trim(),
        basis,
        status: 'granted',
        granted: true,
        policyVersion: input.policyVersion ?? null,
        grantedAt: ctx.now(),
        withdrawnAt: null,
        recordedBy: actorId,
        createdAt: ctx.now(),
      });
  await ctx.audit.record({
    action: 'compliance.consent.record',
    actorId,
    targetType: 'consent',
    targetId: (row as Row).id,
    detail: { subjectId, purpose: input.purpose.trim(), basis },
  });
  return row as Row;
}

export async function withdrawConsent(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  allowAny: boolean,
): Promise<Row> {
  const row = await ctx.repo.get(CONSENTS, id);
  if (!row) throw notFound('Consent record not found');
  if (!allowAny && row.subjectId !== actorId) {
    throw forbidden('You may only withdraw your own consent');
  }
  if (row.basis !== 'consent') {
    throw conflict(
      `Withdrawal is not available for processing on the basis of ${row.basis}; consent is distinct from mandatory transactional processing`,
    );
  }
  if (row.status === 'withdrawn') throw conflict('Consent has already been withdrawn');
  const updated = await ctx.repo.update(CONSENTS, id, {
    status: 'withdrawn',
    granted: false,
    withdrawnAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'compliance.consent.withdraw',
    actorId,
    targetType: 'consent',
    targetId: id,
  });
  return updated as Row;
}

export async function listConsents(ctx: FeatureContext, subjectId: string): Promise<Row[]> {
  return ctx.repo.find(CONSENTS, { subjectId }, { orderBy: 'createdAt', desc: true });
}

// ----------------------------------------------------------- data requests ---

export async function createDataRequest(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
  canActOnBehalf = false,
): Promise<Row> {
  const type = input.type;
  if (!REQUEST_TYPES.includes(type)) {
    throw badRequest(`type must be one of ${REQUEST_TYPES.join(', ')}`);
  }
  const subjectId = input.subjectId || actorId;
  if (subjectId !== actorId && !canActOnBehalf) {
    throw forbidden('Only a privacy officer may raise a request on behalf of another person');
  }
  const now = new Date(ctx.now()).getTime();
  const row = await ctx.repo.insert(REQUESTS, {
    id: ctx.newId(),
    subjectId,
    type,
    status: 'received',
    raisedBy: actorId,
    details: input.details ?? null,
    dueAt: new Date(now + dayMs(REQUEST_DUE_DAYS)).toISOString(),
    receivedAt: ctx.now(),
    completedAt: null,
    decision: null,
    decisionReason: null,
    legalHold: false,
    history: [{ status: 'received', at: ctx.now(), by: actorId, note: null }],
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'compliance.data_request.create',
    actorId,
    targetType: 'data_request',
    targetId: row.id,
    detail: { type, subjectId },
  });
  return row;
}

export async function getDataRequest(ctx: FeatureContext, actorId: string, id: string, allowAny: boolean) {
  const row = await ctx.repo.get(REQUESTS, id);
  if (!row) throw notFound('Data request not found');
  if (!allowAny && row.subjectId !== actorId) throw forbidden('You may only view your own data requests');
  return { ...row, overdue: isOverdue(row, ctx.now()) };
}

export async function transitionDataRequest(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  next: string,
  input: Row = {},
): Promise<Row> {
  const row = await ctx.repo.get(REQUESTS, id);
  if (!row) throw notFound('Data request not found');
  const allowed = NEXT_STATE[row.status] || [];
  if (!allowed.includes(next)) {
    throw conflict(`Cannot move a data request from ${row.status} to ${next}`, { allowed });
  }
  if (next === 'approved' || next === 'denied') {
    requireIndependent(actorId, row.raisedBy, 'a data request');
  }
  if (next === 'denied' && !input.reason?.trim()) {
    throw badRequest('A refusal must record the legal or policy reason');
  }
  if (next === 'approved' && row.type === 'erasure' && row.legalHold) {
    throw conflict(
      'Erasure is refused while a legitimate recordkeeping or dispute obligation applies; refuse with a reason instead',
    );
  }

  const patch: Row = {
    status: next,
    history: [...(row.history || []), { status: next, at: ctx.now(), by: actorId, note: input.note ?? null }],
  };
  if (next === 'approved' || next === 'denied') {
    patch.decision = next;
    patch.decisionReason = input.reason ?? null;
    patch.decidedBy = actorId;
    patch.decidedAt = ctx.now();
  }
  if (next === 'completed') {
    patch.completedAt = ctx.now();
  }
  const updated = await ctx.repo.update(REQUESTS, id, patch);
  await ctx.audit.record({
    action: `compliance.data_request.${next}`,
    actorId,
    targetType: 'data_request',
    targetId: id,
    detail: { type: row.type, subjectId: row.subjectId },
  });
  return { ...(updated as Row), overdue: isOverdue(updated as Row, ctx.now()) };
}

export async function markLegalHold(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: Row = {},
): Promise<Row> {
  const row = await ctx.repo.get(REQUESTS, id);
  if (!row) throw notFound('Data request not found');
  if (!input.reason?.trim()) throw badRequest('A legal hold requires a documented reason');
  const updated = await ctx.repo.update(REQUESTS, id, {
    legalHold: true,
    legalHoldReason: input.reason.trim(),
  });
  await ctx.audit.record({
    action: 'compliance.data_request.legal_hold',
    actorId,
    targetType: 'data_request',
    targetId: id,
  });
  return updated as Row;
}

export async function listDataRequests(ctx: FeatureContext, filter: Row = {}) {
  const q: Row = {};
  if (filter.status) q.status = filter.status;
  if (filter.type) q.type = filter.type;
  if (filter.subjectId) q.subjectId = filter.subjectId;
  const limit = Number(filter.limit) > 0 ? Number(filter.limit) : 50;
  const offset = Number(filter.offset) > 0 ? Number(filter.offset) : 0;
  const all = await ctx.repo.find(REQUESTS, q, { orderBy: 'createdAt', desc: true });
  const items = all.slice(offset, offset + limit).map((r: Row) => ({ ...r, overdue: isOverdue(r, ctx.now()) }));
  return { items, total: all.length, limit, offset };
}

// --------------------------------------------------------------- retention ---

export async function createRetentionRule(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.dataCategory?.trim()) throw badRequest('dataCategory is required');
  const months = Number(input.retentionMonths);
  if (!Number.isInteger(months) || months < 1) {
    throw badRequest('retentionMonths must be a whole number of at least 1');
  }
  if (!input.reviewedBy?.trim()) {
    throw unprocessable('Retention periods must be defined after legal/institutional review; reviewedBy is required');
  }
  const now = new Date(ctx.now()).getTime();
  const row = await ctx.repo.insert(RETENTION, {
    id: ctx.newId(),
    dataCategory: input.dataCategory.trim(),
    retentionMonths: months,
    basis: input.basis || 'institutional_policy',
    reviewedBy: input.reviewedBy.trim(),
    reviewDueAt: new Date(now + dayMs(365)).toISOString(),
    status: 'active',
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'compliance.retention.create',
    actorId,
    targetType: 'retention_rule',
    targetId: row.id,
    detail: { dataCategory: row.dataCategory, retentionMonths: months },
  });
  return row;
}

export async function listRetentionRules(ctx: FeatureContext): Promise<Row[]> {
  return ctx.repo.find(RETENTION, {}, { orderBy: 'createdAt', desc: true });
}

/** Retention rule that applies to a category, used by erasure review. */
export async function retentionFor(ctx: FeatureContext, dataCategory: string) {
  return ctx.repo.findOne(RETENTION, { dataCategory, status: 'active' });
}

// -------------------------------------------------------- privacy incidents ---

export async function createPrivacyIncident(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.title?.trim()) throw badRequest('Incident title is required');
  const severity = input.severity || 'medium';
  if (!SEVERITIES.includes(severity)) throw badRequest(`severity must be one of ${SEVERITIES.join(', ')}`);
  const row = await ctx.repo.insert(PRIVACY_INCIDENTS, {
    id: ctx.newId(),
    title: input.title.trim(),
    severity,
    description: input.description ?? null,
    personalDataInvolved: !!input.personalDataInvolved,
    status: 'open',
    escalationLevel: 0,
    escalatedTo: null,
    reportedBy: actorId,
    reportedAt: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'compliance.incident.create',
    actorId,
    targetType: 'privacy_incident',
    targetId: row.id,
    detail: { severity },
  });
  return row;
}

export async function escalatePrivacyIncident(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: Row = {},
): Promise<Row> {
  const row = await ctx.repo.get(PRIVACY_INCIDENTS, id);
  if (!row) throw notFound('Incident not found');
  if (row.status === 'closed') throw conflict('A closed incident cannot be escalated');
  if (!input.escalatedTo?.trim()) throw badRequest('escalatedTo is required');
  const updated = await ctx.repo.update(PRIVACY_INCIDENTS, id, {
    status: 'escalated',
    escalationLevel: (Number(row.escalationLevel) || 0) + 1,
    escalatedTo: input.escalatedTo.trim(),
    escalatedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'compliance.incident.escalate',
    actorId,
    targetType: 'privacy_incident',
    targetId: id,
    detail: { escalatedTo: input.escalatedTo.trim() },
  });
  return updated as Row;
}
