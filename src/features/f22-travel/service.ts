import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 22 — Transport & Travel Management (slug: travel)
 *
 * Tables
 *  - travel_trips        one row per travel request/trip (explicit approval state, no payment fields)
 *  - travel_passengers   participant manifest, one row per traveller with its own status + seat
 *  - travel_notices      per-participant change notices (itinerary/contact changes)
 *
 * Deliberate omissions (spec safeguards): the platform never books or pays. Trip rows carry
 * `paymentProcessed: false` and `externalBookingRequired: true`; there is no payment endpoint.
 */

export const TRIPS = 'travel_trips';
export const PASSENGERS = 'travel_passengers';
export const NOTICES = 'travel_notices';

const TRIP_STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'completed', 'cancelled'];
const PASSENGER_STATUSES = ['invited', 'confirmed', 'declined', 'cancelled'];

function assertSeparate(actorId: string, ownerId: string, what: string) {
  try {
    assertNotSelfApproval(actorId, ownerId, what);
  } catch {
    throw forbidden(`Separation of duties: you cannot approve ${what} you raised`);
  }
}

function need(value: any, field: string): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw badRequest(`${field} is required`);
  return v;
}

function isoOrThrow(value: any, field: string): string {
  const v = need(value, field);
  if (Number.isNaN(new Date(v).getTime())) throw badRequest(`${field} must be an ISO date`);
  return v;
}

export async function createTrip(
  ctx: FeatureContext,
  actorId: string,
  input: {
    title?: string;
    destination?: string;
    purpose?: string;
    startsAt?: string;
    endsAt?: string;
    seatCapacity?: number;
    transportOptions?: any[];
    accommodationNote?: string;
  } = {},
) {
  const title = need(input?.title, 'title');
  const destination = need(input?.destination, 'destination');
  const startsAt = isoOrThrow(input?.startsAt, 'startsAt');
  const endsAt = isoOrThrow(input?.endsAt, 'endsAt');
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw badRequest('endsAt must be after startsAt');
  const seatCapacity = Number(input?.seatCapacity ?? 1);
  if (!Number.isInteger(seatCapacity) || seatCapacity < 1) throw badRequest('seatCapacity must be a positive integer');

  const trip = await ctx.repo.insert(TRIPS, {
    id: ctx.newId(),
    title,
    destination,
    purpose: input?.purpose ?? null,
    startsAt,
    endsAt,
    seatCapacity,
    transportOptions: input?.transportOptions ?? [],
    accommodationNote: input?.accommodationNote ?? null,
    itinerary: [],
    status: 'draft',
    requestedBy: actorId,
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    completedAt: null,
    paymentProcessed: false,
    externalBookingRequired: true,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'travel.trip.create',
    actorId,
    targetType: 'travel_trip',
    targetId: trip.id,
    detail: { title, destination, seatCapacity },
  });
  return trip;
}

export async function listTrips(ctx: FeatureContext, filter: { status?: string } = {}) {
  const q: Row = {};
  if (filter.status) q.status = filter.status;
  return ctx.repo.find(TRIPS, q, { orderBy: 'startsAt' });
}

async function participantsOf(ctx: FeatureContext, tripId: string) {
  return ctx.repo.find(PASSENGERS, { tripId }, { orderBy: 'createdAt' });
}

function redactPassenger(p: Row, actorId: string, official: boolean) {
  const isSelf = p.userId === actorId;
  return {
    ...p,
    // emergency contacts are access-restricted: officials and the traveller themselves only
    emergencyContact: official || isSelf ? p.emergencyContact ?? null : null,
    personalNotes: official || isSelf ? p.personalNotes ?? null : null,
  };
}

export async function getTrip(ctx: FeatureContext, id: string, actorId: string, official: boolean) {
  const trip = await ctx.repo.get(TRIPS, id);
  if (!trip) throw notFound('Trip not found');
  const participants = await participantsOf(ctx, id);
  const isParticipant = participants.some((p) => p.userId === actorId);
  if (!official && !isParticipant && trip.status !== 'approved' && trip.status !== 'completed') {
    throw forbidden('Trip details are restricted to participants and authorised officials');
  }
  const confirmed = participants.filter((p) => p.status === 'confirmed');
  const detail: Row = {
    ...trip,
    participants: participants.map((p) => redactPassenger(p, actorId, official)),
    counts: {
      seatCapacity: Number(trip.seatCapacity ?? 0),
      confirmed: confirmed.length,
      invited: participants.filter((p) => p.status === 'invited').length,
      remainingSeats: Math.max(0, Number(trip.seatCapacity ?? 0) - confirmed.length),
    },
  };
  // itinerary is restricted to participants and officials
  if (!official && !isParticipant) detail.itinerary = [];
  return detail;
}

export async function submitTrip(ctx: FeatureContext, actorId: string, id: string) {
  const trip = await ctx.repo.get(TRIPS, id);
  if (!trip) throw notFound('Trip not found');
  if (trip.status !== 'draft') throw conflict(`Cannot submit a trip in status ${trip.status}`);
  const updated = await ctx.repo.update(TRIPS, id, { status: 'pending_approval', submittedAt: ctx.now(), submittedBy: actorId });
  await ctx.audit.record({ action: 'travel.trip.submit', actorId, targetType: 'travel_trip', targetId: id });
  return updated;
}

export async function decideTrip(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  decision: 'approve' | 'reject',
  reason?: string,
) {
  const trip = await ctx.repo.get(TRIPS, id);
  if (!trip) throw notFound('Trip not found');
  if (trip.status !== 'pending_approval') throw conflict(`Trip is ${trip.status}, not awaiting approval`);
  assertSeparate(actorId, trip.requestedBy, 'a travel request');
  if (decision === 'reject' && !String(reason || '').trim()) throw badRequest('A rejection reason is required');
  const updated = await ctx.repo.update(TRIPS, id, {
    status: decision === 'approve' ? 'approved' : 'rejected',
    approvedBy: decision === 'approve' ? actorId : null,
    approvedAt: decision === 'approve' ? ctx.now() : null,
    rejectedBy: decision === 'reject' ? actorId : null,
    rejectionReason: decision === 'reject' ? String(reason).trim() : null,
  });
  await ctx.audit.record({
    action: `travel.trip.${decision}`,
    actorId,
    targetType: 'travel_trip',
    targetId: id,
    detail: { requestedBy: trip.requestedBy, reason: reason ?? null },
  });
  return updated;
}

export async function addPassenger(
  ctx: FeatureContext,
  actorId: string,
  tripId: string,
  input: { userId?: string; emergencyContact?: string; personalNotes?: string } = {},
) {
  const trip = await ctx.repo.get(TRIPS, tripId);
  if (!trip) throw notFound('Trip not found');
  if (['completed', 'cancelled', 'rejected'].includes(trip.status)) {
    throw conflict(`Cannot add participants to a ${trip.status} trip`);
  }
  const userId = input?.userId ? String(input.userId) : actorId;
  const existing = await ctx.repo.findOne(PASSENGERS, { tripId, userId });
  if (existing && existing.status !== 'cancelled' && existing.status !== 'declined') {
    throw conflict('Traveller is already on this trip manifest');
  }
  const row = existing
    ? await ctx.repo.update(PASSENGERS, existing.id, {
        status: 'invited',
        seatNo: null,
        emergencyContact: input?.emergencyContact ?? existing.emergencyContact ?? null,
        personalNotes: input?.personalNotes ?? existing.personalNotes ?? null,
      })
    : await ctx.repo.insert(PASSENGERS, {
        id: ctx.newId(),
        tripId,
        userId,
        status: 'invited',
        seatNo: null,
        emergencyContact: input?.emergencyContact ?? null,
        personalNotes: input?.personalNotes ?? null,
        addedBy: actorId,
        confirmedAt: null,
        createdAt: ctx.now(),
      });
  await ctx.audit.record({
    action: 'travel.passenger.add',
    actorId,
    targetType: 'travel_trip',
    targetId: tripId,
    detail: { passengerId: row.id, userId },
  });
  return row;
}

/** Participant confirms their seat. Seat capacity is enforced here and can never be exceeded. */
export async function confirmPassenger(
  ctx: FeatureContext,
  actorId: string,
  tripId: string,
  passengerId: string,
  official = false,
) {
  const trip = await ctx.repo.get(TRIPS, tripId);
  if (!trip) throw notFound('Trip not found');
  if (trip.status === 'rejected' || trip.status === 'cancelled') throw conflict(`Trip is ${trip.status}`);
  const passenger = await ctx.repo.get(PASSENGERS, passengerId);
  if (!passenger || passenger.tripId !== tripId) throw notFound('Passenger not found on this trip');
  if (!official && passenger.userId !== actorId) {
    throw forbidden('Only the traveller or an authorised official may confirm this seat');
  }
  if (passenger.status === 'confirmed') throw conflict('Traveller has already confirmed');
  if (!PASSENGER_STATUSES.includes(passenger.status)) throw conflict(`Unknown passenger status ${passenger.status}`);

  const confirmed = (await participantsOf(ctx, tripId)).filter((p) => p.status === 'confirmed');
  const capacity = Number(trip.seatCapacity ?? 0);
  if (confirmed.length >= capacity) {
    throw conflict(`Trip is full: ${capacity} seat(s) confirmed`, { capacity, confirmed: confirmed.length });
  }
  const updated = await ctx.repo.update(PASSENGERS, passengerId, {
    status: 'confirmed',
    seatNo: confirmed.length + 1,
    confirmedAt: ctx.now(),
    confirmedBy: actorId,
  });
  await ctx.audit.record({
    action: 'travel.passenger.confirm',
    actorId,
    targetType: 'travel_trip',
    targetId: tripId,
    detail: { passengerId, seatNo: confirmed.length + 1 },
  });
  return updated;
}

/** Decline / cancel a seat and notify the affected participant. */
export async function setPassengerStatus(
  ctx: FeatureContext,
  actorId: string,
  tripId: string,
  passengerId: string,
  status: 'declined' | 'cancelled',
  reason?: string,
  official = false,
) {
  if (status !== 'declined' && status !== 'cancelled') throw badRequest("status must be 'declined' or 'cancelled'");
  const trip = await ctx.repo.get(TRIPS, tripId);
  if (!trip) throw notFound('Trip not found');
  const passenger = await ctx.repo.get(PASSENGERS, passengerId);
  if (!passenger || passenger.tripId !== tripId) throw notFound('Passenger not found on this trip');
  if (!official && passenger.userId !== actorId) {
    throw forbidden('Only the traveller or an authorised official may change this seat');
  }
  const updated = await ctx.repo.update(PASSENGERS, passengerId, {
    status,
    seatNo: null,
    withdrawnAt: ctx.now(),
    withdrawalReason: reason ?? null,
  });
  const notice = await ctx.repo.insert(NOTICES, {
    id: ctx.newId(),
    tripId,
    userId: passenger.userId,
    kind: `passenger_${status}`,
    message: reason ? `Your travel booking was ${status}: ${reason}` : `Your travel booking was ${status}`,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: `travel.passenger.${status}`,
    actorId,
    targetType: 'travel_trip',
    targetId: tripId,
    detail: { passengerId, noticeId: notice.id },
  });
  return { passenger: updated, notice };
}

/** Manifest: participant + authorised-official access only. */
export async function manifest(ctx: FeatureContext, tripId: string, actorId: string, official: boolean) {
  const trip = await ctx.repo.get(TRIPS, tripId);
  if (!trip) throw notFound('Trip not found');
  const participants = await participantsOf(ctx, tripId);
  const isParticipant = participants.some((p) => p.userId === actorId);
  if (!official && !isParticipant) throw forbidden('The trip manifest is restricted to participants and authorised officials');
  const confirmed = participants.filter((p) => p.status === 'confirmed');
  const capacity = Number(trip.seatCapacity ?? 0);
  return {
    tripId,
    seatCapacity: capacity,
    confirmed: confirmed.length,
    invited: participants.filter((p) => p.status === 'invited').length,
    remainingSeats: Math.max(0, capacity - confirmed.length),
    full: confirmed.length >= capacity,
    passengers: participants.map((p) => redactPassenger(p, actorId, official)),
  };
}

export async function addNotice(ctx: FeatureContext, actorId: string, tripId: string, input: { message?: string; kind?: string } = {}) {
  const trip = await ctx.repo.get(TRIPS, tripId);
  if (!trip) throw notFound('Trip not found');
  const message = need(input?.message, 'message');
  const participants = (await participantsOf(ctx, tripId)).filter((p) => p.status === 'confirmed' || p.status === 'invited');
  const created: Row[] = [];
  for (const p of participants) {
    created.push(
      await ctx.repo.insert(NOTICES, {
        id: ctx.newId(),
        tripId,
        userId: p.userId,
        kind: input?.kind || 'travel_notice',
        message,
        createdBy: actorId,
        createdAt: ctx.now(),
      }),
    );
  }
  await ctx.audit.record({
    action: 'travel.notice.publish',
    actorId,
    targetType: 'travel_trip',
    targetId: tripId,
    detail: { recipients: created.length, message },
  });
  return { tripId, notified: created.length, notices: created };
}

export async function listNotices(ctx: FeatureContext, tripId: string, actorId: string, official: boolean) {
  const trip = await ctx.repo.get(TRIPS, tripId);
  if (!trip) throw notFound('Trip not found');
  const participants = await participantsOf(ctx, tripId);
  const isParticipant = participants.some((p) => p.userId === actorId);
  if (!official && !isParticipant) throw forbidden('Travel notices are restricted to participants and authorised officials');
  const all = await ctx.repo.find(NOTICES, { tripId }, { orderBy: 'createdAt', desc: true });
  return official ? all : all.filter((n) => n.userId === actorId);
}

export async function completeTrip(ctx: FeatureContext, actorId: string, id: string, input: { report?: string } = {}) {
  const trip = await ctx.repo.get(TRIPS, id);
  if (!trip) throw notFound('Trip not found');
  if (trip.status !== 'approved') throw conflict(`Only an approved trip can be completed (current: ${trip.status})`);
  const updated = await ctx.repo.update(TRIPS, id, {
    status: 'completed',
    completedAt: ctx.now(),
    completedBy: actorId,
    postTripReport: input?.report ?? null,
  });
  await ctx.audit.record({ action: 'travel.trip.complete', actorId, targetType: 'travel_trip', targetId: id });
  return updated;
}

export const TRAVEL_TRIP_STATUSES = TRIP_STATUSES;
