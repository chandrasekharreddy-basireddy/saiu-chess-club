import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';

/**
 * Tables (created implicitly on first insert)
 *
 * academic_years         approved, versioned academic-year definitions
 *                        (label, startsOn, endsOn, isCurrent, version, status, supersedes)
 * academic_year_events   the timeline inside a year: semesters, tournaments, events,
 *                        deadlines, committee cycles, season markers
 *
 * Invariant: at most one academic year is flagged current at any moment. Activation clears
 * the flag on every other year first, so the invariant holds without a transaction.
 */

export const YEAR = 'academic_years';
export const YEAR_EVENT = 'academic_year_events';

export const EVENT_KINDS = ['semester', 'tournament', 'event', 'deadline', 'committee_cycle', 'season'];
export const YEAR_STATUSES = ['planned', 'active', 'superseded', 'archived'];

const DAY_MS = 24 * 3600 * 1000;

function text(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value: any, field: string): string {
  const raw = text(value);
  if (!raw) throw badRequest(`${field} is required`);
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw badRequest(`${field} must be an ISO date`);
  return new Date(ms).toISOString();
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** How far through the year the given instant sits, as 0..100. */
export function yearProgress(year: Row, nowIso: string): number {
  const start = Date.parse(year?.startsOn);
  const end = Date.parse(year?.endsOn);
  const now = Date.parse(nowIso);
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(now) || end <= start) return 0;
  return clampPercent(((now - start) / (end - start)) * 100);
}

export function daysRemaining(year: Row, nowIso: string): number {
  const end = Date.parse(year?.endsOn);
  const now = Date.parse(nowIso);
  if (Number.isNaN(end) || Number.isNaN(now)) return 0;
  return Math.max(0, Math.ceil((end - now) / DAY_MS));
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

async function assertNoOverlap(ctx: FeatureContext, startsOn: string, endsOn: string, ignoreId?: string) {
  const start = Date.parse(startsOn);
  const end = Date.parse(endsOn);
  const years = await ctx.repo.find(YEAR, {}, { orderBy: 'startsOn' });
  for (const other of years) {
    if (ignoreId && other.id === ignoreId) continue;
    if (other.status === 'superseded' || other.status === 'archived') continue;
    const otherStart = Date.parse(other.startsOn);
    const otherEnd = Date.parse(other.endsOn);
    if (Number.isNaN(otherStart) || Number.isNaN(otherEnd)) continue;
    if (overlaps(start, end, otherStart, otherEnd)) {
      throw conflict(`Academic year overlaps the existing year '${other.label}'`);
    }
  }
}

export async function createYear(ctx: FeatureContext, actorId: string, input: any) {
  const label = text(input?.label);
  if (!label) throw badRequest('Academic year label is required');
  const startsOn = parseDate(input?.startsOn, 'startsOn');
  const endsOn = parseDate(input?.endsOn, 'endsOn');
  if (Date.parse(startsOn) >= Date.parse(endsOn)) throw badRequest('startsOn must be before endsOn');
  await assertNoOverlap(ctx, startsOn, endsOn);

  const row = await ctx.repo.insert(YEAR, {
    id: ctx.newId(),
    label,
    startsOn,
    endsOn,
    isCurrent: false,
    version: 1,
    status: 'planned',
    supersedes: null,
    approvedBy: actorId,
    approvedAt: ctx.now(),
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'academic_year.create',
    actorId,
    targetType: 'academic_year',
    targetId: row.id,
    detail: { label, startsOn, endsOn, version: 1 },
  });
  return row;
}

export async function listYears(ctx: FeatureContext, filter: any = {}) {
  const where: Row = {};
  if (text(filter.status)) where.status = text(filter.status);
  const years = await ctx.repo.find(YEAR, where, { orderBy: 'startsOn', desc: true });
  const now = ctx.now();
  return years.map((y) => ({
    ...y,
    progressPercent: yearProgress(y, now),
    daysRemaining: daysRemaining(y, now),
  }));
}

export async function getYear(ctx: FeatureContext, id: string) {
  const year = await ctx.repo.get(YEAR, id);
  if (!year) throw notFound('Academic year not found');
  return year;
}

export async function getCurrentYear(ctx: FeatureContext) {
  const years = await ctx.repo.find(YEAR, { isCurrent: true }, { orderBy: 'startsOn', desc: true });
  const year = years[0];
  if (!year) throw notFound('No academic year is currently active');
  const now = ctx.now();
  return { ...year, progressPercent: yearProgress(year, now), daysRemaining: daysRemaining(year, now) };
}

/** Only one year may be current: clear every other flag, then set this one. */
export async function activateYear(ctx: FeatureContext, actorId: string, id: string) {
  const year = await ctx.repo.get(YEAR, id);
  if (!year) throw notFound('Academic year not found');
  if (year.status === 'superseded' || year.status === 'archived') {
    throw conflict(`Cannot activate a ${year.status} academic year`);
  }
  const years = await ctx.repo.find(YEAR, {}, { orderBy: 'startsOn' });
  for (const other of years) {
    if (other.id !== id && other.isCurrent) {
      await ctx.repo.update(YEAR, other.id, { isCurrent: false });
    }
  }
  const updated = await ctx.repo.update(YEAR, id, {
    isCurrent: true,
    status: 'active',
    activatedBy: actorId,
    activatedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'academic_year.activate',
    actorId,
    targetType: 'academic_year',
    targetId: id,
    detail: { label: year.label, version: year.version },
  });
  return updated;
}

/** Changing approved dates creates a new version; the old one is kept as history. */
export async function reviseYear(ctx: FeatureContext, actorId: string, id: string, input: any) {
  const year = await ctx.repo.get(YEAR, id);
  if (!year) throw notFound('Academic year not found');
  if (year.status === 'superseded' || year.status === 'archived') {
    throw conflict(`Cannot revise a ${year.status} academic year`);
  }
  const startsOn = input?.startsOn ? parseDate(input.startsOn, 'startsOn') : year.startsOn;
  const endsOn = input?.endsOn ? parseDate(input.endsOn, 'endsOn') : year.endsOn;
  if (Date.parse(startsOn) >= Date.parse(endsOn)) throw badRequest('startsOn must be before endsOn');
  await assertNoOverlap(ctx, startsOn, endsOn, id);

  const nextVersion = num(year.version) + 1;
  const created = await ctx.repo.insert(YEAR, {
    id: ctx.newId(),
    label: text(input?.label) || year.label,
    startsOn,
    endsOn,
    isCurrent: !!year.isCurrent,
    version: nextVersion,
    status: year.isCurrent ? 'active' : 'planned',
    supersedes: year.id,
    approvedBy: actorId,
    approvedAt: ctx.now(),
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.repo.update(YEAR, id, { isCurrent: false, status: 'superseded', supersededBy: created.id });
  await ctx.audit.record({
    action: 'academic_year.revise',
    actorId,
    targetType: 'academic_year',
    targetId: created.id,
    detail: { label: created.label, version: nextVersion, supersedes: id },
  });
  return created;
}

export async function addEvent(ctx: FeatureContext, actorId: string, yearId: string, input: any) {
  const year = await ctx.repo.get(YEAR, yearId);
  if (!year) throw notFound('Academic year not found');
  const title = text(input?.title);
  if (!title) throw badRequest('Event title is required');
  const kind = text(input?.kind) || 'event';
  if (!EVENT_KINDS.includes(kind)) throw badRequest(`Unknown timeline kind: ${kind}`);
  const startsOn = parseDate(input?.startsOn, 'startsOn');
  const endsOn = input?.endsOn ? parseDate(input.endsOn, 'endsOn') : startsOn;
  if (Date.parse(endsOn) < Date.parse(startsOn)) throw badRequest('endsOn cannot be before startsOn');
  const row = await ctx.repo.insert(YEAR_EVENT, {
    id: ctx.newId(),
    academicYearId: yearId,
    title,
    kind,
    startsOn,
    endsOn,
    source: text(input?.source) || 'academic-year',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'academic_year.event.create',
    actorId,
    targetType: 'academic_year_event',
    targetId: row.id,
    detail: { academicYearId: yearId, kind },
  });
  return row;
}

/** Timeline view: every metric carries its source table and read timestamp. */
export async function getTimeline(ctx: FeatureContext, yearId: string) {
  const year = await ctx.repo.get(YEAR, yearId);
  if (!year) throw notFound('Academic year not found');
  const now = ctx.now();
  const nowMs = Date.parse(now);
  const events = await ctx.repo.find(YEAR_EVENT, { academicYearId: yearId }, { orderBy: 'startsOn' });
  const upcoming = events.filter((e) => {
    const ms = Date.parse(e.startsOn);
    return !Number.isNaN(ms) && ms >= nowMs;
  });
  return {
    year,
    events,
    upcoming,
    upcomingCount: upcoming.length,
    progressPercent: yearProgress(year, now),
    daysRemaining: daysRemaining(year, now),
    metrics: {
      progressPercent: { source: YEAR, readAt: now },
      upcomingCount: { source: YEAR_EVENT, readAt: now },
    },
    generatedAt: now,
  };
}
