import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 23 — Facility, Venue & Infrastructure Management (slug: facilities)
 *
 * Tables
 *  - facility_venues        venue directory: capacity, board layout, accessibility, safety, status
 *  - facility_bookings      booking requests and approvals (overlap-checked, SoD-approved)
 *  - facility_maintenance   maintenance windows that block the space
 */

export const VENUES = 'facility_venues';
export const BOOKINGS = 'facility_bookings';
export const MAINTENANCE = 'facility_maintenance';

const VENUE_STATUSES = ['active', 'maintenance', 'closed'];
const BOOKING_STATUSES = ['requested', 'approved', 'rejected', 'cancelled', 'completed'];
/** Bookings in these states still hold the room. */
const HOLDING = ['requested', 'approved'];

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

function iso(value: any, field: string): number {
  const v = need(value, field);
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) throw badRequest(`${field} must be an ISO date`);
  return t;
}

/** Half-open interval overlap: two bookings clash when each starts before the other ends. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function createVenue(
  ctx: FeatureContext,
  actorId: string,
  input: {
    name?: string;
    building?: string;
    room?: string;
    capacity?: number;
    boardCount?: number;
    layout?: any;
    accessibility?: string;
    safetyNotes?: string;
  } = {},
) {
  const name = need(input?.name, 'name');
  const capacity = Number(input?.capacity ?? 0);
  if (!Number.isInteger(capacity) || capacity < 1) throw badRequest('capacity must be a positive integer');
  const boardCount = Number(input?.boardCount ?? 0);
  if (!Number.isInteger(boardCount) || boardCount < 0) throw badRequest('boardCount must be zero or more');

  const venue = await ctx.repo.insert(VENUES, {
    id: ctx.newId(),
    name,
    building: input?.building ?? null,
    room: input?.room ?? null,
    capacity,
    boardCount,
    layout: input?.layout ?? { rows: 0, columns: 0 },
    accessibility: input?.accessibility ?? null,
    safetyNotes: input?.safetyNotes ?? null,
    status: 'active',
    managerId: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'facility.venue.create',
    actorId,
    targetType: 'facility_venue',
    targetId: venue.id,
    detail: { name, capacity, boardCount },
  });
  return venue;
}

export async function listVenues(ctx: FeatureContext, filter: { status?: string } = {}) {
  const q: Row = {};
  if (filter.status) q.status = filter.status;
  return ctx.repo.find(VENUES, q, { orderBy: 'name' });
}

export async function getVenue(ctx: FeatureContext, id: string) {
  const venue = await ctx.repo.get(VENUES, id);
  if (!venue) throw notFound('Venue not found');
  const bookings = await ctx.repo.find(BOOKINGS, { venueId: id }, { orderBy: 'startsAt' });
  const maintenance = await ctx.repo.find(MAINTENANCE, { venueId: id }, { orderBy: 'startsAt' });
  return {
    ...venue,
    available: venue.status === 'active',
    bookings,
    maintenance,
    approvedBookings: bookings.filter((b) => b.status === 'approved').length,
  };
}

export async function setVenueStatus(ctx: FeatureContext, actorId: string, id: string, status: string) {
  const venue = await ctx.repo.get(VENUES, id);
  if (!venue) throw notFound('Venue not found');
  if (!VENUE_STATUSES.includes(status)) throw badRequest(`status must be one of ${VENUE_STATUSES.join(', ')}`);
  const updated = await ctx.repo.update(VENUES, id, { status });
  await ctx.audit.record({
    action: 'facility.venue.status',
    actorId,
    targetType: 'facility_venue',
    targetId: id,
    detail: { from: venue.status, to: status },
  });
  return updated;
}

export async function requestBooking(
  ctx: FeatureContext,
  actorId: string,
  venueId: string,
  input: { startsAt?: string; endsAt?: string; purpose?: string; attendees?: number } = {},
) {
  const venue = await ctx.repo.get(VENUES, venueId);
  if (!venue) throw notFound('Venue not found');
  if (venue.status !== 'active') throw conflict(`Venue is ${venue.status} and cannot be booked`);
  const startsAt = iso(input?.startsAt, 'startsAt');
  const endsAt = iso(input?.endsAt, 'endsAt');
  if (endsAt <= startsAt) throw badRequest('endsAt must be after startsAt');
  const attendees = Number(input?.attendees ?? 0);
  if (!Number.isInteger(attendees) || attendees < 1) throw badRequest('attendees must be a positive integer');
  if (attendees > Number(venue.capacity ?? 0)) {
    throw conflict(`Venue capacity is ${venue.capacity}; ${attendees} attendees requested`, { capacity: venue.capacity });
  }

  const existing = (await ctx.repo.find(BOOKINGS, { venueId })).filter((b) => HOLDING.includes(b.status));
  const clash = existing.find((b) =>
    overlaps(startsAt, endsAt, new Date(b.startsAt).getTime(), new Date(b.endsAt).getTime()),
  );
  if (clash) {
    throw conflict('The venue is already booked for part of that window', {
      conflictingBookingId: clash.id,
      startsAt: clash.startsAt,
      endsAt: clash.endsAt,
    });
  }
  const maintenance = await ctx.repo.find(MAINTENANCE, { venueId });
  const blocked = maintenance.find((m) =>
    overlaps(startsAt, endsAt, new Date(m.startsAt).getTime(), new Date(m.endsAt).getTime()),
  );
  if (blocked) {
    throw conflict('The venue is blocked for maintenance during that window', {
      maintenanceId: blocked.id,
      startsAt: blocked.startsAt,
      endsAt: blocked.endsAt,
    });
  }

  const booking = await ctx.repo.insert(BOOKINGS, {
    id: ctx.newId(),
    venueId,
    requestedBy: actorId,
    purpose: input?.purpose ?? null,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    attendees,
    status: 'requested',
    approvedBy: null,
    decidedAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'facility.booking.request',
    actorId,
    targetType: 'facility_booking',
    targetId: booking.id,
    detail: { venueId, startsAt: booking.startsAt, endsAt: booking.endsAt },
  });
  return booking;
}

export async function listBookings(ctx: FeatureContext, filter: { venueId?: string; status?: string } = {}) {
  const q: Row = {};
  if (filter.venueId) q.venueId = filter.venueId;
  if (filter.status) q.status = filter.status;
  return ctx.repo.find(BOOKINGS, q, { orderBy: 'startsAt' });
}

export async function approveBooking(ctx: FeatureContext, actorId: string, bookingId: string) {
  const booking = await ctx.repo.get(BOOKINGS, bookingId);
  if (!booking) throw notFound('Booking not found');
  if (booking.status !== 'requested') throw conflict(`Booking is ${booking.status} and cannot be approved`);
  assertSeparate(actorId, booking.requestedBy, 'a facility booking');
  const venue = await ctx.repo.get(VENUES, booking.venueId);
  if (!venue) throw notFound('Venue not found');
  if (venue.status === 'closed') throw conflict('Venue is closed');

  const start = new Date(booking.startsAt).getTime();
  const end = new Date(booking.endsAt).getTime();
  const others = (await ctx.repo.find(BOOKINGS, { venueId: booking.venueId, status: 'approved' })).filter(
    (b) => b.id !== booking.id,
  );
  const clash = others.find((b) => overlaps(start, end, new Date(b.startsAt).getTime(), new Date(b.endsAt).getTime()));
  if (clash) throw conflict('Another approved booking overlaps this window', { conflictingBookingId: clash.id });

  const updated = await ctx.repo.update(BOOKINGS, bookingId, { status: 'approved', approvedBy: actorId, decidedAt: ctx.now() });
  await ctx.audit.record({
    action: 'facility.booking.approve',
    actorId,
    targetType: 'facility_booking',
    targetId: bookingId,
    detail: { venueId: booking.venueId, requestedBy: booking.requestedBy },
  });
  return updated;
}

export async function rejectBooking(ctx: FeatureContext, actorId: string, bookingId: string, reason?: string) {
  const booking = await ctx.repo.get(BOOKINGS, bookingId);
  if (!booking) throw notFound('Booking not found');
  if (booking.status !== 'requested') throw conflict(`Booking is ${booking.status} and cannot be rejected`);
  assertSeparate(actorId, booking.requestedBy, 'a facility booking');
  const updated = await ctx.repo.update(BOOKINGS, bookingId, {
    status: 'rejected',
    approvedBy: null,
    decidedBy: actorId,
    decidedAt: ctx.now(),
    decisionReason: reason ?? null,
  });
  await ctx.audit.record({
    action: 'facility.booking.reject',
    actorId,
    targetType: 'facility_booking',
    targetId: bookingId,
    detail: { reason: reason ?? null },
  });
  return updated;
}

export async function cancelBooking(
  ctx: FeatureContext,
  actorId: string,
  bookingId: string,
  reason?: string,
  canApprove = false,
) {
  const booking = await ctx.repo.get(BOOKINGS, bookingId);
  if (!booking) throw notFound('Booking not found');
  if (booking.status === 'cancelled') throw conflict('Booking is already cancelled');
  if (booking.status === 'rejected') throw conflict('A rejected booking cannot be cancelled');
  if (!canApprove && booking.requestedBy !== actorId) {
    throw forbidden('Only the requester or an authorised approver may cancel this booking');
  }
  const updated = await ctx.repo.update(BOOKINGS, bookingId, {
    status: 'cancelled',
    cancelledBy: actorId,
    cancelledAt: ctx.now(),
    cancelReason: reason ?? null,
  });
  await ctx.audit.record({
    action: 'facility.booking.cancel',
    actorId,
    targetType: 'facility_booking',
    targetId: bookingId,
    detail: { reason: reason ?? null, previousStatus: booking.status },
  });
  return updated;
}

/** Maintenance windows block the space: overlapping booking requests are rejected. */
export async function scheduleMaintenance(
  ctx: FeatureContext,
  actorId: string,
  venueId: string,
  input: { startsAt?: string; endsAt?: string; note?: string; blockVenue?: boolean } = {},
) {
  const venue = await ctx.repo.get(VENUES, venueId);
  if (!venue) throw notFound('Venue not found');
  const startsAt = iso(input?.startsAt, 'startsAt');
  const endsAt = iso(input?.endsAt, 'endsAt');
  if (endsAt <= startsAt) throw badRequest('endsAt must be after startsAt');

  const row = await ctx.repo.insert(MAINTENANCE, {
    id: ctx.newId(),
    venueId,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    note: input?.note ?? null,
    status: 'scheduled',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  if (input?.blockVenue) await ctx.repo.update(VENUES, venueId, { status: 'maintenance' });
  await ctx.audit.record({
    action: 'facility.maintenance.schedule',
    actorId,
    targetType: 'facility_venue',
    targetId: venueId,
    detail: { maintenanceId: row.id, startsAt: row.startsAt, endsAt: row.endsAt },
  });
  return row;
}

export async function utilization(ctx: FeatureContext, venueId: string) {
  const venue = await ctx.repo.get(VENUES, venueId);
  if (!venue) throw notFound('Venue not found');
  const bookings = (await ctx.repo.find(BOOKINGS, { venueId, status: 'approved' })).filter((b) => BOOKING_STATUSES.includes(b.status));
  const bookedMinutes = bookings.reduce((sum, b) => {
    const mins = (new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()) / 60000;
    return sum + Math.max(0, Math.round(mins));
  }, 0);
  const peak = bookings.reduce((max, b) => Math.max(max, Number(b.attendees || 0)), 0);
  return {
    venueId,
    capacity: Number(venue.capacity ?? 0),
    approvedBookings: bookings.length,
    bookedMinutes,
    peakAttendees: peak,
    seatUtilizationPct: venue.capacity ? Math.round((peak / Number(venue.capacity)) * 100) : 0,
  };
}

export const FACILITY_VENUE_STATUSES = VENUE_STATUSES;
