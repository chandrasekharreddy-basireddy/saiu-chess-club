/**
 * Feature 04 — Match Experience & Result Management (slug: `match-room`)
 *
 * Tables
 *   match_rooms          authoritative match state (lifecycle, clocks, sequence/version, result)
 *   match_moves          append-only move log; `seq` is the authoritative move order
 *   match_confirmations  one row per player response to a proposed result
 *   match_disputes       open/closed disputes with the player's explanation
 *   match_events         append-only match event log (for organizer review and reconnect)
 *   match_standings      standings rows updated exactly once per finalised match
 *
 * Lifecycle (server-authoritative):
 *   scheduled -> checkin -> ready -> live -> awaiting_confirmation -> confirmed | disputed
 *   -> finalized   (organizer resolution of a disputed match also finalises it)
 *   live <-> paused (organizer / technical safe state)
 *
 * Nothing in this module derives a result from the browser, a clock flag or a
 * technical failure: only validated game outcomes, resignations, agreements and
 * explicit organizer resolutions can produce a result.
 */
import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound, forbidden } from '../../core/errors.js';

export const ROOMS = 'match_rooms';
export const MOVES = 'match_moves';
export const CONFIRMATIONS = 'match_confirmations';
export const DISPUTES = 'match_disputes';
export const EVENTS = 'match_events';
export const STANDINGS = 'match_standings';

export const STATUSES = [
  'scheduled', 'checkin', 'ready', 'live', 'awaiting_confirmation',
  'confirmed', 'disputed', 'finalized', 'paused',
] as const;
export type MatchStatus = (typeof STATUSES)[number];

export const RESULTS = ['white', 'black', 'draw'] as const;

export const DEFAULT_SPECTATOR_DELAY_SECONDS = 300;

/** Allowed status transitions — anything else is a 409 state violation. */
export const TRANSITIONS: Record<string, string[]> = {
  scheduled: ['checkin'],
  checkin: ['ready'],
  ready: ['live'],
  live: ['awaiting_confirmation', 'paused'],
  paused: ['live'],
  awaiting_confirmation: ['confirmed', 'disputed'],
  confirmed: ['finalized'],
  disputed: ['finalized'],
  finalized: [],
};

const SAN_RE = /^(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?)$/;
const SQUARE_RE = /^[a-h][1-8]$/;

export function validateTimeControl(tc: any) {
  if (!tc || typeof tc !== 'object') throw badRequest('timeControl { initial, increment } is required');
  const initial = Number(tc.initial);
  const increment = Number(tc.increment ?? 0);
  if (!Number.isFinite(initial) || initial < 30) throw badRequest('timeControl.initial must be at least 30 seconds');
  if (!Number.isFinite(increment) || increment < 0 || increment > 60) throw badRequest('timeControl.increment must be between 0 and 60 seconds');
  return { initial, increment };
}

function assertTransition(from: string, to: string) {
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) throw conflict(`Illegal match transition: ${from} -> ${to}`);
}

function isPlayer(room: Row, userId: string): boolean {
  return room.whitePlayerId === userId || room.blackPlayerId === userId;
}

function sideOf(room: Row, userId: string): 'white' | 'black' | null {
  if (room.whitePlayerId === userId) return 'white';
  if (room.blackPlayerId === userId) return 'black';
  return null;
}

function otherSide(side: 'white' | 'black'): 'white' | 'black' {
  return side === 'white' ? 'black' : 'white';
}

async function requireRoom(ctx: FeatureContext, matchId: string): Promise<Row> {
  const room = await ctx.repo.get(ROOMS, matchId);
  if (!room) throw notFound('Match not found');
  return room;
}

async function logEvent(ctx: FeatureContext, matchId: string, action: string, actorId: string, detail?: any) {
  await ctx.repo.insert(EVENTS, { id: ctx.newId(), matchId, action, actorId, detail: detail ?? null, at: ctx.now() });
}

async function bump(ctx: FeatureContext, room: Row, patch: Row): Promise<Row> {
  return (await ctx.repo.update(ROOMS, room.id, { ...patch, version: (room.version || 1) + 1 })) as Row;
}

/* --------------------------------------------------------------- lifecycle */

export async function createMatch(
  ctx: FeatureContext,
  actorId: string,
  input: {
    tournamentId?: string;
    whitePlayerId?: string;
    blackPlayerId?: string;
    timeControl?: { initial?: number; increment?: number };
    spectatorEnabled?: boolean;
    spectatorDelaySeconds?: number;
    affectsRating?: boolean;
    round?: number;
    board?: number;
  },
) {
  if (!input?.tournamentId) throw badRequest('tournamentId is required');
  if (!input?.whitePlayerId || !input?.blackPlayerId) throw badRequest('Both whitePlayerId and blackPlayerId are required');
  if (input.whitePlayerId === input.blackPlayerId) throw badRequest('A player cannot play themselves');
  const tc = validateTimeControl(input.timeControl || { initial: 600, increment: 0 });
  const room = await ctx.repo.insert(ROOMS, {
    id: ctx.newId(),
    tournamentId: input.tournamentId,
    whitePlayerId: input.whitePlayerId,
    blackPlayerId: input.blackPlayerId,
    round: input.round ?? 1,
    board: input.board ?? null,
    timeControl: tc,
    clock: { whiteMs: tc.initial * 1000, blackMs: tc.initial * 1000 },
    status: 'scheduled',
    turn: 'white',
    seq: 0,
    version: 1,
    checkedIn: [],
    lastMoveAt: null,
    startedAt: null,
    endedAt: null,
    proposedResult: null,
    finalResult: null,
    confirmedAt: null,
    finalizedAt: null,
    resolvedBy: null,
    drawOffer: null,
    clockExpired: false,
    affectsRating: input.affectsRating === true,
    ratingPipelineStatus: null,
    spectatorEnabled: input.spectatorEnabled !== false,
    spectatorDelaySeconds: input.spectatorDelaySeconds ?? DEFAULT_SPECTATOR_DELAY_SECONDS,
    createdBy: actorId,
  });
  await logEvent(ctx, room.id, 'match.create', actorId, { tournamentId: input.tournamentId });
  await ctx.audit.record({ action: 'match.create', actorId, targetType: 'match', targetId: room.id });
  return room;
}

export async function checkIn(ctx: FeatureContext, actorId: string, matchId: string) {
  const room = await requireRoom(ctx, matchId);
  const side = sideOf(room, actorId);
  if (!side) throw forbidden('Only the two paired players may check in');
  if (room.status === 'scheduled') {
    assertTransition('scheduled', 'checkin');
    await ctx.repo.update(ROOMS, matchId, { status: 'checkin' });
  } else if (room.status !== 'checkin') {
    throw conflict(`Check-in is not open (match is ${room.status})`);
  }
  const checkedIn: string[] = Array.isArray(room.checkedIn) ? room.checkedIn.slice() : [];
  if (checkedIn.includes(actorId)) throw conflict('You have already checked in');
  checkedIn.push(actorId);
  const both = checkedIn.includes(room.whitePlayerId) && checkedIn.includes(room.blackPlayerId);
  const updated = await bump(ctx, room, { checkedIn, status: both ? 'ready' : 'checkin', readyAt: both ? ctx.now() : null });
  await logEvent(ctx, matchId, 'match.checkin', actorId, { side, both });
  await ctx.audit.record({ action: 'match.checkin', actorId, targetType: 'match', targetId: matchId, detail: { side } });
  return updated;
}

export async function startMatch(ctx: FeatureContext, actorId: string, matchId: string) {
  const room = await requireRoom(ctx, matchId);
  assertTransition(room.status, 'live');
  const updated = await bump(ctx, room, { status: 'live', startedAt: ctx.now(), lastMoveAt: ctx.now(), turn: 'white' });
  await logEvent(ctx, matchId, 'match.start', actorId, null);
  await ctx.audit.record({ action: 'match.start', actorId, targetType: 'match', targetId: matchId });
  return updated;
}

export async function pauseMatch(ctx: FeatureContext, actorId: string, matchId: string, input: { reason?: string } = {}) {
  const room = await requireRoom(ctx, matchId);
  if (!input?.reason?.trim()) throw badRequest('A reason is required to pause a match');
  assertTransition(room.status, 'paused');
  const updated = await bump(ctx, room, { status: 'paused', pausedAt: ctx.now(), pauseReason: input.reason.trim() });
  await logEvent(ctx, matchId, 'match.pause', actorId, { reason: input.reason.trim() });
  await ctx.audit.record({ action: 'match.pause', actorId, targetType: 'match', targetId: matchId, detail: { reason: input.reason.trim() } });
  return updated;
}

export async function resumeMatch(ctx: FeatureContext, actorId: string, matchId: string) {
  const room = await requireRoom(ctx, matchId);
  assertTransition(room.status, 'live');
  // the clock is restarted from the resume instant: paused time is never charged to a player
  const updated = await bump(ctx, room, { status: 'live', resumedAt: ctx.now(), lastMoveAt: ctx.now(), pausedAt: null });
  await logEvent(ctx, matchId, 'match.resume', actorId, null);
  await ctx.audit.record({ action: 'match.resume', actorId, targetType: 'match', targetId: matchId });
  return updated;
}

/* -------------------------------------------------------------------- moves */

export async function makeMove(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  input: { seq?: number; san?: string; from?: string; to?: string; promotion?: string },
) {
  const room = await requireRoom(ctx, matchId);
  const side = sideOf(room, actorId);
  if (!side) throw forbidden('Only the two paired players may move');
  if (room.status !== 'live') throw conflict(`Moves are only accepted while the match is live (match is ${room.status})`);

  const san = (input?.san || '').trim();
  if (!san) throw badRequest('san is required');
  if (!SAN_RE.test(san)) throw badRequest(`Illegal move notation: ${san}`);
  if (input?.from != null && !SQUARE_RE.test(String(input.from))) throw badRequest('from must be a board square such as e2');
  if (input?.to != null && !SQUARE_RE.test(String(input.to))) throw badRequest('to must be a board square such as e4');

  const expected = (room.seq || 0) + 1;
  const seq = input?.seq == null ? expected : Number(input.seq);

  // Idempotent duplicate delivery is resolved before the turn check: a retried move
  // that is already recorded is answered with the stored move, not a turn violation.
  if (seq < expected) {
    const prior = await ctx.repo.findOne(MOVES, { matchId, seq });
    if (prior && prior.san === san) return { duplicate: true, move: prior, room };
    throw conflict(`Move sequence conflict: expected seq ${expected}, received ${seq}`);
  }
  if (room.turn && side !== room.turn) throw conflict(`It is not your turn (${room.turn} to move)`);
  if (seq !== expected) throw conflict(`Move sequence conflict: expected seq ${expected}, received ${seq}`);

  const now = ctx.now();
  const tc = room.timeControl || { initial: 600, increment: 0 };
  const elapsed = room.lastMoveAt ? Math.max(0, new Date(now).getTime() - new Date(room.lastMoveAt).getTime()) : 0;
  const clock = { whiteMs: room.clock?.whiteMs ?? tc.initial * 1000, blackMs: room.clock?.blackMs ?? tc.initial * 1000 };
  const key = side === 'white' ? 'whiteMs' : 'blackMs';
  clock[key] = clock[key] - elapsed + tc.increment * 1000;
  const expired = clock[key] <= 0;
  if (expired) clock[key] = 0;

  const move = await ctx.repo.insert(MOVES, {
    id: ctx.newId(),
    matchId,
    seq,
    side,
    playerId: actorId,
    san,
    from: input?.from ?? null,
    to: input?.to ?? null,
    promotion: input?.promotion ?? null,
    clockAfterMs: clock[key],
    at: now,
  });
  // A flagged clock is surfaced to the organizer, never turned into a result by the server alone.
  const updated = await bump(ctx, room, {
    seq,
    turn: otherSide(side),
    clock,
    lastMoveAt: now,
    clockExpired: expired,
  });
  await logEvent(ctx, matchId, 'match.move', actorId, { seq, san, side });
  await ctx.audit.record({ action: 'match.move', actorId, targetType: 'match', targetId: matchId, detail: { seq, san } });
  return { duplicate: false, move, room: updated };
}

/* --------------------------------------------------------------- game ends */

export async function offerDraw(ctx: FeatureContext, actorId: string, matchId: string) {
  const room = await requireRoom(ctx, matchId);
  const side = sideOf(room, actorId);
  if (!side) throw forbidden('Only the two paired players may offer a draw');
  if (room.status !== 'live') throw conflict(`Draws may only be offered while the match is live (match is ${room.status})`);
  if (room.drawOffer) throw conflict('A draw offer is already pending');
  const updated = await bump(ctx, room, { drawOffer: { byPlayerId: actorId, side, at: ctx.now() } });
  await logEvent(ctx, matchId, 'match.draw.offer', actorId, { side });
  await ctx.audit.record({ action: 'match.draw.offer', actorId, targetType: 'match', targetId: matchId });
  return updated;
}

export async function respondDraw(ctx: FeatureContext, actorId: string, matchId: string, input: { accept?: boolean }) {
  const room = await requireRoom(ctx, matchId);
  const side = sideOf(room, actorId);
  if (!side) throw forbidden('Only the two paired players may answer a draw offer');
  if (!room.drawOffer) throw conflict('There is no pending draw offer');
  if (room.drawOffer.byPlayerId === actorId) throw conflict('You cannot answer your own draw offer');
  if (room.status !== 'live') throw conflict(`The match is not live (match is ${room.status})`);

  if (input?.accept === true) {
    assertTransition('live', 'awaiting_confirmation');
    const updated = await bump(ctx, room, {
      drawOffer: null,
      status: 'awaiting_confirmation',
      endedAt: ctx.now(),
      proposedResult: { result: 'draw', reason: 'draw agreement', proposedBy: actorId, proposedAt: ctx.now() },
    });
    await logEvent(ctx, matchId, 'match.draw.accept', actorId, null);
    await ctx.audit.record({ action: 'match.draw.accept', actorId, targetType: 'match', targetId: matchId });
    return updated;
  }
  const updated = await bump(ctx, room, { drawOffer: null });
  await logEvent(ctx, matchId, 'match.draw.decline', actorId, null);
  await ctx.audit.record({ action: 'match.draw.decline', actorId, targetType: 'match', targetId: matchId });
  return updated;
}

export async function resign(ctx: FeatureContext, actorId: string, matchId: string) {
  const room = await requireRoom(ctx, matchId);
  const side = sideOf(room, actorId);
  if (!side) throw forbidden('Only the two paired players may resign');
  if (room.status !== 'live') throw conflict(`You cannot resign a match that is ${room.status}`);
  assertTransition('live', 'awaiting_confirmation');
  const winner = otherSide(side);
  const updated = await bump(ctx, room, {
    status: 'awaiting_confirmation',
    endedAt: ctx.now(),
    proposedResult: { result: winner, reason: 'resignation', proposedBy: actorId, proposedAt: ctx.now() },
  });
  await logEvent(ctx, matchId, 'match.resign', actorId, { side });
  await ctx.audit.record({ action: 'match.resign', actorId, targetType: 'match', targetId: matchId, detail: { winner } });
  return updated;
}

/** Organizer-managed end of game (valid game outcome or organizer-managed event). */
export async function proposeResult(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  input: { result?: string; reason?: string },
) {
  const room = await requireRoom(ctx, matchId);
  if (!isPlayer(room, actorId)) {
    // organizer-managed events are allowed only through the organizer permission on the route
    if (!input?.reason?.trim()) throw badRequest('An organizer-managed result requires a reason');
  }
  if (room.status !== 'live') throw conflict(`A result can only be proposed while the match is live (match is ${room.status})`);
  if (!(RESULTS as readonly string[]).includes(input?.result as string)) throw badRequest('result must be white, black or draw');
  assertTransition('live', 'awaiting_confirmation');
  const updated = await bump(ctx, room, {
    status: 'awaiting_confirmation',
    endedAt: ctx.now(),
    proposedResult: { result: input.result, reason: input?.reason?.trim() || 'game ended', proposedBy: actorId, proposedAt: ctx.now() },
  });
  await logEvent(ctx, matchId, 'match.result.propose', actorId, { result: input.result });
  await ctx.audit.record({ action: 'match.result.propose', actorId, targetType: 'match', targetId: matchId, detail: { result: input.result } });
  return updated;
}

/* ----------------------------------------------------- confirmations / dispute */

export async function confirmResult(ctx: FeatureContext, actorId: string, matchId: string, input: { agree?: boolean; note?: string } = {}) {
  const room = await requireRoom(ctx, matchId);
  const side = sideOf(room, actorId);
  if (!side) throw forbidden('Only the two paired players may confirm the result');
  if (room.status === 'disputed') throw conflict('The result is disputed: it stays unresolved until an organizer resolves it');
  if (room.status !== 'awaiting_confirmation') throw conflict(`There is no result awaiting confirmation (match is ${room.status})`);
  const existing = await ctx.repo.findOne(CONFIRMATIONS, { matchId, playerId: actorId });
  if (existing) throw conflict('You have already responded to this result');

  const agree = input?.agree !== false;
  await ctx.repo.insert(CONFIRMATIONS, {
    id: ctx.newId(),
    matchId,
    playerId: actorId,
    side,
    decision: agree ? 'agree' : 'disagree',
    note: input?.note?.trim() || null,
    at: ctx.now(),
  });

  if (!agree) {
    assertTransition('awaiting_confirmation', 'disputed');
    await ctx.repo.insert(DISPUTES, {
      id: ctx.newId(),
      matchId,
      raisedBy: actorId,
      side,
      reason: input?.note?.trim() || 'Result disagreed',
      status: 'open',
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      at: ctx.now(),
    });
    const updated = await bump(ctx, room, { status: 'disputed', disputedAt: ctx.now() });
    await logEvent(ctx, matchId, 'match.result.dispute', actorId, { side });
    await ctx.audit.record({ action: 'match.result.dispute', actorId, targetType: 'match', targetId: matchId });
    return updated;
  }

  const agrees = await ctx.repo.find(CONFIRMATIONS, { matchId, decision: 'agree' });
  const bothAgreed = agrees.some((c: Row) => c.playerId === room.whitePlayerId) && agrees.some((c: Row) => c.playerId === room.blackPlayerId);
  const patch: Row = bothAgreed ? { status: 'confirmed', confirmedAt: ctx.now() } : {};
  const updated = bothAgreed ? await bump(ctx, room, patch) : room;
  await logEvent(ctx, matchId, 'match.result.confirm', actorId, { side, bothAgreed });
  await ctx.audit.record({ action: 'match.result.confirm', actorId, targetType: 'match', targetId: matchId, detail: { bothAgreed } });
  return updated;
}

export async function disputeResult(ctx: FeatureContext, actorId: string, matchId: string, input: { reason?: string }) {
  const room = await requireRoom(ctx, matchId);
  const side = sideOf(room, actorId);
  if (!side) throw forbidden('Only the two paired players may dispute the result');
  if (!input?.reason?.trim()) throw badRequest('A reason is required to dispute the result');
  return confirmResult(ctx, actorId, matchId, { agree: false, note: input.reason.trim() });
}

/* -------------------------------------------------------------- resolution */

async function applyStandings(ctx: FeatureContext, room: Row, result: string) {
  const tournamentId = room.tournamentId;
  const update = async (playerId: string, points: number, kind: 'win' | 'draw' | 'loss') => {
    const existing = await ctx.repo.findOne(STANDINGS, { tournamentId, playerId });
    const base: Row = existing || { id: ctx.newId(), tournamentId, playerId, points: 0, played: 0, wins: 0, draws: 0, losses: 0 };
    const next = {
      points: base.points + points,
      played: base.played + 1,
      wins: base.wins + (kind === 'win' ? 1 : 0),
      draws: base.draws + (kind === 'draw' ? 1 : 0),
      losses: base.losses + (kind === 'loss' ? 1 : 0),
    };
    if (existing) return ctx.repo.update(STANDINGS, existing.id, next);
    return ctx.repo.insert(STANDINGS, { ...base, ...next, id: base.id, lastMatchId: room.id });
  };

  if (result === 'draw') {
    await update(room.whitePlayerId, 0.5, 'draw');
    await update(room.blackPlayerId, 0.5, 'draw');
  } else if (result === 'white') {
    await update(room.whitePlayerId, 1, 'win');
    await update(room.blackPlayerId, 0, 'loss');
  } else {
    await update(room.blackPlayerId, 1, 'win');
    await update(room.whitePlayerId, 0, 'loss');
  }
}

/**
 * Finalisation. Standings are updated exactly once: a second finalisation is a 409,
 * and the rating pipeline is only queued when the match is configured to affect ratings.
 */
export async function finalizeMatch(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  input: { result?: string; reason?: string } = {},
) {
  const room = await requireRoom(ctx, matchId);
  if (room.finalizedAt || room.status === 'finalized') throw conflict('This result is already finalised');
  if (room.status !== 'confirmed' && room.status !== 'disputed') {
    throw conflict(`Only a confirmed or disputed match can be finalised (match is ${room.status})`);
  }
  if (room.status === 'disputed' && !input?.reason?.trim()) {
    throw badRequest('An organizer resolution of a disputed match requires a reason');
  }
  const result = input?.result || room.proposedResult?.result;
  if (!(RESULTS as readonly string[]).includes(result as string)) throw badRequest('A valid final result is required');

  assertTransition(room.status, 'finalized');
  const updated = await bump(ctx, room, {
    status: 'finalized',
    finalResult: result,
    finalizedAt: ctx.now(),
    resolvedBy: actorId,
    resolutionReason: input?.reason?.trim() || null,
    ratingPipelineStatus: room.affectsRating ? 'queued' : 'not_applicable',
    standingsUpdated: true,
  });
  await applyStandings(ctx, room, result as string);

  const disputes = await ctx.repo.find(DISPUTES, { matchId, status: 'open' });
  for (const d of disputes) {
    await ctx.repo.update(DISPUTES, d.id, { status: 'resolved', resolution: result, resolvedBy: actorId, resolvedAt: ctx.now() });
  }
  await logEvent(ctx, matchId, 'match.finalize', actorId, { result, reason: input?.reason ?? null });
  await ctx.audit.record({ action: 'match.finalize', actorId, targetType: 'match', targetId: matchId, detail: { result } });
  return updated;
}

/* ------------------------------------------------------------ reads / views */

export async function getState(ctx: FeatureContext, matchId: string) {
  const room = await requireRoom(ctx, matchId);
  const moves = await ctx.repo.find(MOVES, { matchId }, { orderBy: 'seq' });
  return { room, moves, seq: room.seq, version: room.version, authoritative: true };
}

export async function getMatchFor(ctx: FeatureContext, matchId: string, userId: string) {
  const state = await getState(ctx, matchId);
  if (!isPlayer(state.room, userId)) throw forbidden('Only the two paired players may view the full match state');
  return state;
}

/** Spectator view: read-only, delayed server-side. Live state never leaks. */
export async function spectate(ctx: FeatureContext, matchId: string) {
  const room = await requireRoom(ctx, matchId);
  if (!room.spectatorEnabled) throw forbidden('Spectating is disabled for this match');
  const delaySeconds = room.spectatorDelaySeconds ?? DEFAULT_SPECTATOR_DELAY_SECONDS;
  const cutoff = new Date(ctx.now()).getTime() - delaySeconds * 1000;
  const all = await ctx.repo.find(MOVES, { matchId }, { orderBy: 'seq' });
  const visible = all.filter((m: Row) => new Date(m.at).getTime() <= cutoff);
  const resultVisible = room.finalizedAt ? new Date(room.finalizedAt).getTime() <= cutoff : false;
  return {
    matchId,
    readOnly: true,
    delaySeconds,
    delayedUntil: new Date(cutoff).toISOString(),
    moves: visible,
    lastVisibleSeq: visible.length ? visible[visible.length - 1].seq : 0,
    result: resultVisible ? room.finalResult : null,
    status: resultVisible ? room.status : 'delayed',
  };
}

export async function setSpectatorPolicy(ctx: FeatureContext, actorId: string, matchId: string, input: { enabled?: boolean; delaySeconds?: number }) {
  const room = await requireRoom(ctx, matchId);
  const patch: Row = {};
  if (typeof input?.enabled === 'boolean') patch.spectatorEnabled = input.enabled;
  if (input?.delaySeconds != null) {
    if (input.delaySeconds < 0) throw badRequest('delaySeconds must be zero or more');
    patch.spectatorDelaySeconds = input.delaySeconds;
  }
  if (!Object.keys(patch).length) throw badRequest('Nothing to update');
  const updated = await bump(ctx, room, patch);
  await logEvent(ctx, matchId, 'match.spectator.policy', actorId, patch);
  await ctx.audit.record({ action: 'match.spectator.policy', actorId, targetType: 'match', targetId: matchId, detail: patch });
  return updated;
}

export async function listEvents(ctx: FeatureContext, matchId: string) {
  await requireRoom(ctx, matchId);
  return ctx.repo.find(EVENTS, { matchId }, { orderBy: 'createdAt' });
}

export async function listDisputes(ctx: FeatureContext, matchId: string) {
  await requireRoom(ctx, matchId);
  return ctx.repo.find(DISPUTES, { matchId }, { orderBy: 'createdAt' });
}

export async function standingsFor(ctx: FeatureContext, tournamentId: string) {
  const rows = await ctx.repo.find(STANDINGS, { tournamentId });
  const sorted = rows.slice().sort((a: Row, b: Row) => (b.points - a.points) || String(a.playerId).localeCompare(String(b.playerId)));
  return sorted.map((r: Row, i: number) => ({ ...r, rank: i + 1 }));
}
