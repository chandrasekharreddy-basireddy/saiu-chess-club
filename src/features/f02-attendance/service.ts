/**
 * Feature 02 — Tournament Attendance & No-Show Management (slug: `attendance`)
 *
 * Tables
 *   attendance_matches       one row per scheduled match (white/black player, startsAt, status)
 *   attendance_records       the attendance decision per player per match (one of six statuses)
 *   attendance_explanations  private absence explanations submitted by players
 *   attendance_alerts        missing-player alerts raised for the assigned organizer
 *   attendance_incidents     Tournament Emergency Override actions (pause / reschedule / resolve)
 *   attendance_events        append-only decision history for the match
 *
 * Deterministic time rules (spec 11 §Feature 02):
 *   check-in opens 15 minutes before match start
 *   grace period is 10 minutes after match start
 *   a check-in after the start is `late`; a check-in after the grace period is late *and* flagged
 *   the system never awards a walkover automatically — only awardWalkover() can, with confirmation
 */
import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound, forbidden, unprocessable } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

export const MATCHES = 'attendance_matches';
export const RECORDS = 'attendance_records';
export const EXPLANATIONS = 'attendance_explanations';
export const ALERTS = 'attendance_alerts';
export const INCIDENTS = 'attendance_incidents';
export const EVENTS = 'attendance_events';

export const CHECKIN_OPENS_MINUTES_BEFORE = 15;
export const GRACE_MINUTES = 10;

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused', 'walkover_awarded', 'rescheduled'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const EXCUSE_CATEGORIES = ['illness', 'travel', 'emergency', 'technical', 'other'] as const;

const MINUTE = 60 * 1000;

export interface CheckInWindow {
  opensAt: string;
  startsAt: string;
  graceEndsAt: string;
  /** now >= opensAt */
  isOpen: boolean;
  /** now > startsAt */
  isLate: boolean;
  /** now > graceEndsAt — the missing-player threshold has been crossed */
  beyondGrace: boolean;
}

/** Pure, deterministic derivation of the check-in window from a match start time. */
export function checkInWindow(startsAt: string, now: string): CheckInWindow {
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) throw badRequest('startsAt must be a valid ISO timestamp');
  const n = new Date(now).getTime();
  const opens = start - CHECKIN_OPENS_MINUTES_BEFORE * MINUTE;
  const graceEnds = start + GRACE_MINUTES * MINUTE;
  return {
    opensAt: new Date(opens).toISOString(),
    startsAt: new Date(start).toISOString(),
    graceEndsAt: new Date(graceEnds).toISOString(),
    isOpen: n >= opens,
    isLate: n > start,
    beyondGrace: n > graceEnds,
  };
}

function isParticipant(match: Row, playerId: string): boolean {
  return match.whitePlayerId === playerId || match.blackPlayerId === playerId;
}

function opponentOf(match: Row, playerId: string): string | null {
  if (match.whitePlayerId === playerId) return match.blackPlayerId ?? null;
  if (match.blackPlayerId === playerId) return match.whitePlayerId ?? null;
  return null;
}

async function requireMatch(ctx: FeatureContext, matchId: string): Promise<Row> {
  const m = await ctx.repo.get(MATCHES, matchId);
  if (!m) throw notFound('Match not found');
  return m;
}

async function logEvent(ctx: FeatureContext, matchId: string, action: string, actorId: string, detail?: any) {
  await ctx.repo.insert(EVENTS, { id: ctx.newId(), matchId, action, actorId, detail: detail ?? null, at: ctx.now() });
}

async function recordFor(ctx: FeatureContext, matchId: string, playerId: string): Promise<Row | null> {
  return ctx.repo.findOne(RECORDS, { matchId, playerId });
}

async function writeRecord(ctx: FeatureContext, match: Row, playerId: string, patch: Row): Promise<Row> {
  const existing = await recordFor(ctx, match.id, playerId);
  if (existing) return (await ctx.repo.update(RECORDS, existing.id, patch)) as Row;
  return ctx.repo.insert(RECORDS, {
    id: ctx.newId(),
    matchId: match.id,
    tournamentId: match.tournamentId,
    playerId,
    status: 'absent',
    checkedInAt: null,
    late: false,
    beyondGrace: false,
    flagged: false,
    checkInSource: null,
    decidedBy: null,
    decidedAt: null,
    reason: null,
    reopened: false,
    ...patch,
  });
}

/** Organizer creates the attendance row set for a match. */
export async function createMatch(
  ctx: FeatureContext,
  actorId: string,
  input: { tournamentId?: string; whitePlayerId?: string; blackPlayerId?: string; startsAt?: string; board?: number; round?: number },
) {
  if (!input?.tournamentId) throw badRequest('tournamentId is required');
  if (!input?.whitePlayerId || !input?.blackPlayerId) throw badRequest('Both whitePlayerId and blackPlayerId are required');
  if (input.whitePlayerId === input.blackPlayerId) throw badRequest('A player cannot be paired against themselves');
  if (!input?.startsAt) throw badRequest('startsAt is required');
  const win = checkInWindow(input.startsAt, ctx.now());

  const match = await ctx.repo.insert(MATCHES, {
    id: ctx.newId(),
    tournamentId: input.tournamentId,
    whitePlayerId: input.whitePlayerId,
    blackPlayerId: input.blackPlayerId,
    startsAt: win.startsAt,
    checkInOpensAt: win.opensAt,
    graceEndsAt: win.graceEndsAt,
    board: input.board ?? null,
    round: input.round ?? 1,
    status: 'scheduled',
    attendanceStatus: 'pending',
    walkover: null,
    emergencyAction: null,
    attendanceReopened: false,
    createdBy: actorId,
  });
  await logEvent(ctx, match.id, 'attendance.match.create', actorId, { startsAt: win.startsAt });
  await ctx.audit.record({ action: 'attendance.match.create', actorId, targetType: 'match', targetId: match.id });
  return match;
}

/**
 * Player check-in (self-service) or organizer-recorded physical attendance.
 * `source` = 'self' | 'organizer'. Organizer may pass `playerId` for the other player.
 */
export async function checkIn(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  opts: { playerId?: string; source?: 'self' | 'organizer' } = {},
) {
  const match = await requireMatch(ctx, matchId);
  if (match.status === 'completed') throw conflict('Attendance is closed: the match is completed');
  if (match.status === 'rescheduled') throw conflict('Attendance is closed: the match is rescheduled');

  const source = opts.source === 'organizer' ? 'organizer' : 'self';
  const playerId = opts.playerId || actorId;
  if (!isParticipant(match, playerId)) throw forbidden('Only the paired players may check in for this match');
  if (source === 'self' && playerId !== actorId) throw forbidden('You may only check in for yourself');

  const win = checkInWindow(match.startsAt, ctx.now());
  if (!win.isOpen) throw conflict(`Check-in opens 15 minutes before the match starts (opens at ${win.opensAt})`);

  const existing = await recordFor(ctx, matchId, playerId);
  if (existing && (existing.status === 'present' || existing.status === 'late')) {
    throw conflict('Attendance has already been recorded for this player');
  }

  const status: AttendanceStatus = win.isLate ? 'late' : 'present';
  const record = await writeRecord(ctx, match, playerId, {
    status,
    checkedInAt: ctx.now(),
    late: win.isLate,
    beyondGrace: win.beyondGrace,
    flagged: win.beyondGrace,
    checkInSource: source,
    recordedBy: actorId,
  });

  await logEvent(ctx, matchId, 'attendance.checkin', actorId, { playerId, status, late: win.isLate, source });
  await ctx.audit.record({
    action: 'attendance.checkin',
    actorId,
    targetType: 'match',
    targetId: matchId,
    detail: { playerId, status, late: win.isLate },
  });
  return { record, window: win };
}

/** Organizer-only explicit status decision. Walkover is *not* settable here. */
export async function setAttendance(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  playerId: string,
  status: string,
  reason?: string,
) {
  const match = await requireMatch(ctx, matchId);
  if (!isParticipant(match, playerId)) throw badRequest('playerId is not a participant of this match');
  if (!(ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
    throw badRequest(`status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`);
  }
  if (status === 'walkover_awarded') {
    throw unprocessable('A walkover is never recorded automatically: use the walkover decision endpoint with explicit confirmation');
  }
  if (match.status === 'completed' && status !== 'rescheduled') {
    throw conflict('Attendance is closed: the match is completed');
  }
  if (status === 'excused' && !reason?.trim()) throw badRequest('A reason is required to mark a player excused');

  const record = await writeRecord(ctx, match, playerId, {
    status,
    decidedBy: actorId,
    decidedAt: ctx.now(),
    reason: reason?.trim() || null,
    flagged: false,
  });
  const bothDecided = await allDecided(ctx, match);
  await ctx.repo.update(MATCHES, matchId, {
    attendanceStatus: bothDecided ? 'decided' : 'partial',
    status: status === 'rescheduled' ? 'rescheduled' : match.status,
  });
  await logEvent(ctx, matchId, 'attendance.status.record', actorId, { playerId, status, reason: reason ?? null });
  await ctx.audit.record({ action: 'attendance.status.record', actorId, targetType: 'match', targetId: matchId, detail: { playerId, status } });
  return record;
}

async function allDecided(ctx: FeatureContext, match: Row): Promise<boolean> {
  const recs = await ctx.repo.find(RECORDS, { matchId: match.id });
  const decided = new Set(recs.filter((r: Row) => r.status && r.status !== 'pending').map((r: Row) => r.playerId));
  return decided.has(match.whitePlayerId) && decided.has(match.blackPlayerId);
}

/** Private absence explanation. Text is never exposed to the opponent or spectators. */
export async function submitExplanation(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  input: { category?: string; text?: string },
) {
  const match = await requireMatch(ctx, matchId);
  if (!isParticipant(match, actorId)) throw forbidden('Only a paired player may submit an explanation for this match');
  const text = (input?.text || '').trim();
  if (!text) throw badRequest('Explanation text is required');
  if (text.length > 2000) throw badRequest('Explanation text must be 2000 characters or fewer');
  const category = input?.category || 'other';
  if (!(EXCUSE_CATEGORIES as readonly string[]).includes(category)) {
    throw badRequest(`category must be one of: ${EXCUSE_CATEGORIES.join(', ')}`);
  }
  const row = await ctx.repo.insert(EXPLANATIONS, {
    id: ctx.newId(),
    matchId,
    tournamentId: match.tournamentId,
    playerId: actorId,
    category,
    text,
    visibility: 'organizer_only',
    status: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    decision: null,
    reviewNote: null,
  });
  await logEvent(ctx, matchId, 'attendance.explanation.submit', actorId, { category });
  await ctx.audit.record({ action: 'attendance.explanation.submit', actorId, targetType: 'explanation', targetId: row.id });
  return row;
}

/** Organizer review of explanations (full private text). */
export async function listExplanations(ctx: FeatureContext, matchId: string, filter: { status?: string } = {}) {
  const match = await requireMatch(ctx, matchId);
  const rows = await ctx.repo.find(EXPLANATIONS, { matchId: match.id, ...(filter.status ? { status: filter.status } : {}) }, { orderBy: 'createdAt' });
  return rows;
}

export async function reviewExplanation(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  explanationId: string,
  input: { decision?: 'accepted' | 'rejected'; note?: string },
) {
  const match = await requireMatch(ctx, matchId);
  const ex = await ctx.repo.get(EXPLANATIONS, explanationId);
  if (!ex || ex.matchId !== match.id) throw notFound('Explanation not found');
  if (ex.status === 'reviewed') throw conflict('This explanation has already been reviewed');
  const decision = input?.decision;
  if (decision !== 'accepted' && decision !== 'rejected') throw badRequest('decision must be "accepted" or "rejected"');
  if (ex.playerId === actorId) throw forbidden('Separation of duties: a player cannot review their own explanation');

  const updated = await ctx.repo.update(EXPLANATIONS, explanationId, {
    status: 'reviewed',
    decision,
    reviewNote: input?.note?.trim() || null,
    reviewedBy: actorId,
    reviewedAt: ctx.now(),
  });
  if (decision === 'accepted') {
    await writeRecord(ctx, match, ex.playerId, {
      status: 'excused',
      decidedBy: actorId,
      decidedAt: ctx.now(),
      reason: `Explanation accepted (${ex.category})`,
      flagged: false,
    });
  }
  await logEvent(ctx, matchId, 'attendance.explanation.review', actorId, { explanationId, decision });
  await ctx.audit.record({ action: 'attendance.explanation.review', actorId, targetType: 'explanation', targetId: explanationId, detail: { decision } });
  return updated;
}

/**
 * Walkover award — the ONLY path to a walkover, always requiring explicit organizer
 * confirmation plus a reason. Nothing in this module awards one automatically.
 */
export async function awardWalkover(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  input: { winnerPlayerId?: string; reason?: string; confirmed?: boolean },
) {
  const match = await requireMatch(ctx, matchId);
  if (input?.confirmed !== true) throw badRequest('Explicit organizer confirmation (confirmed: true) is required to award a walkover');
  if (!input?.winnerPlayerId) throw badRequest('winnerPlayerId is required');
  if (!isParticipant(match, input.winnerPlayerId)) throw badRequest('winnerPlayerId is not a participant of this match');
  if (!input?.reason?.trim()) throw badRequest('A reason is required to award a walkover');
  if (match.walkover) throw conflict('A walkover has already been awarded for this match');
  if (match.status === 'completed') throw conflict('The match is already completed');

  const loserId = opponentOf(match, input.winnerPlayerId) as string;
  await writeRecord(ctx, match, loserId, {
    status: 'absent',
    decidedBy: actorId,
    decidedAt: ctx.now(),
    reason: input.reason.trim(),
    flagged: false,
  });
  await writeRecord(ctx, match, input.winnerPlayerId, {
    status: 'walkover_awarded',
    decidedBy: actorId,
    decidedAt: ctx.now(),
    reason: input.reason.trim(),
    flagged: false,
  });
  const walkover = {
    winnerPlayerId: input.winnerPlayerId,
    loserPlayerId: loserId,
    reason: input.reason.trim(),
    awardedBy: actorId,
    awardedAt: ctx.now(),
  };
  const updated = await ctx.repo.update(MATCHES, matchId, {
    walkover,
    status: 'completed',
    attendanceStatus: 'decided',
    resultSource: 'walkover',
  });
  await logEvent(ctx, matchId, 'attendance.walkover.award', actorId, walkover);
  await ctx.audit.record({ action: 'attendance.walkover.award', actorId, targetType: 'match', targetId: matchId, detail: walkover });
  return updated;
}

/**
 * Missing-player alert evaluation. Idempotent per (match, player): crossing the grace
 * threshold creates exactly one open alert for the assigned organizer.
 */
export async function evaluateMissing(ctx: FeatureContext, actorId: string, matchId: string) {
  const match = await requireMatch(ctx, matchId);
  const win = checkInWindow(match.startsAt, ctx.now());
  const created: Row[] = [];
  if (!win.beyondGrace) {
    await logEvent(ctx, matchId, 'attendance.alerts.evaluate', actorId, { alerts: 0, reason: 'within grace period' });
    return { alerts: [], window: win };
  }
  for (const playerId of [match.whitePlayerId, match.blackPlayerId]) {
    const rec = await recordFor(ctx, matchId, playerId);
    const decided = rec && rec.status && rec.status !== 'pending';
    if (decided) continue;
    const existing = await ctx.repo.findOne(ALERTS, { matchId, playerId });
    if (existing) continue;
    const alert = await ctx.repo.insert(ALERTS, {
      id: ctx.newId(),
      matchId,
      tournamentId: match.tournamentId,
      playerId,
      kind: 'missing_player',
      threshold: 'grace_period_elapsed',
      status: 'open',
      raisedAt: ctx.now(),
      organizerNotified: true,
      resolvedBy: null,
    });
    created.push(alert);
    await logEvent(ctx, matchId, 'attendance.alert.raise', actorId, { playerId });
  }
  await ctx.audit.record({ action: 'attendance.alert.evaluate', actorId, targetType: 'match', targetId: matchId, detail: { raised: created.length } });
  return { alerts: created, window: win };
}

export async function listAlerts(ctx: FeatureContext, filter: { matchId?: string; status?: string } = {}) {
  const f: Row = {};
  if (filter.matchId) f.matchId = filter.matchId;
  if (filter.status) f.status = filter.status;
  return ctx.repo.find(ALERTS, f, { orderBy: 'createdAt', desc: true });
}

/** Tournament Emergency Override: pause, reschedule or resolve an incident. Always audited. */
export async function emergencyOverride(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  input: { action?: 'pause' | 'reschedule' | 'resolve'; reason?: string; newStartsAt?: string },
) {
  const match = await requireMatch(ctx, matchId);
  const action = input?.action;
  if (action !== 'pause' && action !== 'reschedule' && action !== 'resolve') {
    throw badRequest('action must be one of: pause, reschedule, resolve');
  }
  if (!input?.reason?.trim() || input.reason.trim().length < 5) throw badRequest('A reason of at least 5 characters is required');

  const patch: Row = { emergencyAction: action, emergencyReason: input.reason.trim(), emergencyBy: actorId, emergencyAt: ctx.now() };
  if (action === 'pause') patch.status = 'paused';
  if (action === 'resolve') patch.status = 'completed';
  if (action === 'reschedule') {
    if (!input?.newStartsAt) throw badRequest('newStartsAt is required to reschedule a match');
    const win = checkInWindow(input.newStartsAt, ctx.now());
    patch.status = 'rescheduled';
    patch.startsAt = win.startsAt;
    patch.checkInOpensAt = win.opensAt;
    patch.graceEndsAt = win.graceEndsAt;
  }
  const updated = await ctx.repo.update(MATCHES, matchId, patch);
  const incident = await ctx.repo.insert(INCIDENTS, {
    id: ctx.newId(),
    matchId,
    tournamentId: match.tournamentId,
    action,
    reason: input.reason.trim(),
    actorId,
    previousStatus: match.status,
    newStatus: patch.status,
    at: ctx.now(),
  });
  await logEvent(ctx, matchId, 'attendance.emergency.override', actorId, { action, incidentId: incident.id });
  await ctx.audit.record({
    action: 'attendance.emergency.override',
    actorId,
    targetType: 'match',
    targetId: matchId,
    detail: { action, reason: input.reason.trim() },
  });
  return { match: updated, incident };
}

/** Restricted correction of an already recorded attendance decision — reason mandatory. */
export async function reopenAttendance(ctx: FeatureContext, actorId: string, matchId: string, input: { reason?: string; playerId?: string }) {
  const match = await requireMatch(ctx, matchId);
  if (!input?.reason?.trim()) throw badRequest('A reason is required to reopen attendance');
  if (input.playerId && !isParticipant(match, input.playerId)) throw badRequest('playerId is not a participant of this match');
  if (input.playerId) {
    const rec = await recordFor(ctx, matchId, input.playerId);
    if (!rec) throw notFound('No attendance has been recorded for this player');
    await ctx.repo.update(RECORDS, rec.id, { reopened: true, reopenedBy: actorId, reopenedAt: ctx.now(), reopenReason: input.reason.trim(), status: 'pending' });
  }
  const updated = await ctx.repo.update(MATCHES, matchId, { attendanceReopened: true, attendanceStatus: 'reopened' });
  await logEvent(ctx, matchId, 'attendance.reopen', actorId, { reason: input.reason.trim(), playerId: input.playerId ?? null });
  await ctx.audit.record({ action: 'attendance.reopen', actorId, targetType: 'match', targetId: matchId, detail: { reason: input.reason.trim() } });
  return updated;
}

/** Spec rule 9: the result/standings workflow proceeds only once the attendance decision exists. */
export async function resultGate(ctx: FeatureContext, matchId: string) {
  const match = await requireMatch(ctx, matchId);
  const missing: string[] = [];
  for (const playerId of [match.whitePlayerId, match.blackPlayerId]) {
    const rec = await recordFor(ctx, matchId, playerId);
    if (!rec || !rec.status || rec.status === 'pending') missing.push(playerId);
  }
  return {
    matchId,
    ready: missing.length === 0,
    missing,
    attendanceStatus: match.attendanceStatus ?? 'pending',
    walkover: match.walkover ?? null,
  };
}

/** Organizer live attendance board. */
export async function board(ctx: FeatureContext, matchId: string) {
  const match = await requireMatch(ctx, matchId);
  const records = await ctx.repo.find(RECORDS, { matchId });
  const alerts = await ctx.repo.find(ALERTS, { matchId, status: 'open' });
  const explanations = await ctx.repo.find(EXPLANATIONS, { matchId });
  return {
    match,
    window: checkInWindow(match.startsAt, ctx.now()),
    records,
    alerts,
    pendingExplanations: explanations.filter((e: Row) => e.status === 'submitted').length,
  };
}

/** Player-facing view: own record only, and never another player's explanation text. */
export async function playerView(ctx: FeatureContext, matchId: string, playerId: string) {
  const match = await requireMatch(ctx, matchId);
  if (!isParticipant(match, playerId)) throw forbidden('Only the paired players may view this match');
  const own = await recordFor(ctx, matchId, playerId);
  return {
    matchId,
    startsAt: match.startsAt,
    window: checkInWindow(match.startsAt, ctx.now()),
    status: match.status,
    ownRecord: own,
    walkover: match.walkover ?? null,
  };
}

export async function history(ctx: FeatureContext, matchId: string) {
  await requireMatch(ctx, matchId);
  const events = await ctx.repo.find(EVENTS, { matchId }, { orderBy: 'createdAt' });
  const incidents = await ctx.repo.find(INCIDENTS, { matchId }, { orderBy: 'createdAt' });
  return { matchId, events, incidents };
}

/** Kept for parity with the contract's SoD helper; used by the review guard above. */
export function assertIndependentReview(actorId: string, ownerId: string, what = 'this decision') {
  try {
    assertNotSelfApproval(actorId, ownerId, what);
  } catch (e: any) {
    throw forbidden(e?.message || 'Separation of duties violation');
  }
}
