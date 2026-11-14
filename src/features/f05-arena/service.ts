/**
 * Feature 05 — Chess Arena & Game Modes (slug: `arena`)
 *
 * Tables
 *   arena_games        one row per arena game (mode, seats, time control, result, PGN)
 *   arena_invitations  private-game invitations (expiring, declinable)
 *   arena_events       append-only game events (start, disconnect, reconnect, completion)
 *   arena_reports      behaviour reports and their staff review
 *
 * Modes and rating impact (spec 11 §Feature 05)
 *   friendly  -> no rating impact
 *   practice  -> no rating impact
 *   rated     -> rating impact, applied only after a valid finalisation (once)
 *   private   -> invitation-only; the game starts only after the invitee accepts
 *   official  -> created by the tournament workflow only (importOfficialGame), Blocked Mode required
 *
 * The rating *number* is deliberately not computed here: the spec defines rating impact
 * (which games count, and when) but no formula. This module records the impact decision
 * and queues the pipeline; feature 06 (ratings) owns the arithmetic.
 */
import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound, forbidden, unprocessable } from '../../core/errors.js';

export const GAMES = 'arena_games';
export const INVITATIONS = 'arena_invitations';
export const EVENTS = 'arena_events';
export const REPORTS = 'arena_reports';

export const MODES = ['friendly', 'rated', 'private', 'practice', 'official'] as const;
export type GameMode = (typeof MODES)[number];

export const GAME_STATUSES = ['awaiting_invitation', 'open', 'ready', 'live', 'completed', 'cancelled', 'declined'] as const;

export const RESULTS = ['white', 'black', 'draw'] as const;
export const REPORT_CATEGORIES = ['stalling', 'abusive_language', 'suspected_engine', 'other'] as const;
export const REVIEW_OUTCOMES = ['no_action', 'referred', 'warning_issued'] as const;

/** Proposed presets from the spec. */
export const TIME_CONTROL_PRESETS = {
  bullet: [{ initial: 60, increment: 0 }],
  blitz: [{ initial: 180, increment: 0 }, { initial: 300, increment: 3 }],
  rapid: [{ initial: 600, increment: 0 }, { initial: 900, increment: 10 }],
  classical: [] as Array<{ initial: number; increment: number }>,
} as const;

export const DEFAULT_INVITATION_TTL_MINUTES = 24 * 60;
export const CLOCK_BEHAVIOR_ON_DISCONNECT = 'clock_runs_while_disconnected';

/** Deterministic classification of a time control into a preset category. */
export function classifyTimeControl(initial: number): 'bullet' | 'blitz' | 'rapid' | 'classical' {
  if (initial < 180) return 'bullet';
  if (initial < 600) return 'blitz';
  if (initial < 1800) return 'rapid';
  return 'classical';
}

export function validateTimeControl(tc: any) {
  if (!tc || typeof tc !== 'object') throw badRequest('timeControl { initial, increment } is required');
  const initial = Number(tc.initial);
  const increment = Number(tc.increment ?? 0);
  if (!Number.isFinite(initial) || initial < 30) throw badRequest('timeControl.initial must be at least 30 seconds');
  if (!Number.isFinite(increment) || increment < 0 || increment > 60) throw badRequest('timeControl.increment must be between 0 and 60 seconds');
  return { initial, increment, category: classifyTimeControl(initial), label: `${Math.round(initial / 60)}+${increment}` };
}

function ratingImpactFor(mode: string, explicit?: boolean): boolean {
  if (mode === 'rated') return true;
  if (mode === 'friendly' || mode === 'practice') return false;
  return explicit === true;
}

function sideOf(game: Row, userId: string): 'white' | 'black' | null {
  if (game.whitePlayerId === userId) return 'white';
  if (game.blackPlayerId === userId) return 'black';
  return null;
}

async function requireGame(ctx: FeatureContext, gameId: string): Promise<Row> {
  const g = await ctx.repo.get(GAMES, gameId);
  if (!g) throw notFound('Game not found');
  return g;
}

async function logEvent(ctx: FeatureContext, gameId: string, action: string, actorId: string, detail?: any) {
  await ctx.repo.insert(EVENTS, { id: ctx.newId(), gameId, action, actorId, detail: detail ?? null, at: ctx.now() });
}

/* -------------------------------------------------------------- create/join */

export async function createGame(
  ctx: FeatureContext,
  actorId: string,
  input: {
    mode?: string;
    opponentId?: string;
    timeControl?: { initial?: number; increment?: number };
    expiresInMinutes?: number;
    tournamentId?: string;
    ratingImpact?: boolean;
  },
) {
  const mode = input?.mode;
  if (!(MODES as readonly string[]).includes(mode as string)) {
    throw badRequest(`mode must be one of: ${MODES.join(', ')}`);
  }
  if (mode === 'official') {
    throw unprocessable('Official tournament games must originate from the tournament workflow, not from an ordinary game invitation');
  }
  const tc = validateTimeControl(input.timeControl || { initial: 600, increment: 0 });
  if (input?.opponentId && input.opponentId === actorId) throw badRequest('Self-play is not permitted');

  let status: string = 'open';
  let blackPlayerId: string | null = null;
  let invitation: Row | null = null;
  if (mode === 'private') {
    if (!input?.opponentId) throw badRequest('A private game requires an opponentId to invite');
    status = 'awaiting_invitation';
    const ttl = input.expiresInMinutes ?? DEFAULT_INVITATION_TTL_MINUTES;
    if (!Number.isFinite(ttl) || ttl <= 0) throw badRequest('expiresInMinutes must be a positive number');
    invitation = await ctx.repo.insert(INVITATIONS, {
      id: ctx.newId(),
      inviteeId: input.opponentId,
      inviterId: actorId,
      status: 'pending',
      expiresAt: new Date(new Date(ctx.now()).getTime() + ttl * 60_000).toISOString(),
      respondedAt: null,
      gameId: null,
    });
  } else if (input?.opponentId) {
    blackPlayerId = input.opponentId;
    status = 'ready';
  }

  const game = await ctx.repo.insert(GAMES, {
    id: ctx.newId(),
    mode,
    status,
    tournamentId: input?.tournamentId ?? null,
    whitePlayerId: actorId,
    blackPlayerId,
    timeControl: tc,
    clock: { whiteMs: tc.initial * 1000, blackMs: tc.initial * 1000 },
    ratingImpact: ratingImpactFor(mode as string, input?.ratingImpact),
    ratingApplied: false,
    ratingAppliedAt: null,
    ratingPipelineStatus: null,
    result: null,
    pgn: null,
    moves: [],
    startedAt: null,
    endedAt: null,
    blockedModeConfirmed: false,
    disconnectedSide: null,
    clockBehavior: CLOCK_BEHAVIOR_ON_DISCONNECT,
    createdBy: actorId,
  });
  if (invitation) await ctx.repo.update(INVITATIONS, invitation.id, { gameId: game.id });
  await logEvent(ctx, game.id, 'arena.game.create', actorId, { mode, status });
  await ctx.audit.record({ action: 'arena.game.create', actorId, targetType: 'game', targetId: game.id, detail: { mode } });
  return { game, invitation };
}

/** Official games are created by the tournament workflow, never by a player invitation. */
export async function importOfficialGame(
  ctx: FeatureContext,
  actorId: string,
  input: { tournamentId?: string; matchId?: string; whitePlayerId?: string; blackPlayerId?: string; timeControl?: any; affectsRating?: boolean; blockedModeConfirmed?: boolean },
) {
  if (!input?.tournamentId) throw badRequest('tournamentId is required');
  if (!input?.whitePlayerId || !input?.blackPlayerId) throw badRequest('Both whitePlayerId and blackPlayerId are required');
  if (input.whitePlayerId === input.blackPlayerId) throw badRequest('Self-play is not permitted');
  const tc = validateTimeControl(input.timeControl || { initial: 900, increment: 10 });
  if (input?.blockedModeConfirmed !== true) {
    throw conflict('Official supervised games must run in Blocked Mode before they can start');
  }
  const game = await ctx.repo.insert(GAMES, {
    id: ctx.newId(),
    mode: 'official',
    status: 'ready',
    tournamentId: input.tournamentId,
    matchId: input.matchId ?? null,
    whitePlayerId: input.whitePlayerId,
    blackPlayerId: input.blackPlayerId,
    timeControl: tc,
    clock: { whiteMs: tc.initial * 1000, blackMs: tc.initial * 1000 },
    ratingImpact: input?.affectsRating === true,
    ratingApplied: false,
    ratingAppliedAt: null,
    ratingPipelineStatus: null,
    result: null,
    pgn: null,
    moves: [],
    startedAt: null,
    endedAt: null,
    blockedModeConfirmed: true,
    disconnectedSide: null,
    clockBehavior: CLOCK_BEHAVIOR_ON_DISCONNECT,
    createdBy: actorId,
    origin: 'tournament_workflow',
  });
  await logEvent(ctx, game.id, 'arena.game.import_official', actorId, { tournamentId: input.tournamentId });
  await ctx.audit.record({ action: 'arena.game.import_official', actorId, targetType: 'game', targetId: game.id });
  return game;
}

export async function joinGame(ctx: FeatureContext, userId: string, gameId: string) {
  const game = await requireGame(ctx, gameId);
  if (game.status !== 'open') throw conflict(`This game is not open to join (status ${game.status})`);
  if (game.whitePlayerId === userId) throw badRequest('Self-play is not permitted');
  if (game.blackPlayerId) throw conflict('This game already has two players');
  const updated = await ctx.repo.update(GAMES, gameId, { blackPlayerId: userId, status: 'ready' });
  await logEvent(ctx, gameId, 'arena.game.join', userId, null);
  await ctx.audit.record({ action: 'arena.game.join', actorId: userId, targetType: 'game', targetId: gameId });
  return updated;
}

export async function inviteToGame(ctx: FeatureContext, actorId: string, gameId: string, input: { inviteeId?: string; expiresInMinutes?: number }) {
  const game = await requireGame(ctx, gameId);
  if (game.whitePlayerId !== actorId) throw forbidden('Only the game creator may invite an opponent');
  if (!input?.inviteeId) throw badRequest('inviteeId is required');
  if (input.inviteeId === actorId) throw badRequest('Self-play is not permitted');
  if (game.status !== 'awaiting_invitation') throw conflict(`Invitations are not open for this game (status ${game.status})`);
  const pending = await ctx.repo.findOne(INVITATIONS, { gameId, status: 'pending' });
  if (pending) throw conflict('A pending invitation already exists for this game');
  const ttl = input?.expiresInMinutes ?? DEFAULT_INVITATION_TTL_MINUTES;
  const invitation = await ctx.repo.insert(INVITATIONS, {
    id: ctx.newId(),
    gameId,
    inviterId: actorId,
    inviteeId: input.inviteeId,
    status: 'pending',
    expiresAt: new Date(new Date(ctx.now()).getTime() + ttl * 60_000).toISOString(),
    respondedAt: null,
  });
  await ctx.audit.record({ action: 'arena.invitation.create', actorId, targetType: 'game', targetId: gameId, detail: { inviteeId: input.inviteeId } });
  return invitation;
}

export async function respondInvitation(ctx: FeatureContext, userId: string, invitationId: string, input: { accept?: boolean } = {}) {
  const inv = await ctx.repo.get(INVITATIONS, invitationId);
  if (!inv) throw notFound('Invitation not found');
  if (inv.status !== 'pending') throw conflict(`This invitation is ${inv.status}`);
  if (new Date(inv.expiresAt).getTime() < new Date(ctx.now()).getTime()) {
    await ctx.repo.update(INVITATIONS, invitationId, { status: 'expired', respondedAt: ctx.now() });
    throw conflict('This invitation has expired');
  }
  if (inv.inviteeId !== userId) throw forbidden('Only the invited player may answer this invitation');
  const accept = input?.accept === true;
  const game = await requireGame(ctx, inv.gameId);
  if (game.status !== 'awaiting_invitation') throw conflict(`The game is no longer awaiting an invitation (status ${game.status})`);

  const updatedInv = await ctx.repo.update(INVITATIONS, invitationId, { status: accept ? 'accepted' : 'declined', respondedAt: ctx.now() });
  const updatedGame = await ctx.repo.update(GAMES, game.id, accept
    ? { status: 'ready', blackPlayerId: userId, invitationAccepted: true, invitationId }
    : { status: 'declined', invitationAccepted: false, invitationId });
  await logEvent(ctx, game.id, accept ? 'arena.invitation.accept' : 'arena.invitation.decline', userId, null);
  await ctx.audit.record({ action: accept ? 'arena.invitation.accept' : 'arena.invitation.decline', actorId: userId, targetType: 'game', targetId: game.id });
  return { game: updatedGame, invitation: updatedInv };
}

export async function startGame(ctx: FeatureContext, userId: string, gameId: string) {
  const game = await requireGame(ctx, gameId);
  if (!sideOf(game, userId)) throw forbidden('Only the two players may start this game');
  if (game.status !== 'ready') throw conflict(`This game cannot start (status ${game.status})`);
  if (!game.blackPlayerId) throw conflict('This game has no opponent yet');
  if (game.mode === 'private' && !game.invitationAccepted) throw conflict('A private game requires an accepted invitation before it can start');
  if (game.mode === 'official' && !game.blockedModeConfirmed) throw conflict('Official supervised games must run in Blocked Mode');
  const updated = await ctx.repo.update(GAMES, gameId, { status: 'live', startedAt: ctx.now() });
  await logEvent(ctx, gameId, 'arena.game.start', userId, null);
  await ctx.audit.record({ action: 'arena.game.start', actorId: userId, targetType: 'game', targetId: gameId });
  return updated;
}

/* --------------------------------------------------------------- completion */

function buildPgn(game: Row, result: string, moves: string[]): string {
  const white = game.whitePlayerId;
  const black = game.blackPlayerId;
  const outcome = result === 'draw' ? '1/2-1/2' : result === 'white' ? '1-0' : '0-1';
  const body = moves
    .map((san, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${san}` : san))
    .join(' ');
  return [`[Event "SaiU Chess Arena"]`, `[White "${white}"]`, `[Black "${black}"]`, `[Result "${outcome}"]`, '', `${body} ${outcome}`.trim()].join('\n');
}

export async function finalizeGame(
  ctx: FeatureContext,
  userId: string,
  gameId: string,
  input: { result?: string; reason?: string; pgn?: string; moves?: string[] },
) {
  const game = await requireGame(ctx, gameId);
  if (!sideOf(game, userId)) throw forbidden('Only the two players may finalise this game');
  if (game.status === 'completed') throw conflict('This game is already completed');
  if (game.status !== 'live') throw conflict(`This game cannot be finalised (status ${game.status})`);
  const result = input?.result;
  if (!(RESULTS as readonly string[]).includes(result as string)) throw badRequest('result must be white, black or draw');

  const moves = Array.isArray(input?.moves) ? input!.moves!.map((m) => String(m)) : [];
  const pgn = (input?.pgn && input.pgn.trim()) || (moves.length ? buildPgn(game, result as string, moves) : '');
  if (!pgn) throw badRequest('A PGN (or the move list) is required to complete a game');

  const appliesRating = game.ratingImpact === true;
  const updated = await ctx.repo.update(GAMES, gameId, {
    status: 'completed',
    result,
    resultReason: input?.reason?.trim() || 'game completed',
    pgn,
    moves,
    endedAt: ctx.now(),
    ratingApplied: appliesRating,
    ratingAppliedAt: appliesRating ? ctx.now() : null,
    ratingPipelineStatus: appliesRating ? 'queued' : 'not_applicable',
  });
  await logEvent(ctx, gameId, 'arena.game.finalize', userId, { result, ratingApplied: appliesRating });
  await ctx.audit.record({
    action: 'arena.game.finalize',
    actorId: userId,
    targetType: 'game',
    targetId: gameId,
    detail: { result, ratingApplied: appliesRating },
  });
  return updated;
}

/* ------------------------------------------------------ disconnect / reconnect */

export async function recordDisconnect(ctx: FeatureContext, userId: string, gameId: string) {
  const game = await requireGame(ctx, gameId);
  const side = sideOf(game, userId);
  if (!side) throw forbidden('Only the two players have connection state');
  if (game.status !== 'live') throw conflict(`Connection state only applies to a live game (status ${game.status})`);
  const updated = await ctx.repo.update(GAMES, gameId, {
    disconnectedSide: side,
    disconnectedAt: ctx.now(),
    clockBehavior: CLOCK_BEHAVIOR_ON_DISCONNECT,
  });
  await logEvent(ctx, gameId, 'arena.game.disconnect', userId, { side, clockBehavior: CLOCK_BEHAVIOR_ON_DISCONNECT });
  await ctx.audit.record({ action: 'arena.game.disconnect', actorId: userId, targetType: 'game', targetId: gameId, detail: { side } });
  return { game: updated, clockBehavior: CLOCK_BEHAVIOR_ON_DISCONNECT, clock: updated.clock };
}

export async function recordReconnect(ctx: FeatureContext, userId: string, gameId: string) {
  const game = await requireGame(ctx, gameId);
  const side = sideOf(game, userId);
  if (!side) throw forbidden('Only the two players have connection state');
  const updated = await ctx.repo.update(GAMES, gameId, { disconnectedSide: null, disconnectedAt: null, reconnectedAt: ctx.now() });
  await logEvent(ctx, gameId, 'arena.game.reconnect', userId, { side });
  await ctx.audit.record({ action: 'arena.game.reconnect', actorId: userId, targetType: 'game', targetId: gameId, detail: { side } });
  return { game: updated, clock: updated.clock, authoritative: true };
}

/* ------------------------------------------------------------------ reports */

export async function submitReport(ctx: FeatureContext, userId: string, gameId: string, input: { category?: string; detail?: string }) {
  const game = await requireGame(ctx, gameId);
  if (!(REPORT_CATEGORIES as readonly string[]).includes(input?.category as string)) {
    throw badRequest(`category must be one of: ${REPORT_CATEGORIES.join(', ')}`);
  }
  if (!input?.detail?.trim()) throw badRequest('detail is required');
  const report = await ctx.repo.insert(REPORTS, {
    id: ctx.newId(),
    gameId,
    tournamentId: game.tournamentId ?? null,
    reportedBy: userId,
    category: input.category,
    detail: input.detail.trim(),
    status: 'submitted',
    isFinding: false,
    sanctionApplied: false,
    reviewedBy: null,
    reviewedAt: null,
    outcome: null,
    reviewNote: null,
  });
  await logEvent(ctx, gameId, 'arena.report.submit', userId, { category: input.category });
  await ctx.audit.record({ action: 'arena.report.submit', actorId: userId, targetType: 'report', targetId: report.id, detail: { category: input.category } });
  return report;
}

export async function reviewReport(ctx: FeatureContext, actorId: string, reportId: string, input: { outcome?: string; note?: string }) {
  const report = await ctx.repo.get(REPORTS, reportId);
  if (!report) throw notFound('Report not found');
  if (report.status === 'reviewed') throw conflict('This report has already been reviewed');
  if (report.reportedBy === actorId) throw forbidden('Separation of duties: you cannot review your own report');
  if (!(REVIEW_OUTCOMES as readonly string[]).includes(input?.outcome as string)) {
    throw badRequest(`outcome must be one of: ${REVIEW_OUTCOMES.join(', ')}`);
  }
  if (!input?.note?.trim()) throw badRequest('A review note is required');
  const updated = await ctx.repo.update(REPORTS, reportId, {
    status: 'reviewed',
    outcome: input.outcome,
    reviewNote: input.note.trim(),
    reviewedBy: actorId,
    reviewedAt: ctx.now(),
    isFinding: input.outcome !== 'no_action',
    sanctionApplied: input.outcome === 'warning_issued',
  });
  await ctx.audit.record({ action: 'arena.report.review', actorId, targetType: 'report', targetId: reportId, detail: { outcome: input.outcome } });
  return updated;
}

/* -------------------------------------------------------------------- reads */

export async function getGame(ctx: FeatureContext, gameId: string, userId: string) {
  const game = await requireGame(ctx, gameId);
  const isPlayer = !!sideOf(game, userId);
  if (!isPlayer && game.status === 'live') {
    // live state is not leaked to non-players
    return { ...game, moves: [], pgn: null, clock: null, spectating: 'delayed_required' };
  }
  return game;
}

export async function lobby(ctx: FeatureContext, filter: { mode?: string; category?: string } = {}) {
  const f: Row = { status: 'open' };
  if (filter.mode) f.mode = filter.mode;
  const rows = await ctx.repo.find(GAMES, f, { orderBy: 'createdAt', desc: true });
  return filter.category ? rows.filter((g: Row) => g.timeControl?.category === filter.category) : rows;
}

export async function history(ctx: FeatureContext, userId: string, limit = 20, offset = 0) {
  const all = await ctx.repo.find(GAMES, { status: 'completed' }, { orderBy: 'createdAt', desc: true });
  const mine = all.filter((g: Row) => g.whitePlayerId === userId || g.blackPlayerId === userId);
  return { items: mine.slice(offset, offset + limit), total: mine.length, limit, offset };
}

export async function getPgn(ctx: FeatureContext, gameId: string, userId: string) {
  const game = await requireGame(ctx, gameId);
  if (!sideOf(game, userId) && game.status === 'live') throw forbidden('Live game data is not available to non-players');
  if (!game.pgn) throw notFound('No PGN is stored for this game yet');
  return { gameId, pgn: game.pgn, result: game.result };
}

export async function listReports(ctx: FeatureContext, filter: { status?: string; gameId?: string } = {}) {
  const f: Row = {};
  if (filter.status) f.status = filter.status;
  if (filter.gameId) f.gameId = filter.gameId;
  return ctx.repo.find(REPORTS, f, { orderBy: 'createdAt', desc: true });
}
