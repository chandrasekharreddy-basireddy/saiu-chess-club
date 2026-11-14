import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

/**
 * Feature 14 — Volunteer & Participation Management.
 *
 * Tables
 *  - volunteer_opportunities { title, description, requirements, capacity, activityId, status, createdBy }
 *  - volunteer_shifts        { opportunityId, role, startsAt, endsAt, capacity, status }
 *  - volunteer_assignments   { shiftId, opportunityId, volunteerId, status, checkedInAt, checkedInBy,
 *                              feedback, rating, completedBy, completedAt, withdrawnAt }
 *
 * Assignment statuses: assigned | confirmed | declined | checked_in | completed | withdrawn.
 * `assigned`, `confirmed`, `checked_in` and `completed` occupy shift capacity.
 * Volunteer status never implies broad admin permission — the routes check
 * `volunteer.manage` for every supervisory action.
 */

export const OPPORTUNITIES = 'volunteer_opportunities';
export const SHIFTS = 'volunteer_shifts';
export const ASSIGNMENTS = 'volunteer_assignments';

export const OCCUPYING = ['assigned', 'confirmed', 'checked_in', 'completed'];

function positiveInt(v: any, field: string, fallback?: number): number {
  if (v == null) {
    if (fallback != null) return fallback;
    throw badRequest(`${field} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) throw badRequest(`${field} must be a positive number`);
  return Math.floor(n);
}

function isoDate(v: any, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${field} is required`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} must be a valid ISO date`);
  return d.toISOString();
}

async function occupyingCount(ctx: FeatureContext, filter: Row): Promise<number> {
  const rows = await ctx.repo.find(ASSIGNMENTS, filter);
  return rows.filter((r: Row) => OCCUPYING.includes(r.status)).length;
}

/* ------------------------------------------------------- opportunities */

export async function createOpportunity(
  ctx: FeatureContext,
  actorId: string,
  input: { title?: string; description?: string; requirements?: string[]; capacity?: number; activityId?: string } = {},
) {
  if (!input.title || !String(input.title).trim()) throw badRequest('title is required');
  const capacity = positiveInt(input.capacity, 'capacity', 1);
  const row = await ctx.repo.insert(OPPORTUNITIES, {
    id: ctx.newId(),
    title: String(input.title).trim(),
    description: input.description ?? null,
    requirements: Array.isArray(input.requirements) ? input.requirements : [],
    capacity,
    activityId: input.activityId ?? null,
    status: 'open',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'volunteer.opportunity.create',
    actorId,
    targetType: 'volunteer_opportunity',
    targetId: row.id,
    detail: { title: row.title, capacity },
  });
  return row;
}

export async function listOpportunities(ctx: FeatureContext, filter: { status?: string } = {}) {
  return ctx.repo.find(OPPORTUNITIES, filter.status ? { status: filter.status } : {}, { orderBy: 'createdAt', desc: true });
}

export async function getOpportunity(ctx: FeatureContext, id: string) {
  const opp = await ctx.repo.get(OPPORTUNITIES, id);
  if (!opp) throw notFound('Volunteer opportunity not found');
  const shifts = await ctx.repo.find(SHIFTS, { opportunityId: id }, { orderBy: 'startsAt' });
  const withCounts: Row[] = [];
  for (const s of shifts) {
    withCounts.push({ ...s, filled: await occupyingCount(ctx, { shiftId: s.id }) });
  }
  return { ...opp, shifts: withCounts };
}

export async function closeOpportunity(ctx: FeatureContext, actorId: string, id: string) {
  const opp = await ctx.repo.get(OPPORTUNITIES, id);
  if (!opp) throw notFound('Volunteer opportunity not found');
  if (opp.status === 'closed') throw conflict('Opportunity is already closed');
  const updated = await ctx.repo.update(OPPORTUNITIES, id, { status: 'closed', closedAt: ctx.now() });
  await ctx.audit.record({ action: 'volunteer.opportunity.close', actorId, targetType: 'volunteer_opportunity', targetId: id });
  return updated;
}

/* -------------------------------------------------------------- shifts */

export async function createShift(
  ctx: FeatureContext,
  actorId: string,
  opportunityId: string,
  input: { role?: string; startsAt?: string; endsAt?: string; capacity?: number } = {},
) {
  const opp = await ctx.repo.get(OPPORTUNITIES, opportunityId);
  if (!opp) throw notFound('Volunteer opportunity not found');
  if (opp.status !== 'open') throw conflict(`Cannot add shifts to a ${opp.status} opportunity`);

  const startsAt = isoDate(input.startsAt, 'startsAt');
  const endsAt = isoDate(input.endsAt, 'endsAt');
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw badRequest('endsAt must be after startsAt');
  const capacity = positiveInt(input.capacity, 'capacity', opp.capacity ?? 1);

  const row = await ctx.repo.insert(SHIFTS, {
    id: ctx.newId(),
    opportunityId,
    role: input.role || 'general',
    startsAt,
    endsAt,
    capacity,
    status: 'scheduled',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'volunteer.shift.create',
    actorId,
    targetType: 'volunteer_shift',
    targetId: row.id,
    detail: { opportunityId, capacity, role: row.role },
  });
  return row;
}

export async function listShifts(ctx: FeatureContext, opportunityId: string) {
  return ctx.repo.find(SHIFTS, { opportunityId }, { orderBy: 'startsAt' });
}

/* --------------------------------------------------------- assignments */

export async function signupForShift(ctx: FeatureContext, volunteerId: string, shiftId: string) {
  const shift = await ctx.repo.get(SHIFTS, shiftId);
  if (!shift) throw notFound('Volunteer shift not found');
  const opp = await ctx.repo.get(OPPORTUNITIES, shift.opportunityId);
  if (!opp) throw notFound('Volunteer opportunity not found');
  if (opp.status !== 'open') throw conflict(`Opportunity is ${opp.status}`);
  if (shift.status === 'cancelled') throw conflict('Shift is cancelled');

  const existing = await ctx.repo.findOne(ASSIGNMENTS, { shiftId, volunteerId });
  if (existing && existing.status !== 'withdrawn' && existing.status !== 'declined') {
    throw conflict('You are already signed up for this shift');
  }

  const filled = await occupyingCount(ctx, { shiftId });
  if (filled >= (shift.capacity ?? 1)) throw conflict('Shift is full');

  const totalAssigned = await occupyingCount(ctx, { opportunityId: shift.opportunityId });
  if (opp.capacity && totalAssigned >= opp.capacity) throw conflict('Opportunity capacity is full');

  const row = existing
    ? await ctx.repo.update(ASSIGNMENTS, existing.id, {
        status: 'assigned',
        opportunityId: shift.opportunityId,
        withdrawnAt: null,
        signedUpAt: ctx.now(),
      })
    : await ctx.repo.insert(ASSIGNMENTS, {
        id: ctx.newId(),
        shiftId,
        opportunityId: shift.opportunityId,
        volunteerId,
        status: 'assigned',
        checkedInAt: null,
        checkedInBy: null,
        feedback: null,
        rating: null,
        signedUpAt: ctx.now(),
        createdAt: ctx.now(),
      });
  await ctx.audit.record({
    action: 'volunteer.assignment.create',
    actorId: volunteerId,
    targetType: 'volunteer_assignment',
    targetId: row!.id,
    detail: { shiftId, opportunityId: shift.opportunityId, filled: filled + 1, capacity: shift.capacity },
  });
  return row;
}

async function ownAssignment(ctx: FeatureContext, id: string) {
  const a = await ctx.repo.get(ASSIGNMENTS, id);
  if (!a) throw notFound('Assignment not found');
  return a;
}

export async function confirmAssignment(ctx: FeatureContext, actorId: string, id: string, input: { accept?: boolean } = {}) {
  const a = await ownAssignment(ctx, id);
  if (a.volunteerId !== actorId) throw forbidden('You may only respond to your own assignment');
  if (a.status !== 'assigned') throw conflict(`Cannot confirm a ${a.status} assignment`);
  if (typeof input.accept !== 'boolean') throw badRequest('accept must be a boolean');
  const status = input.accept ? 'confirmed' : 'declined';
  const updated = await ctx.repo.update(ASSIGNMENTS, id, { status, respondedAt: ctx.now() });
  await ctx.audit.record({
    action: `volunteer.assignment.${status}`,
    actorId,
    targetType: 'volunteer_assignment',
    targetId: id,
    detail: { shiftId: a.shiftId },
  });
  return updated;
}

export async function withdrawAssignment(ctx: FeatureContext, actorId: string, id: string) {
  const a = await ownAssignment(ctx, id);
  if (a.volunteerId !== actorId) throw forbidden('You may only withdraw your own assignment');
  if (['withdrawn', 'completed', 'declined'].includes(a.status)) throw conflict(`Cannot withdraw a ${a.status} assignment`);
  const updated = await ctx.repo.update(ASSIGNMENTS, id, { status: 'withdrawn', withdrawnAt: ctx.now() });
  await ctx.audit.record({ action: 'volunteer.assignment.withdraw', actorId, targetType: 'volunteer_assignment', targetId: id });
  return updated;
}

export async function checkIn(ctx: FeatureContext, actorId: string, id: string, opts: { supervisor?: boolean } = {}) {
  const a = await ownAssignment(ctx, id);
  if (!opts.supervisor && a.volunteerId !== actorId) throw forbidden('You may only check in to your own assignment');
  if (a.status === 'checked_in' || a.checkedInAt) throw conflict('Attendance is already recorded for this assignment');
  if (a.status !== 'confirmed') throw conflict(`Cannot check in a ${a.status} assignment`);
  const updated = await ctx.repo.update(ASSIGNMENTS, id, {
    status: 'checked_in',
    checkedInAt: ctx.now(),
    checkedInBy: actorId,
  });
  await ctx.audit.record({
    action: 'volunteer.attendance.checkin',
    actorId,
    targetType: 'volunteer_assignment',
    targetId: id,
    detail: { volunteerId: a.volunteerId, shiftId: a.shiftId },
  });
  return updated;
}

export async function completeAssignment(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: { feedback?: string; rating?: number } = {},
) {
  const a = await ownAssignment(ctx, id);
  if (a.status !== 'checked_in') throw conflict('Task completion requires recorded attendance');
  const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : '';
  if (!feedback) throw badRequest('feedback is required to sign off a task');
  const rating = input.rating == null ? null : Number(input.rating);
  if (rating != null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) throw badRequest('rating must be between 1 and 5');
  const updated = await ctx.repo.update(ASSIGNMENTS, id, {
    status: 'completed',
    feedback,
    rating,
    completedBy: actorId,
    completedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'volunteer.task.complete',
    actorId,
    targetType: 'volunteer_assignment',
    targetId: id,
    detail: { volunteerId: a.volunteerId, rating },
  });
  return updated;
}

/** Corrects a participation record; the correction itself is audited. */
export async function correctAssignment(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: { status?: string; reason?: string } = {},
) {
  const allowed = ['assigned', 'confirmed', 'declined', 'checked_in', 'completed', 'withdrawn'];
  if (!input.status || !allowed.includes(input.status)) throw badRequest(`status must be one of ${allowed.join(', ')}`);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw badRequest('reason is required to correct a participation record');
  const a = await ownAssignment(ctx, id);
  const updated = await ctx.repo.update(ASSIGNMENTS, id, {
    status: input.status,
    correctionReason: reason,
    correctedBy: actorId,
    correctedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'volunteer.participation.correct',
    actorId,
    targetType: 'volunteer_assignment',
    targetId: id,
    detail: { from: a.status, to: input.status, reason },
  });
  return updated;
}

export async function myShifts(ctx: FeatureContext, volunteerId: string) {
  const rows = await ctx.repo.find(ASSIGNMENTS, { volunteerId }, { orderBy: 'signedUpAt' });
  const out: Row[] = [];
  for (const a of rows) {
    const shift = await ctx.repo.get(SHIFTS, a.shiftId);
    const opp = await ctx.repo.get(OPPORTUNITIES, a.opportunityId);
    out.push({ ...a, shift, opportunity: opp ? { id: opp.id, title: opp.title } : null });
  }
  return out;
}

/** Supervisor roster — restricted to the assigned activity's officials. */
export async function opportunityRoster(ctx: FeatureContext, opportunityId: string) {
  const opp = await ctx.repo.get(OPPORTUNITIES, opportunityId);
  if (!opp) throw notFound('Volunteer opportunity not found');
  const assignments = await ctx.repo.find(ASSIGNMENTS, { opportunityId }, { orderBy: 'signedUpAt' });
  const out: Row[] = [];
  for (const a of assignments) {
    const shift = await ctx.repo.get(SHIFTS, a.shiftId);
    const volunteer = await ctx.repo.get('users', a.volunteerId);
    out.push({
      assignmentId: a.id,
      volunteerId: a.volunteerId,
      volunteerName: volunteer?.name ?? null,
      status: a.status,
      role: shift?.role ?? null,
      startsAt: shift?.startsAt ?? null,
      checkedInAt: a.checkedInAt ?? null,
    });
  }
  return { opportunity: { id: opp.id, title: opp.title }, assignments: out };
}

export async function participationHistory(ctx: FeatureContext, volunteerId: string) {
  const rows = await ctx.repo.find(ASSIGNMENTS, { volunteerId });
  const completed = rows.filter((r: Row) => r.status === 'completed');
  let totalHours = 0;
  for (const r of completed) {
    const shift = await ctx.repo.get(SHIFTS, r.shiftId);
    if (shift?.startsAt && shift?.endsAt) {
      const ms = new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime();
      if (ms > 0) totalHours += ms / 3600000;
    }
  }
  return {
    volunteerId,
    totalAssignments: rows.length,
    completedAssignments: completed.length,
    totalHours: Math.round(totalHours * 100) / 100,
    completed,
  };
}
