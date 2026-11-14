import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 43 — Disaster Recovery & Emergency Operations
 * Tables owned by this feature:
 *   recovery_plans              recovery plan record: RPO/RTO minutes, evidence, drill log
 *   recovery_drills             drill results, actual timings and tracked improvements
 *   recovery_contacts           emergency contacts and incident-command roles
 *   recovery_continuity_events  tournament continuity / offline manual decisions
 *
 * Recovery objectives are evidence-based: a plan cannot be approved without a backup /
 * restore feasibility reference, and a drill that misses the RTO must record improvements.
 * No recovery time is promised that has not been demonstrated by a test.
 */

export const PLANS = 'recovery_plans';
export const DRILLS = 'recovery_drills';
export const CONTACTS = 'recovery_contacts';
export const CONTINUITY = 'recovery_continuity_events';

/** Fixed recovery priority order (spec §Recovery priorities). */
export const RECOVERY_PRIORITIES = [
  'Protect account security and data integrity',
  'Preserve official match and tournament records',
  'Restore database access and core authentication',
  'Restore tournament operations and critical notifications',
  'Restore community and learning functions',
  'Restore noncritical analytics and optional AI',
];

export const OFFLINE_FALLBACKS = [
  'Score sheets on paper, countersigned by both players and the arbiter',
  'Manual pairing board maintained by the arbiter, transcribed on restore',
  'Tournament status broadcast by email / phone tree while the app is unavailable',
];

function intMinutes(value: any, field: string, min: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw badRequest(`${field} must be a whole number of minutes (>= ${min})`);
  }
  return n;
}

// ------------------------------------------------------------------- plans ---

export async function createPlan(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.name?.trim()) throw badRequest('Plan name is required');
  const rpoMinutes = intMinutes(input.rpoMinutes, 'rpoMinutes', 0);
  const rtoMinutes = intMinutes(input.rtoMinutes, 'rtoMinutes', 1);
  if (!input.evidenceRef?.trim()) {
    throw unprocessable(
      'Recovery objectives must be set after capacity and backup feasibility testing; evidenceRef is required',
    );
  }
  const row = await ctx.repo.insert(PLANS, {
    id: ctx.newId(),
    name: input.name.trim(),
    scope: input.scope || 'platform',
    rpoMinutes,
    rtoMinutes,
    evidenceRef: input.evidenceRef.trim(),
    evidenceTestedAt: input.evidenceTestedAt || ctx.now(),
    priorities: Array.isArray(input.priorities) && input.priorities.length
      ? input.priorities
      : RECOVERY_PRIORITIES,
    status: 'draft',
    drillLog: [],
    lastDrillAt: null,
    rtoBreached: false,
    approvedBy: null,
    approvedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'recovery.plan.create',
    actorId,
    targetType: 'recovery_plan',
    targetId: row.id,
    detail: { rpoMinutes, rtoMinutes, evidenceRef: row.evidenceRef },
  });
  return row;
}

export async function approvePlan(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: Row = {},
): Promise<Row> {
  const plan = await ctx.repo.get(PLANS, id);
  if (!plan) throw notFound('Recovery plan not found');
  if (plan.status !== 'draft') throw conflict(`Only a draft plan can be approved (current: ${plan.status})`);
  if (!plan.evidenceRef) {
    throw unprocessable('A plan without tested backup/restore evidence cannot be approved');
  }
  try {
    assertNotSelfApproval(actorId, plan.createdBy, 'a recovery plan');
  } catch (e: any) {
    throw forbidden(e?.message || 'Separation of duties: the author cannot approve their own recovery plan');
  }
  const updated = await ctx.repo.update(PLANS, id, {
    status: 'approved',
    approvedBy: actorId,
    approvedAt: ctx.now(),
    approvalNote: input.note ?? null,
  });
  await ctx.audit.record({
    action: 'recovery.plan.approve',
    actorId,
    targetType: 'recovery_plan',
    targetId: id,
    detail: { rtoMinutes: plan.rtoMinutes, evidenceRef: plan.evidenceRef },
  });
  return updated as Row;
}

export async function getPlan(ctx: FeatureContext, id: string): Promise<Row> {
  const plan = await ctx.repo.get(PLANS, id);
  if (!plan) throw notFound('Recovery plan not found');
  const drills = await ctx.repo.find(DRILLS, { planId: id }, { orderBy: 'drilledAt', desc: true });
  return { ...plan, drills, drillCount: drills.length };
}

export async function listPlans(ctx: FeatureContext, filter: Row = {}): Promise<Row[]> {
  const q: Row = {};
  if (filter.status) q.status = filter.status;
  return ctx.repo.find(PLANS, q, { orderBy: 'createdAt', desc: true });
}

// ------------------------------------------------------------------ drills ---

export async function recordDrill(
  ctx: FeatureContext,
  actorId: string,
  planId: string,
  input: Row = {},
): Promise<Row> {
  const plan = await ctx.repo.get(PLANS, planId);
  if (!plan) throw notFound('Recovery plan not found');
  if (plan.status === 'draft') {
    throw conflict('The plan must be approved before drills are recorded against it');
  }
  const actualRtoMinutes = intMinutes(input.actualRtoMinutes, 'actualRtoMinutes', 0);
  const actualRpoMinutes = input.actualRpoMinutes != null
    ? intMinutes(input.actualRpoMinutes, 'actualRpoMinutes', 0)
    : null;
  const improvements = Array.isArray(input.improvements) ? input.improvements.filter((i: any) => !!i) : [];
  const rtoBreached = actualRtoMinutes > Number(plan.rtoMinutes);
  const rpoBreached = actualRpoMinutes != null && actualRpoMinutes > Number(plan.rpoMinutes);
  if ((rtoBreached || rpoBreached) && improvements.length === 0) {
    throw badRequest('A drill that misses its RPO/RTO must record at least one tracked improvement');
  }

  const drill = await ctx.repo.insert(DRILLS, {
    id: ctx.newId(),
    planId,
    outcome: input.outcome || (rtoBreached ? 'breached' : 'passed'),
    actualRtoMinutes,
    actualRpoMinutes,
    targetRtoMinutes: plan.rtoMinutes,
    targetRpoMinutes: plan.rpoMinutes,
    rtoBreached,
    rpoBreached,
    lessons: input.lessons ?? null,
    improvements,
    improvementCount: improvements.length,
    drilledBy: actorId,
    drilledAt: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.repo.update(PLANS, planId, {
    drillLog: [...(plan.drillLog || []), drill.id],
    lastDrillAt: ctx.now(),
    rtoBreached: rtoBreached || !!plan.rtoBreached,
    lastActualRtoMinutes: actualRtoMinutes,
  });
  await ctx.audit.record({
    action: 'recovery.drill.record',
    actorId,
    targetType: 'recovery_drill',
    targetId: drill.id,
    detail: { planId, actualRtoMinutes, targetRtoMinutes: plan.rtoMinutes, rtoBreached },
  });
  return drill;
}

export async function listDrills(ctx: FeatureContext, planId: string): Promise<Row[]> {
  return ctx.repo.find(DRILLS, { planId }, { orderBy: 'drilledAt', desc: true });
}

// ---------------------------------------------------------------- contacts ---

export async function addContact(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.role?.trim()) throw badRequest('Emergency contact role is required');
  if (!input?.name?.trim()) throw badRequest('Emergency contact name is required');
  if (!input?.contact?.trim()) throw badRequest('Emergency contact detail (phone/email) is required');
  const row = await ctx.repo.insert(CONTACTS, {
    id: ctx.newId(),
    role: input.role.trim(),
    name: input.name.trim(),
    contact: input.contact.trim(),
    backupName: input.backupName ?? null,
    active: true,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'recovery.contact.add',
    actorId,
    targetType: 'recovery_contact',
    targetId: row.id,
    detail: { role: row.role },
  });
  return row;
}

export async function listContacts(ctx: FeatureContext): Promise<Row[]> {
  return ctx.repo.find(CONTACTS, { active: true }, { orderBy: 'role' });
}

// -------------------------------------------------------- continuity events ---

export async function pauseForContinuity(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.tournamentId?.trim()) throw badRequest('tournamentId is required');
  if (!input?.reason?.trim()) throw badRequest('A continuity pause requires a documented reason');
  const row = await ctx.repo.insert(CONTINUITY, {
    id: ctx.newId(),
    tournamentId: input.tournamentId.trim(),
    reason: input.reason.trim(),
    mode: input.mode || 'paused',
    status: 'paused',
    // Preserve the last confirmed authoritative state; no automatic walkovers on outage.
    preservedStateRef: input.preservedStateRef ?? null,
    walkoverAwarded: false,
    manualDecisionRecorded: true,
    reconcileRequired: true,
    pausedBy: actorId,
    pausedAt: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'recovery.continuity.pause',
    actorId,
    targetType: 'continuity_event',
    targetId: row.id,
    detail: { tournamentId: row.tournamentId, walkoverAwarded: false },
  });
  return row;
}

export async function reconcileContinuity(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: Row = {},
): Promise<Row> {
  const row = await ctx.repo.get(CONTINUITY, id);
  if (!row) throw notFound('Continuity event not found');
  if (row.status !== 'paused') throw conflict(`Continuity event is already ${row.status}`);
  if (!input.reconciliationNote?.trim()) {
    throw badRequest('Manual decisions must be reconciled with a recorded note');
  }
  const updated = await ctx.repo.update(CONTINUITY, id, {
    status: 'reconciled',
    reconcileRequired: false,
    reconciliationNote: input.reconciliationNote.trim(),
    reconciledBy: actorId,
    reconciledAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'recovery.continuity.reconcile',
    actorId,
    targetType: 'continuity_event',
    targetId: id,
  });
  return updated as Row;
}

// ----------------------------------------------------------- command view ---

export async function commandView(ctx: FeatureContext): Promise<Row> {
  const plans = await ctx.repo.find(PLANS, { status: 'approved' });
  const contacts = await ctx.repo.find(CONTACTS, { active: true }, { orderBy: 'role' });
  const openEvents = await ctx.repo.find(CONTINUITY, { status: 'paused' });
  return {
    generatedAt: ctx.now(),
    priorities: RECOVERY_PRIORITIES.map((p, i) => ({ rank: i + 1, priority: p })),
    plans: plans.map((p: Row) => ({
      id: p.id,
      name: p.name,
      rpoMinutes: p.rpoMinutes,
      rtoMinutes: p.rtoMinutes,
      evidenceRef: p.evidenceRef,
      lastDrillAt: p.lastDrillAt,
      drillCount: (p.drillLog || []).length,
      rtoBreached: !!p.rtoBreached,
    })),
    contacts,
    offlineFallbacks: OFFLINE_FALLBACKS,
    openContinuityEvents: openEvents,
    claims: {
      evidenceBased: plans.length > 0 && plans.every((p: Row) => !!p.evidenceRef),
      note: 'Recovery times are only claimed where a backup/restore test has been recorded.',
    },
  };
}
