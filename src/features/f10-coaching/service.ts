import type { FeatureContext } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

/**
 * Feature 10 — Chess Coaching & Mentorship
 *
 * Tables (created implicitly on first insert):
 *   coaching_offerings          catalogue of coaching offerings (1:1, group, mentorship, clinic, self-learning)
 *   coaching_assignments        coach -> student assignments (the only source of coach scope)
 *   coaching_sessions           booking requests, confirmations, completion and participation
 *   coaching_notes              session learning notes with explicit visibility
 *   coaching_plans              learning plans (coach-led or independent self-learning)
 *   coaching_calendar_entries   calendar entries created on confirmation
 *   coaching_notifications      notification jobs created on confirmation
 *
 * Access rule: a coach may act only on students they are assigned to. Holding the
 * coaching.assignment.manage permission never widens that scope, and coaching grants no
 * admin, finance or general student-record access. Meeting links are returned to participants
 * only and are never exposed on catalogue or list endpoints.
 */

export const OFFERINGS = 'coaching_offerings';
export const ASSIGNMENTS = 'coaching_assignments';
export const SESSIONS = 'coaching_sessions';
export const NOTES = 'coaching_notes';
export const PLANS = 'coaching_plans';
export const CALENDAR = 'coaching_calendar_entries';
export const NOTIFICATIONS = 'coaching_notifications';

export const TYPES = ['one_to_one', 'group', 'mentorship', 'self_learning', 'clinic'];
export const SESSION_STATUSES = ['requested', 'confirmed', 'completed', 'cancelled'];
export const VISIBILITIES = ['private', 'shared'];

function isAdmin(session: any) {
  return ((session?.permissions || []) as string[]).includes('*');
}

export async function createOffering(ctx: FeatureContext, actorId: string, input: any) {
  const title = String(input?.title ?? '').trim();
  if (!title) throw badRequest('Offering title is required');
  const type = String(input?.type ?? 'one_to_one');
  if (!TYPES.includes(type)) throw badRequest(`type must be one of: ${TYPES.join(', ')}`);
  const capacity = type === 'group' || type === 'clinic' ? Number(input?.capacity ?? 8) : 1;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 60) throw badRequest('capacity must be an integer between 1 and 60');
  const venueType = String(input?.venueType ?? 'physical');
  if (!['physical', 'online'].includes(venueType)) throw badRequest('venueType must be physical or online');

  const offering = await ctx.repo.insert(OFFERINGS, {
    id: ctx.newId(),
    title,
    type,
    coachId: String(input?.coachId ?? actorId),
    capacity,
    venueType,
    venue: input?.venue ?? null,
    meetingLink: input?.meetingLink ?? null,
    meetingIntegration: input?.meetingLink ? 'optional_free_tier' : 'none',
    status: 'open',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'coaching.offering.create', actorId, targetType: 'coaching_offering', targetId: offering.id, detail: { type, capacity } });
  return offering;
}

/** Catalogue view: never leaks meeting links. */
export async function listOfferings(ctx: FeatureContext) {
  const rows = await ctx.repo.find(OFFERINGS, { status: 'open' });
  return rows.map((o: any) => ({
    id: o.id,
    title: o.title,
    type: o.type,
    coachId: o.coachId,
    capacity: o.capacity,
    venueType: o.venueType,
    venue: o.venue,
    meetingAvailable: !!o.meetingLink,
    status: o.status,
  }));
}

export async function assignStudent(ctx: FeatureContext, actorId: string, input: any) {
  const coachId = String(input?.coachId ?? '');
  const studentId = String(input?.studentId ?? '');
  if (!coachId || !studentId) throw badRequest('coachId and studentId are required');
  if (coachId === studentId) throw badRequest('A coach cannot be assigned to themselves');

  const existing = await ctx.repo.findOne(ASSIGNMENTS, { coachId, studentId });
  if (existing && existing.status === 'active') throw conflict('Student is already assigned to this coach');

  const row = existing
    ? await ctx.repo.update(ASSIGNMENTS, existing.id, { status: 'active', offeringId: input?.offeringId ?? existing.offeringId ?? null })
    : await ctx.repo.insert(ASSIGNMENTS, {
        id: ctx.newId(),
        coachId,
        studentId,
        offeringId: input?.offeringId ?? null,
        status: 'active',
        createdBy: actorId,
        createdAt: ctx.now(),
      });
  await ctx.audit.record({ action: 'coaching.assignment.create', actorId, targetType: 'coaching_assignment', targetId: (row as any).id, detail: { coachId, studentId } });
  return row;
}

export async function isAssigned(ctx: FeatureContext, coachId: string, studentId: string) {
  const row = await ctx.repo.findOne(ASSIGNMENTS, { coachId, studentId, status: 'active' });
  return !!row;
}

async function assertAssignedCoach(ctx: FeatureContext, session: any, coachId: string, studentId: string) {
  if (isAdmin(session)) return;
  if (session.userId !== coachId) throw forbidden('You may only manage your own coaching scope');
  const okAssigned = await isAssigned(ctx, coachId, studentId);
  if (!okAssigned) throw forbidden('You are not assigned to this student');
}

/** A coach sees only assigned learners; nobody else may list them. */
export async function listStudents(ctx: FeatureContext, session: any, coachId: string) {
  if (!isAdmin(session) && session.userId !== coachId) {
    throw forbidden('You may only view your own assigned learners');
  }
  const rows = await ctx.repo.find(ASSIGNMENTS, { coachId, status: 'active' });
  return rows.map((r: any) => ({ studentId: r.studentId, offeringId: r.offeringId, since: r.createdAt }));
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

export async function requestSession(ctx: FeatureContext, session: any, input: any) {
  const offeringId = String(input?.offeringId ?? '');
  if (!offeringId) throw badRequest('offeringId is required');
  const offering = await ctx.repo.get(OFFERINGS, offeringId);
  if (!offering) throw notFound('Coaching offering not found');
  if (offering.status !== 'open') throw conflict('This offering is not open for booking');

  const startsAt = input?.startsAt;
  const endsAt = input?.endsAt;
  if (!startsAt || !endsAt) throw badRequest('startsAt and endsAt are required');
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) throw badRequest('startsAt and endsAt must be valid ISO timestamps');
  if (end <= start) throw badRequest('endsAt must be after startsAt');

  const studentId = String(input?.studentId ?? session.userId);
  if (studentId !== session.userId) {
    await assertAssignedCoach(ctx, session, offering.coachId, studentId);
  }
  if (offering.type === 'one_to_one' || offering.type === 'mentorship') {
    const assigned = await isAssigned(ctx, offering.coachId, studentId);
    if (!assigned) throw conflict('This coaching offering requires an active coach assignment');
  }

  const active = (await ctx.repo.find(SESSIONS, { coachId: offering.coachId })).filter(
    (s: any) => s.status === 'requested' || s.status === 'confirmed',
  );
  const coachClash = active.find((s: any) => overlap(start, end, new Date(s.startsAt).getTime(), new Date(s.endsAt).getTime()));
  if (coachClash) throw conflict('The coach already has a session in this time slot', { conflictWith: coachClash.id });

  const mine = (await ctx.repo.find(SESSIONS, { requestedBy: studentId })).filter(
    (s: any) => s.status === 'requested' || s.status === 'confirmed',
  );
  const studentClash = mine.find((s: any) => overlap(start, end, new Date(s.startsAt).getTime(), new Date(s.endsAt).getTime()));
  if (studentClash) throw conflict('You already have a session in this time slot', { conflictWith: studentClash.id });

  const row = await ctx.repo.insert(SESSIONS, {
    id: ctx.newId(),
    offeringId,
    coachId: offering.coachId,
    studentIds: [studentId],
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    venueType: offering.venueType,
    venue: offering.venue,
    meetingLink: offering.meetingLink,
    status: 'requested',
    requestedBy: session.userId,
    confirmedBy: null,
    completedAt: null,
    participation: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'coaching.session.request', actorId: session.userId, targetType: 'coaching_session', targetId: row.id, detail: { offeringId, studentId } });
  return row;
}

async function sessionOr404(ctx: FeatureContext, sessionId: string) {
  const s = await ctx.repo.get(SESSIONS, sessionId);
  if (!s) throw notFound('Coaching session not found');
  return s;
}

function isParticipant(session: any, row: any) {
  if (!session) return false;
  if (row.coachId === session.userId) return true;
  return (row.studentIds || []).includes(session.userId);
}

async function assertCoachOfSession(ctx: FeatureContext, session: any, row: any) {
  if (isAdmin(session)) return;
  if (row.coachId !== session.userId) throw forbidden('Only the assigned coach may manage this session');
  for (const studentId of row.studentIds || []) {
    const assigned = await isAssigned(ctx, row.coachId, studentId);
    if (!assigned) throw forbidden('You are no longer assigned to this student');
  }
}

export async function confirmSession(ctx: FeatureContext, session: any, sessionId: string) {
  const row = await sessionOr404(ctx, sessionId);
  await assertCoachOfSession(ctx, session, row);
  if (row.status === 'confirmed') throw conflict('Session is already confirmed');
  if (row.status !== 'requested') throw conflict(`A ${row.status} session cannot be confirmed`);

  const updated = await ctx.repo.update(SESSIONS, sessionId, { status: 'confirmed', confirmedBy: session.userId, confirmedAt: ctx.now() });
  const calendar = await ctx.repo.insert(CALENDAR, {
    id: ctx.newId(),
    sessionId,
    coachId: row.coachId,
    studentIds: row.studentIds || [],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    venueType: row.venueType,
    createdAt: ctx.now(),
  });
  const notification = await ctx.repo.insert(NOTIFICATIONS, {
    id: ctx.newId(),
    sessionId,
    job: 'coaching.session.confirmed',
    recipients: [row.coachId, ...(row.studentIds || [])],
    status: 'queued',
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'coaching.session.confirm', actorId: session.userId, targetType: 'coaching_session', targetId: sessionId });
  return { session: updated, calendar, notification };
}

export async function addSessionNotes(ctx: FeatureContext, session: any, sessionId: string, input: any) {
  const row = await sessionOr404(ctx, sessionId);
  await assertCoachOfSession(ctx, session, row);
  const text = String(input?.text ?? '').trim();
  if (!text) throw badRequest('Note text is required');
  if (text.length > 2000) throw badRequest('Note text must be 2000 characters or fewer');
  const visibility = String(input?.visibility ?? '');
  if (!VISIBILITIES.includes(visibility)) throw badRequest(`visibility must be one of: ${VISIBILITIES.join(', ')}`);

  const note = await ctx.repo.insert(NOTES, {
    id: ctx.newId(),
    sessionId,
    coachId: row.coachId,
    studentIds: row.studentIds || [],
    text,
    nextSteps: input?.nextSteps ?? null,
    visibility,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'coaching.notes.create', actorId: session.userId, targetType: 'coaching_note', targetId: note.id, detail: { sessionId, visibility } });
  return note;
}

export async function completeSession(ctx: FeatureContext, session: any, sessionId: string, input: any) {
  const row = await sessionOr404(ctx, sessionId);
  await assertCoachOfSession(ctx, session, row);
  if (row.status === 'completed') throw conflict('Session is already completed');
  if (row.status !== 'confirmed') throw conflict('Only a confirmed session can be completed');

  const participation = Array.isArray(input?.attended)
    ? input.attended.map((id: any) => ({ studentId: String(id), attended: true }))
    : (row.studentIds || []).map((id: string) => ({ studentId: id, attended: true }));

  const updated = await ctx.repo.update(SESSIONS, sessionId, { status: 'completed', completedAt: ctx.now(), participation });
  await ctx.audit.record({ action: 'coaching.session.complete', actorId: session.userId, targetType: 'coaching_session', targetId: sessionId, detail: { participation } });
  return updated;
}

/** Session detail. Meeting links and private notes are visible to participants only. */
export async function getSession(ctx: FeatureContext, session: any, sessionId: string) {
  const row = await sessionOr404(ctx, sessionId);
  if (!isParticipant(session, row) && !isAdmin(session)) {
    throw forbidden('You are not a participant in this session');
  }
  const notes = await ctx.repo.find(NOTES, { sessionId });
  const visibleNotes = notes.filter((n: any) => n.visibility === 'shared' || n.coachId === session.userId || isAdmin(session));
  return {
    ...row,
    meetingLink: isParticipant(session, row) || isAdmin(session) ? row.meetingLink : null,
    notes: visibleNotes,
  };
}

export async function listMySessions(ctx: FeatureContext, session: any) {
  const asCoach = await ctx.repo.find(SESSIONS, { coachId: session.userId });
  const all = await ctx.repo.find(SESSIONS, {});
  const asStudent = all.filter((s: any) => (s.studentIds || []).includes(session.userId));
  const seen = new Set<string>();
  const items = [...asCoach, ...asStudent].filter((s: any) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  return items.sort((a: any, b: any) => String(a.startsAt).localeCompare(String(b.startsAt)));
}

export async function createPlan(ctx: FeatureContext, session: any, input: any) {
  const title = String(input?.title ?? '').trim();
  if (!title) throw badRequest('Plan title is required');
  const kind = String(input?.kind ?? 'coach_led');
  if (!['coach_led', 'self_learning', 'mentorship'].includes(kind)) {
    throw badRequest('kind must be one of: coach_led, self_learning, mentorship');
  }
  const studentId = String(input?.studentId ?? session.userId);
  let coachId: string | null = null;
  if (studentId === session.userId) {
    if (kind !== 'self_learning' && !isAdmin(session)) {
      throw forbidden('Independent plans are self-learning plans; coach-led plans are created by the coach');
    }
  } else {
    if (kind === 'self_learning') throw badRequest('Self-learning plans belong to the learner');
    await assertAssignedCoach(ctx, session, String(input?.coachId ?? session.userId), studentId);
    coachId = String(input?.coachId ?? session.userId);
  }

  const plan = await ctx.repo.insert(PLANS, {
    id: ctx.newId(),
    studentId,
    coachId,
    kind,
    title,
    goals: Array.isArray(input?.goals) ? input.goals.map((g: any) => String(g)) : [],
    status: 'active',
    createdBy: session.userId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'coaching.plan.create', actorId: session.userId, targetType: 'coaching_plan', targetId: plan.id, detail: { studentId, kind } });
  return plan;
}

export async function getPlan(ctx: FeatureContext, session: any, planId: string) {
  const plan = await ctx.repo.get(PLANS, planId);
  if (!plan) throw notFound('Learning plan not found');
  if (!isAdmin(session) && plan.studentId !== session.userId && plan.coachId !== session.userId) {
    throw forbidden('You are not permitted to view this learning plan');
  }
  return plan;
}
