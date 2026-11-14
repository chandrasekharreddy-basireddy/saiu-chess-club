/**
 * Feature 17 — Calendar & Academic Year Management (slug: `calendar`)
 *
 * Tables
 *  - academic_years    one row per *version* of an academic year / semester definition
 *  - calendar_entries  one row per calendar item (club event, tournament, coaching, meeting, deadline, milestone)
 *
 * Rules implemented
 *  - all timestamps are stored in UTC (ISO strings); rendering happens in the entry's timezone
 *  - academic years are versioned: a revision inserts a new row with version+1 and marks the previous
 *    row `superseded`, so boundaries are never silently rewritten
 *  - academic-year boundaries must be approved by an authorised official other than the proposer
 *  - two entries may never overlap on the same venue (hard 409); the same person overlapping is a
 *    soft warning that is surfaced on the row and at approval time
 *  - recurring entries declare exceptions; each occurrence is conflict-checked individually
 */
import type { FeatureContext, Row } from '../../core/types.js';
import { assertNotSelfApproval } from '../../core/permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

export const YEARS = 'academic_years';
export const ENTRIES = 'calendar_entries';
export const DEFAULT_TZ = 'Asia/Kolkata';

function sod(actorId: string, ownerId: string, what: string) {
  try {
    assertNotSelfApproval(actorId, ownerId, what);
  } catch (e: any) {
    throw forbidden(e?.message || `Separation of duties: you cannot approve ${what} you raised`);
  }
}

function iso(v: any, field: string): string {
  const t = new Date(v).getTime();
  if (v == null || v === '' || Number.isNaN(t)) throw badRequest(`${field} must be an ISO date/time`);
  return new Date(t).toISOString();
}

function isoOrNull(v: any, field: string): string | null {
  if (v == null || v === '') return null;
  return iso(v, field);
}

/** Renders a stored UTC instant as local wall-clock time in `timeZone`. */
export function toLocal(utcIso: string, timeZone: string = DEFAULT_TZ) {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) throw badRequest('Invalid timestamp');
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(d);
  } catch {
    throw badRequest(`Unknown timezone: ${timeZone}`);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const time = `${hour}:${get('minute')}`;
  const wall = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Number(hour), Number(get('minute')), Number(get('second')));
  return {
    utc: d.toISOString(),
    timeZone,
    date,
    time,
    local: `${date}T${time}`,
    offsetMinutes: Math.round((wall - d.getTime()) / 60000),
  };
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  if ([as, ae, bs, be].some((n) => Number.isNaN(n))) return false;
  return as < be && bs < ae;
}

/* ------------------------------------------------------------------ academic years */

export async function createAcademicYear(
  ctx: FeatureContext,
  actorId: string,
  input: { name?: string; startsAt?: string; endsAt?: string; kind?: string },
) {
  const name = (input?.name || '').trim();
  if (!name) throw badRequest('Academic year name is required');
  const startsAt = iso(input?.startsAt, 'startsAt');
  const endsAt = iso(input?.endsAt, 'endsAt');
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw badRequest('endsAt must be after startsAt');
  const kind = input?.kind || 'academic_year';
  if (!['academic_year', 'semester'].includes(kind)) throw badRequest('kind must be academic_year or semester');

  const row = await ctx.repo.insert(YEARS, {
    id: ctx.newId(),
    name,
    kind,
    startsAt,
    endsAt,
    version: 1,
    status: 'proposed',
    supersedesId: null,
    proposedBy: actorId,
    approvedBy: null,
    approvedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'calendar.academic_year.propose', actorId, targetType: 'academic_year', targetId: row.id, detail: { name, version: 1 } });
  return row;
}

export async function approveAcademicYear(ctx: FeatureContext, actorId: string, id: string) {
  const y = await ctx.repo.get(YEARS, id);
  if (!y) throw notFound('Academic year not found');
  if (y.status !== 'proposed') throw conflict(`Only a proposed academic year can be approved (current: ${y.status})`);
  sod(actorId, y.proposedBy, 'an academic-year definition');
  const row = await ctx.repo.update(YEARS, id, { status: 'approved', approvedBy: actorId, approvedAt: ctx.now() });
  await ctx.audit.record({ action: 'calendar.academic_year.approve', actorId, targetType: 'academic_year', targetId: id, detail: { version: y.version } });
  return row;
}

/** A revision never rewrites history: it supersedes the old row with a new version that needs approval again. */
export async function reviseAcademicYear(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: { startsAt?: string; endsAt?: string; name?: string },
) {
  const y = await ctx.repo.get(YEARS, id);
  if (!y) throw notFound('Academic year not found');
  const startsAt = input?.startsAt ? iso(input.startsAt, 'startsAt') : y.startsAt;
  const endsAt = input?.endsAt ? iso(input.endsAt, 'endsAt') : y.endsAt;
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw badRequest('endsAt must be after startsAt');

  const next = await ctx.repo.insert(YEARS, {
    id: ctx.newId(),
    name: input?.name?.trim() || y.name,
    kind: y.kind,
    startsAt,
    endsAt,
    version: (y.version || 1) + 1,
    status: 'proposed',
    supersedesId: y.id,
    proposedBy: actorId,
    approvedBy: null,
    approvedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.repo.update(YEARS, id, { status: 'superseded', supersededById: next.id, supersededAt: ctx.now() });
  await ctx.audit.record({
    action: 'calendar.academic_year.revise',
    actorId,
    targetType: 'academic_year',
    targetId: next.id,
    detail: { supersedes: y.id, version: next.version },
  });
  return next;
}

export async function listAcademicYears(ctx: FeatureContext, filter: { status?: string } = {}) {
  const where: Row = filter.status ? { status: filter.status } : {};
  return ctx.repo.find(YEARS, where, { orderBy: 'createdAt', desc: true });
}

/** The approved academic year containing `at` (latest version wins). */
export async function currentAcademicYear(ctx: FeatureContext, at?: string) {
  const instant = at ? new Date(iso(at, 'at')).getTime() : new Date(ctx.now()).getTime();
  const approved = await ctx.repo.find(YEARS, { status: 'approved' });
  const hits = approved
    .filter((y) => new Date(y.startsAt).getTime() <= instant && instant <= new Date(y.endsAt).getTime())
    .sort((a, b) => (b.version || 0) - (a.version || 0));
  return hits[0] || null;
}

/** Academic-year boundaries decide who counts as a member of the current season. */
export async function seasonMembership(ctx: FeatureContext, userId: string, at?: string) {
  if (!userId) throw badRequest('userId is required');
  const user = await ctx.repo.get('users', userId);
  if (!user) throw notFound('User not found');
  const year = await currentAcademicYear(ctx, at);
  if (!year) {
    return { userId, academicYearId: null, academicYear: null, isSeasonMember: false, reason: 'no_approved_academic_year', joinedAt: user.createdAt ?? null };
  }
  const joinedAt = user.joinedAt || user.createdAt;
  const t = new Date(joinedAt).getTime();
  const within = t >= new Date(year.startsAt).getTime() && t <= new Date(year.endsAt).getTime();
  return {
    userId,
    academicYearId: year.id,
    academicYear: year.name,
    academicYearVersion: year.version,
    startsAt: year.startsAt,
    endsAt: year.endsAt,
    joinedAt,
    isSeasonMember: within,
    reason: within ? 'joined_within_academic_year' : 'joined_outside_academic_year',
  };
}

/* ------------------------------------------------------------------ entries */

async function conflictsFor(
  ctx: FeatureContext,
  e: { startsAt: string; endsAt: string; venueId?: string | null; hostId?: string | null; excludeId?: string },
) {
  const all = await ctx.repo.find(ENTRIES, {});
  const live = all.filter((x) => x.id !== e.excludeId && x.status !== 'cancelled');
  const clash = live.filter((x) => overlaps(e.startsAt, e.endsAt, x.startsAt, x.endsAt));
  const venue = e.venueId ? clash.filter((x) => x.venueId === e.venueId) : [];
  const people = e.hostId ? clash.filter((x) => x.hostId === e.hostId) : [];
  const brief = (rows: Row[]) => rows.map((x) => ({ id: x.id, title: x.title, startsAt: x.startsAt, endsAt: x.endsAt, venueId: x.venueId ?? null }));
  return { venue: brief(venue), people: brief(people) };
}

function expandRecurrence(input: any, startsAt: string, endsAt: string) {
  const rec = input?.recurrence;
  if (!rec) return [{ startsAt, endsAt }];
  const freq = rec.frequency || 'weekly';
  if (!['daily', 'weekly'].includes(freq)) throw badRequest('recurrence.frequency must be daily or weekly');
  const count = rec.count ?? 4;
  if (!Number.isInteger(count) || count < 1 || count > 52) throw badRequest('recurrence.count must be between 1 and 52');
  const exceptions: string[] = (rec.exceptions || []).map((x: string) => new Date(x).toISOString());
  const stepMs = (freq === 'daily' ? 1 : 7) * 24 * 3600 * 1000;
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  const untilMs = rec.until ? new Date(rec.until).getTime() : null;
  const out: Array<{ startsAt: string; endsAt: string }> = [];
  for (let i = 0; i < count; i++) {
    const s = startMs + i * stepMs;
    if (untilMs != null && s > untilMs) break;
    if (exceptions.includes(new Date(s).toISOString())) continue;
    out.push({ startsAt: new Date(s).toISOString(), endsAt: new Date(s + (endMs - startMs)).toISOString() });
  }
  return out;
}

export async function createEntry(
  ctx: FeatureContext,
  actorId: string,
  input: {
    title?: string;
    type?: string;
    source?: string;
    startsAt?: string;
    endsAt?: string;
    timezone?: string;
    venueId?: string;
    hostId?: string;
    audience?: string[];
    recurrence?: any;
  },
) {
  const title = (input?.title || '').trim();
  if (!title) throw badRequest('Entry title is required');
  const startsAt = iso(input?.startsAt, 'startsAt');
  const endsAt = iso(input?.endsAt, 'endsAt');
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw badRequest('endsAt must be after startsAt');
  const timezone = input?.timezone || DEFAULT_TZ;
  toLocal(startsAt, timezone); // validates the timezone

  const occurrences = expandRecurrence(input, startsAt, endsAt);
  if (!occurrences.length) throw badRequest('The recurrence produced no occurrences (all dates are exceptions)');
  const seriesId = occurrences.length > 1 ? ctx.newId() : null;
  const year = await currentAcademicYear(ctx, startsAt);
  const created: Row[] = [];

  for (const occ of occurrences) {
    const clash = await conflictsFor(ctx, { startsAt: occ.startsAt, endsAt: occ.endsAt, venueId: input?.venueId, hostId: input?.hostId });
    if (clash.venue.length) {
      throw conflict(
        `Venue is already booked for that window (${clash.venue[0].title})`,
        { kind: 'venue', conflicts: clash.venue },
      );
    }
    const row = await ctx.repo.insert(ENTRIES, {
      id: ctx.newId(),
      seriesId,
      title,
      type: input?.type || 'club_event',
      source: input?.source || 'calendar',
      startsAt: occ.startsAt,
      endsAt: occ.endsAt,
      timezone,
      venueId: input?.venueId ?? null,
      hostId: input?.hostId ?? actorId,
      audience: input?.audience ?? ['members'],
      academicYearId: year?.id ?? null,
      status: 'draft',
      conflictWarnings: clash.people.map((p) => ({ kind: 'person', ...p })),
      createdBy: actorId,
      createdAt: ctx.now(),
    });
    created.push(row);
  }

  await ctx.audit.record({
    action: 'calendar.entry.create',
    actorId,
    targetType: 'calendar_entry',
    targetId: created[0].id,
    detail: { title, occurrences: created.length, seriesId },
  });
  return created.length === 1 ? { ...created[0], occurrences: 1 } : { seriesId, occurrences: created.length, items: created };
}

export async function approveEntry(ctx: FeatureContext, actorId: string, id: string) {
  const e = await ctx.repo.get(ENTRIES, id);
  if (!e) throw notFound('Calendar entry not found');
  if (e.status !== 'draft') throw conflict(`Only a draft entry can be approved (current: ${e.status})`);
  sod(actorId, e.createdBy, 'a calendar entry');
  const clash = await conflictsFor(ctx, { startsAt: e.startsAt, endsAt: e.endsAt, venueId: e.venueId, hostId: e.hostId, excludeId: e.id });
  if (clash.venue.length) {
    throw conflict(`Venue conflict detected before approval (${clash.venue[0].title})`, { kind: 'venue', conflicts: clash.venue });
  }
  const row = await ctx.repo.update(ENTRIES, id, {
    status: 'approved',
    approvedBy: actorId,
    approvedAt: ctx.now(),
    conflictWarnings: clash.people.map((p) => ({ kind: 'person', ...p })),
  });
  await ctx.audit.record({ action: 'calendar.entry.approve', actorId, targetType: 'calendar_entry', targetId: id });
  return row;
}

export async function cancelEntry(ctx: FeatureContext, actorId: string, id: string, reason?: string) {
  const e = await ctx.repo.get(ENTRIES, id);
  if (!e) throw notFound('Calendar entry not found');
  if (e.status === 'cancelled') throw conflict('Entry is already cancelled');
  const row = await ctx.repo.update(ENTRIES, id, { status: 'cancelled', cancelledAt: ctx.now(), cancellationReason: reason ?? null });
  await ctx.audit.record({ action: 'calendar.entry.cancel', actorId, targetType: 'calendar_entry', targetId: id, detail: { reason: reason ?? null } });
  return row;
}

export async function listEntries(
  ctx: FeatureContext,
  filter: { from?: string; to?: string; venueId?: string; type?: string; includeDrafts?: boolean; audience?: string[] } = {},
): Promise<Row[]> {
  const all = await ctx.repo.find(ENTRIES, {}, { orderBy: 'startsAt' });
  const fromMs = filter.from ? new Date(filter.from).getTime() : null;
  const toMs = filter.to ? new Date(filter.to).getTime() : null;
  return all
    .filter((e) => (filter.includeDrafts ? true : e.status === 'approved'))
    .filter((e) => e.status !== 'cancelled')
    .filter((e) => (filter.venueId ? e.venueId === filter.venueId : true))
    .filter((e) => (filter.type ? e.type === filter.type : true))
    .filter((e) => (filter.audience?.length ? (e.audience || []).some((a: string) => filter.audience!.includes(a)) : true))
    .filter((e) => (fromMs == null ? true : new Date(e.endsAt).getTime() >= fromMs))
    .filter((e) => (toMs == null ? true : new Date(e.startsAt).getTime() <= toMs))
    .map((e): Row => ({ ...e, localStart: toLocal(e.startsAt, e.timezone || DEFAULT_TZ) }));
}

export async function getEntry(ctx: FeatureContext, id: string) {
  const e = await ctx.repo.get(ENTRIES, id);
  if (!e) throw notFound('Calendar entry not found');
  const related = e.seriesId ? await ctx.repo.find(ENTRIES, { seriesId: e.seriesId }, { orderBy: 'startsAt' }) : [e];
  return {
    ...e,
    localStart: toLocal(e.startsAt, e.timezone || DEFAULT_TZ),
    localEnd: toLocal(e.endsAt, e.timezone || DEFAULT_TZ),
    series: related.map((r) => ({ id: r.id, startsAt: r.startsAt, status: r.status })),
  };
}

/** Calendar view for one viewer: approved entries visible to their audience, rendered locally. */
export async function calendarView(
  ctx: FeatureContext,
  viewerAudiences: string[],
  filter: { from?: string; to?: string; timezone?: string } = {},
) {
  const tz = filter.timezone || DEFAULT_TZ;
  const items = await listEntries(ctx, { from: filter.from, to: filter.to, audience: viewerAudiences });
  return items.map((e): Row => ({ ...e, localStart: toLocal(e.startsAt, tz), localEnd: toLocal(e.endsAt, tz) }));
}
