/**
 * Feature 16 — Club Events & Activities (slug: `events`)
 *
 * Tables
 *  - club_events         one row per activity (workshop, practice, talk, social, outreach, meeting)
 *  - event_registrations one row per attendee per event; holds registration / waitlist / approval state
 *  - event_invitations   invitation grants for `invitation` mode events
 *
 * Registration modes (per event, configurable):
 *  - `automatic`        register until capacity, then waitlist
 *  - `manual`           every registration waits for organizer approval (a pending row reserves a seat)
 *  - `open_attendance`  free-form attendance, no registration at all
 *  - `invitation`       only invited users may register
 *  - `hybrid`           invitation for the invited list, automatic for everyone else once published
 *
 * Seat-holding statuses are `registered`, `checked_in` and `pending` — the capacity check counts them,
 * so approving a pending registration can never oversell the event.
 */
import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

export const EVENTS = 'club_events';
export const REGS = 'event_registrations';
export const INVITES = 'event_invitations';

export const REGISTRATION_MODES = ['automatic', 'manual', 'open_attendance', 'invitation', 'hybrid'] as const;
export const SEAT_STATUSES = ['registered', 'checked_in', 'pending'];

export interface EventInput {
  title?: string;
  description?: string;
  category?: string;
  hostId?: string;
  eligibility?: string;
  visibility?: string;
  capacity?: number;
  waitlistEnabled?: boolean;
  registrationMode?: string;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  startsAt?: string;
  endsAt?: string;
  venue?: string;
  meetingLink?: string;
  accessibility?: string;
  materials?: string[];
  cancellationPolicy?: string;
  notificationRules?: string[];
}

function iso(v: any, field: string): string | null {
  if (v == null || v === '') return null;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) throw badRequest(`${field} must be an ISO date/time`);
  return new Date(t).toISOString();
}

async function loadEvent(ctx: FeatureContext, id: string): Promise<Row> {
  const ev = await ctx.repo.get(EVENTS, id);
  if (!ev) throw notFound('Event not found');
  return ev;
}

async function seatCount(ctx: FeatureContext, eventId: string): Promise<number> {
  let n = 0;
  for (const s of SEAT_STATUSES) n += await ctx.repo.count(REGS, { eventId, status: s });
  return n;
}

export async function createEvent(ctx: FeatureContext, actorId: string, input: EventInput) {
  const title = (input?.title || '').trim();
  if (!title) throw badRequest('Event title is required');
  const mode = input?.registrationMode || 'automatic';
  if (!REGISTRATION_MODES.includes(mode as any)) {
    throw badRequest(`registrationMode must be one of ${REGISTRATION_MODES.join(', ')}`);
  }
  const capacity = input?.capacity ?? 40;
  if (!Number.isInteger(capacity) || capacity < 1) throw badRequest('capacity must be a positive integer');
  const startsAt = iso(input?.startsAt, 'startsAt');
  const endsAt = iso(input?.endsAt, 'endsAt');
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw badRequest('endsAt must be after startsAt');
  }
  const opensAt = iso(input?.registrationOpensAt, 'registrationOpensAt');
  const closesAt = iso(input?.registrationClosesAt, 'registrationClosesAt');
  if (opensAt && closesAt && new Date(closesAt).getTime() <= new Date(opensAt).getTime()) {
    throw badRequest('registrationClosesAt must be after registrationOpensAt');
  }

  const row = await ctx.repo.insert(EVENTS, {
    id: ctx.newId(),
    title,
    description: input?.description ?? null,
    category: input?.category || 'workshop',
    hostId: input?.hostId ?? actorId,
    eligibility: input?.eligibility ?? 'all_members',
    visibility: input?.visibility || 'members',
    capacity,
    waitlistEnabled: input?.waitlistEnabled !== false,
    registrationMode: mode,
    registrationOpensAt: opensAt,
    registrationClosesAt: closesAt,
    startsAt,
    endsAt,
    venue: input?.venue ?? null,
    meetingLink: input?.meetingLink ?? null,
    accessibility: input?.accessibility ?? null,
    materials: input?.materials ?? [],
    cancellationPolicy: input?.cancellationPolicy ?? null,
    notificationRules: input?.notificationRules ?? [],
    status: 'draft',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'event.create', actorId, targetType: 'event', targetId: row.id, detail: { title, registrationMode: mode } });
  return row;
}

export async function publishEvent(ctx: FeatureContext, actorId: string, id: string) {
  const ev = await loadEvent(ctx, id);
  if (ev.status !== 'draft') throw conflict(`Only a draft event can be published (current: ${ev.status})`);
  const row = await ctx.repo.update(EVENTS, id, { status: 'published', publishedAt: ctx.now(), publishedBy: actorId });
  await ctx.audit.record({ action: 'event.publish', actorId, targetType: 'event', targetId: id });
  return row;
}

export async function cancelEvent(ctx: FeatureContext, actorId: string, id: string, reason?: string) {
  const ev = await loadEvent(ctx, id);
  if (ev.status === 'cancelled') throw conflict('Event is already cancelled');
  if (ev.status === 'completed') throw conflict('A completed event cannot be cancelled');
  const row = await ctx.repo.update(EVENTS, id, { status: 'cancelled', cancelledAt: ctx.now(), cancellationReason: reason ?? null });
  const regs = await ctx.repo.find(REGS, { eventId: id });
  for (const r of regs) {
    if (r.status !== 'withdrawn') await ctx.repo.update(REGS, r.id, { status: 'withdrawn', withdrawnAt: ctx.now(), withdrawnReason: 'event_cancelled' });
  }
  await ctx.audit.record({ action: 'event.cancel', actorId, targetType: 'event', targetId: id, detail: { reason: reason ?? null, notified: regs.length } });
  return { ...row, notifiedAttendees: regs.length };
}

export async function inviteToEvent(ctx: FeatureContext, actorId: string, eventId: string, userId: string) {
  const ev = await loadEvent(ctx, eventId);
  if (ev.registrationMode !== 'invitation' && ev.registrationMode !== 'hybrid') {
    throw conflict('This event does not use invitation-based registration');
  }
  if (!userId) throw badRequest('userId is required');
  const existing = await ctx.repo.findOne(INVITES, { eventId, userId });
  if (existing) throw conflict('User is already invited to this event');
  const row = await ctx.repo.insert(INVITES, { id: ctx.newId(), eventId, userId, invitedBy: actorId, status: 'active', createdAt: ctx.now() });
  await ctx.audit.record({ action: 'event.invite', actorId, targetType: 'event_invitation', targetId: row.id, detail: { eventId, userId } });
  return row;
}

export async function registerForEvent(
  ctx: FeatureContext,
  actorId: string,
  eventId: string,
  opts: { playerId?: string; manual?: boolean } = {},
) {
  const ev = await loadEvent(ctx, eventId);
  if (ev.status === 'draft') throw conflict('Event is not published yet');
  if (ev.status === 'cancelled') throw conflict('Event has been cancelled');
  if (ev.status === 'completed') throw conflict('Event has already taken place');

  const userId = opts.playerId || actorId;
  const mode = ev.registrationMode || 'automatic';
  if (mode === 'open_attendance') throw conflict('This event uses free-form attendance; registration is not required');

  if (mode === 'invitation') {
    const inv = await ctx.repo.findOne(INVITES, { eventId, userId });
    if (!inv || inv.status !== 'active') throw forbidden('This event is invitation only');
  }

  if (!opts.manual) {
    const now = new Date(ctx.now()).getTime();
    if (ev.registrationOpensAt && now < new Date(ev.registrationOpensAt).getTime()) throw conflict('Registration has not opened yet');
    if (ev.registrationClosesAt && now > new Date(ev.registrationClosesAt).getTime()) throw conflict('Registration has closed');
  }

  const existing = await ctx.repo.findOne(REGS, { eventId, userId });
  if (existing && existing.status !== 'withdrawn' && existing.status !== 'rejected') {
    throw conflict('You are already registered for this event');
  }

  const seats = await seatCount(ctx, eventId);
  const full = seats >= (ev.capacity ?? 40);
  let status = mode === 'manual' ? 'pending' : 'registered';
  if (full) {
    if (ev.waitlistEnabled === false) throw conflict('Event is at capacity and the waitlist is disabled');
    status = 'waitlisted';
  }
  const waitlisted = status === 'waitlisted' ? await ctx.repo.count(REGS, { eventId, status: 'waitlisted' }) : 0;

  const row = existing
    ? await ctx.repo.update(REGS, existing.id, {
        status,
        waitlistPosition: status === 'waitlisted' ? waitlisted + 1 : null,
        registeredAt: ctx.now(),
        withdrawnAt: null,
        withdrawnReason: null,
      })
    : await ctx.repo.insert(REGS, {
        id: ctx.newId(),
        eventId,
        userId,
        status,
        waitlistPosition: status === 'waitlisted' ? waitlisted + 1 : null,
        addedManually: !!opts.manual,
        registeredBy: actorId,
        registeredAt: ctx.now(),
      });
  await ctx.audit.record({
    action: 'event.registration.create',
    actorId,
    targetType: 'event_registration',
    targetId: row.id,
    detail: { eventId, userId, status, mode },
  });
  return row;
}

/** Promotes the earliest waitlisted registration into a confirmed seat, if one is free. */
export async function promoteWaitlist(ctx: FeatureContext, actorId: string, eventId: string) {
  const ev = await loadEvent(ctx, eventId);
  const seats = await seatCount(ctx, eventId);
  if (seats >= (ev.capacity ?? 40)) return { promoted: null, reason: 'capacity_full' as const };
  const waiting = await ctx.repo.find(REGS, { eventId, status: 'waitlisted' }, { orderBy: 'waitlistPosition' });
  if (!waiting.length) return { promoted: null, reason: 'no_waitlist' as const };
  const next = waiting[0];
  const promoted = await ctx.repo.update(REGS, next.id, {
    status: ev.registrationMode === 'manual' ? 'pending' : 'registered',
    waitlistPosition: null,
    promotedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'event.waitlist.promote',
    actorId,
    targetType: 'event_registration',
    targetId: next.id,
    detail: { eventId, userId: next.userId },
  });
  return { promoted, reason: 'promoted' as const };
}

export async function withdrawFromEvent(ctx: FeatureContext, actorId: string, eventId: string, userId: string, reason?: string) {
  await loadEvent(ctx, eventId);
  const reg = await ctx.repo.findOne(REGS, { eventId, userId });
  if (!reg) throw notFound('Registration not found');
  if (reg.status === 'withdrawn') throw conflict('Registration is already withdrawn');
  const row = await ctx.repo.update(REGS, reg.id, {
    status: 'withdrawn',
    waitlistPosition: null,
    withdrawnAt: ctx.now(),
    withdrawnReason: reason ?? 'withdrawn_by_attendee',
  });
  await ctx.audit.record({ action: 'event.registration.withdraw', actorId, targetType: 'event_registration', targetId: reg.id, detail: { eventId, userId } });
  const promotion = await promoteWaitlist(ctx, actorId, eventId);
  return { registration: row, promotion };
}

export async function decideRegistration(
  ctx: FeatureContext,
  actorId: string,
  eventId: string,
  regId: string,
  decision: 'approve' | 'reject',
) {
  await loadEvent(ctx, eventId);
  const reg = await ctx.repo.get(REGS, regId);
  if (!reg || reg.eventId !== eventId) throw notFound('Registration not found');
  if (reg.status !== 'pending') throw conflict(`Only a pending registration can be ${decision}d (current: ${reg.status})`);
  const status = decision === 'approve' ? 'registered' : 'rejected';
  const row = await ctx.repo.update(REGS, regId, { status, decidedBy: actorId, decidedAt: ctx.now() });
  await ctx.audit.record({
    action: decision === 'approve' ? 'event.registration.approve' : 'event.registration.reject',
    actorId,
    targetType: 'event_registration',
    targetId: regId,
    detail: { eventId },
  });
  if (decision === 'reject') await promoteWaitlist(ctx, actorId, eventId);
  return row;
}

export async function checkIn(ctx: FeatureContext, actorId: string, eventId: string, regId: string) {
  await loadEvent(ctx, eventId);
  const reg = await ctx.repo.get(REGS, regId);
  if (!reg || reg.eventId !== eventId) throw notFound('Registration not found');
  if (reg.status !== 'registered') throw conflict(`Only a confirmed registration can be checked in (current: ${reg.status})`);
  const row = await ctx.repo.update(REGS, regId, { status: 'checked_in', checkedInAt: ctx.now(), checkedInBy: actorId });
  await ctx.audit.record({ action: 'event.checkin', actorId, targetType: 'event_registration', targetId: regId, detail: { eventId } });
  return row;
}

export async function closeEvent(ctx: FeatureContext, actorId: string, eventId: string, report?: string) {
  const ev = await loadEvent(ctx, eventId);
  if (ev.status !== 'published') throw conflict(`Only a published event can be closed (current: ${ev.status})`);
  const regs = await ctx.repo.find(REGS, { eventId });
  const attended = regs.filter((r) => r.status === 'checked_in').length;
  const row = await ctx.repo.update(EVENTS, eventId, {
    status: 'completed',
    completedAt: ctx.now(),
    attendanceCount: attended,
    postEventReport: report ?? null,
  });
  await ctx.audit.record({ action: 'event.close', actorId, targetType: 'event', targetId: eventId, detail: { attended } });
  return row;
}

export async function listEvents(ctx: FeatureContext, filter: { status?: string; category?: string; limit?: number; offset?: number } = {}) {
  const where: Row = {};
  if (filter.status) where.status = filter.status;
  if (filter.category) where.category = filter.category;
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const items = await ctx.repo.find(EVENTS, where, { limit, offset, orderBy: 'createdAt', desc: true });
  const total = await ctx.repo.count(EVENTS, where);
  return { items, total, limit, offset };
}

export async function getEvent(ctx: FeatureContext, id: string) {
  const ev = await loadEvent(ctx, id);
  const registrations = await ctx.repo.find(REGS, { eventId: id }, { orderBy: 'registeredAt' });
  const seats = registrations.filter((r) => SEAT_STATUSES.includes(r.status)).length;
  return {
    ...ev,
    registrations,
    seatsTaken: seats,
    seatsAvailable: Math.max(0, (ev.capacity ?? 40) - seats),
    waitlistCount: registrations.filter((r) => r.status === 'waitlisted').length,
    checkedInCount: registrations.filter((r) => r.status === 'checked_in').length,
  };
}

export async function myRegistrations(ctx: FeatureContext, userId: string) {
  return ctx.repo.find(REGS, { userId }, { orderBy: 'registeredAt', desc: true });
}
