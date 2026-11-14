import type { FeatureContext } from '../../core/types.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';

/**
 * Feature 06 — Player Profiles, Ratings & Leaderboards
 *
 * Tables (created implicitly on first insert):
 *   player_profiles    one row per player: ratings per pool, peaks, W/D/L, privacy, eligibility
 *   rating_history     one row per rating change (result, correction) with before/after/delta
 *   rated_results      idempotency ledger — a source result may affect ratings exactly once
 *   rating_corrections official correction requests (queued, audited, reasoned)
 *
 * Rating model: separate Bullet / Blitz / Rapid pools. Deterministic Elo-style update with
 * integer storage, K-factor rules, floor/ceiling. Glicko-2 is the documented target
 * algorithm in the spec but is explicitly "to be validated with test datasets" — this module
 * ships the deterministic Elo calculation the platform uses until that validation lands.
 */

export const PROFILES = 'player_profiles';
export const HISTORY = 'rating_history';
export const RESULTS = 'rated_results';
export const CORRECTIONS = 'rating_corrections';

export const POOLS = ['bullet', 'blitz', 'rapid'] as const;
export type Pool = (typeof POOLS)[number];

export const DEFAULT_RATING = 1200;
export const RATING_FLOOR = 100;
export const RATING_CEILING = 3000;

const DEFAULT_PRIVACY = {
  showContactEmail: false,
  showDepartment: false,
  showTournamentHistory: false,
};

export function ratingField(pool: string) {
  return `${pool}Rating`;
}
export function peakField(pool: string) {
  return `${pool}Peak`;
}
export function gamesField(pool: string) {
  return `${pool}Games`;
}

export function assertPool(pool: any): Pool {
  if (!POOLS.includes(pool)) throw badRequest(`pool must be one of: ${POOLS.join(', ')}`);
  return pool as Pool;
}

/**
 * K-factor rules (documented configuration):
 *   - a player with fewer than 30 rated games in the pool is provisional  -> K = 40
 *   - established player rated below 2400                                 -> K = 20
 *   - established player rated 2400 or above                              -> K = 10
 */
export function kFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < 30) return 40;
  if (rating >= 2400) return 10;
  return 20;
}

/** Expected score of `a` against `b`, in thousandths (integer, deterministic). */
export function expectedScoreMilli(a: number, b: number): number {
  const e = 1 / (1 + Math.pow(10, -(a - b) / 400));
  return Math.round(e * 1000);
}

/** Integer rating delta for a game. `score` is 1, 0.5 or 0. */
export function eloDelta(rating: number, opponentRating: number, score: number, k: number): number {
  const exp = expectedScoreMilli(rating, opponentRating);
  const scoreMilli = Math.round(score * 1000);
  return Math.round((k * (scoreMilli - exp)) / 1000);
}

export function clampRating(r: number): number {
  const v = Math.round(r);
  if (!Number.isFinite(v)) return DEFAULT_RATING;
  return Math.min(RATING_CEILING, Math.max(RATING_FLOOR, v));
}

const SCORES: Record<string, number> = { '1-0': 1, '0-1': 0, '1/2-1/2': 0.5 };

export async function ensureProfile(ctx: FeatureContext, userId: string) {
  if (!userId) throw badRequest('userId is required');
  const existing = await ctx.repo.findOne(PROFILES, { userId });
  if (existing) return existing;
  return ctx.repo.insert(PROFILES, {
    id: ctx.newId(),
    userId,
    displayName: null,
    clubId: null,
    contactEmail: null,
    department: null,
    departmentVerified: false,
    bulletRating: DEFAULT_RATING,
    blitzRating: DEFAULT_RATING,
    rapidRating: DEFAULT_RATING,
    bulletPeak: DEFAULT_RATING,
    blitzPeak: DEFAULT_RATING,
    rapidPeak: DEFAULT_RATING,
    bulletGames: 0,
    blitzGames: 0,
    rapidGames: 0,
    gamesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    membershipStatus: 'active',
    hasOpenDispute: false,
    privacy: { ...DEFAULT_PRIVACY },
    achievements: [],
    certificates: [],
    tournamentHistory: [],
    createdAt: ctx.now(),
  });
}

export interface ProfileInput {
  displayName?: string;
  clubId?: string;
  contactEmail?: string;
  department?: string;
  privacy?: Record<string, boolean>;
}

export async function upsertProfile(ctx: FeatureContext, actorId: string, input: ProfileInput) {
  const p = await ensureProfile(ctx, actorId);
  const patch: Record<string, any> = {};

  if (input?.displayName !== undefined) {
    if (typeof input.displayName !== 'string' || !input.displayName.trim()) throw badRequest('displayName must be a non-empty string');
    if (input.displayName.trim().length > 80) throw badRequest('displayName must be 80 characters or fewer');
    patch.displayName = input.displayName.trim();
  }
  if (input?.clubId !== undefined) {
    if (typeof input.clubId !== 'string' || !input.clubId.trim()) throw badRequest('clubId must be a non-empty string');
    patch.clubId = input.clubId.trim();
  }
  if (input?.contactEmail !== undefined) {
    if (typeof input.contactEmail !== 'string' || !/.+@.+/.test(input.contactEmail)) throw badRequest('contactEmail must be a valid email address');
    patch.contactEmail = input.contactEmail.trim();
  }
  if (input?.department !== undefined) {
    if (typeof input.department !== 'string' || !input.department.trim()) throw badRequest('department must be a non-empty string');
    // A self-declared department is never treated as verified data.
    patch.department = input.department.trim();
    patch.departmentVerified = false;
  }
  if (input?.privacy !== undefined) {
    if (!input.privacy || typeof input.privacy !== 'object') throw badRequest('privacy must be an object');
    const next: Record<string, boolean> = { ...(p.privacy || DEFAULT_PRIVACY) };
    for (const key of Object.keys(DEFAULT_PRIVACY)) {
      if (input.privacy[key] !== undefined) {
        if (typeof input.privacy[key] !== 'boolean') throw badRequest(`privacy.${key} must be a boolean`);
        next[key] = input.privacy[key];
      }
    }
    patch.privacy = next;
  }

  const updated = await ctx.repo.update(PROFILES, p.id, patch);
  await ctx.audit.record({
    action: 'rating.profile.update',
    actorId,
    targetType: 'player_profile',
    targetId: p.id,
    detail: { fields: Object.keys(patch) },
  });
  return publicProfile(updated, actorId, ['*']);
}

/** Public projection. Private contact / evidence / recovery fields are never emitted. */
export function publicProfile(p: any, viewerId: string | null, perms: string[] = []) {
  const isOwner = !!viewerId && viewerId === p.userId;
  const isAdmin = perms.includes('*');
  const priv = p.privacy || DEFAULT_PRIVACY;
  const out: Record<string, any> = {
    userId: p.userId,
    clubId: p.clubId,
    displayName: p.displayName,
    ratings: { bullet: p.bulletRating, blitz: p.blitzRating, rapid: p.rapidRating },
    peaks: { bullet: p.bulletPeak, blitz: p.blitzPeak, rapid: p.rapidPeak },
    games: { bullet: p.bulletGames, blitz: p.blitzGames, rapid: p.rapidGames },
    gamesPlayed: p.gamesPlayed,
    wins: p.wins,
    draws: p.draws,
    losses: p.losses,
    achievements: p.achievements || [],
    certificates: p.certificates || [],
  };
  if (isOwner || isAdmin) out.membershipStatus = p.membershipStatus;
  if (isOwner || isAdmin || priv.showContactEmail) out.contactEmail = p.contactEmail;
  if ((isOwner || isAdmin || priv.showDepartment) && p.departmentVerified) out.department = p.department;
  if (isOwner || isAdmin || priv.showTournamentHistory) out.tournamentHistory = p.tournamentHistory || [];
  return out;
}

export async function getProfile(ctx: FeatureContext, viewerId: string | null, perms: string[], userId: string) {
  if (!userId) throw badRequest('userId is required');
  const p = await ctx.repo.findOne(PROFILES, { userId });
  if (!p) throw notFound('Player profile not found');
  return publicProfile(p, viewerId, perms);
}

export async function listHistory(ctx: FeatureContext, userId: string, pool?: string) {
  if (!userId) throw badRequest('userId is required');
  const filter: Record<string, any> = { userId };
  if (pool) filter.pool = assertPool(pool);
  const rows = await ctx.repo.find(HISTORY, filter);
  return rows.sort((a: any, b: any) => String(b.at || '').localeCompare(String(a.at || '')));
}

export interface RatedResultInput {
  sourceResultId: string;
  pool: string;
  whiteId: string;
  blackId: string;
  result: string;
  finalized?: boolean;
  rated?: boolean;
  kind?: string;
  tournamentId?: string;
  tournamentRatingsEnabled?: boolean;
}

/**
 * Apply a finalized, eligible result to both players' ratings in one pool.
 * Friendly/practice games, unfinalized games and disabled tournament ratings never move ratings.
 * A given source result can be applied only once (rated_results ledger).
 */
export async function recordRatedResult(ctx: FeatureContext, actorId: string, input: RatedResultInput) {
  const pool = assertPool(input?.pool);
  const kind = input?.kind || 'rated';
  if (kind === 'friendly' || kind === 'practice') throw conflict('Friendly and practice games do not affect ratings');
  if (!input?.sourceResultId) throw badRequest('sourceResultId is required');
  if (!input.whiteId || !input.blackId) throw badRequest('whiteId and blackId are required');
  if (input.whiteId === input.blackId) throw badRequest('A player cannot be rated against themselves');
  const score = SCORES[input?.result];
  if (score === undefined) throw badRequest('result must be one of: 1-0, 0-1, 1/2-1/2');
  if (input.finalized !== true) throw conflict('Only finalized games affect ratings');
  if (input.rated === false) throw conflict('This game is not a rated game');
  if (input.tournamentId && input.tournamentRatingsEnabled === false) {
    throw conflict('Official ratings are not enabled in this tournament configuration');
  }

  const already = await ctx.repo.findOne(RESULTS, { sourceResultId: input.sourceResultId });
  if (already) throw conflict('This result has already been applied to ratings', { sourceResultId: input.sourceResultId });

  const white = await ensureProfile(ctx, input.whiteId);
  const black = await ensureProfile(ctx, input.blackId);

  const rf = ratingField(pool);
  const gf = gamesField(pool);
  const pf = peakField(pool);

  const wBefore = Number(white[rf] ?? DEFAULT_RATING);
  const bBefore = Number(black[rf] ?? DEFAULT_RATING);
  const wGames = Number(white[gf] ?? 0);
  const bGames = Number(black[gf] ?? 0);

  const wDelta = eloDelta(wBefore, bBefore, score, kFactor(wBefore, wGames));
  const bDelta = eloDelta(bBefore, wBefore, 1 - score, kFactor(bBefore, bGames));
  const wAfter = clampRating(wBefore + wDelta);
  const bAfter = clampRating(bBefore + bDelta);

  const appliedAt = ctx.now();
  const ledger = await ctx.repo.insert(RESULTS, {
    id: ctx.newId(),
    sourceResultId: input.sourceResultId,
    pool,
    whiteId: input.whiteId,
    blackId: input.blackId,
    result: input.result,
    kind,
    tournamentId: input.tournamentId || null,
    appliedBy: actorId,
    appliedAt,
  });

  const wOutcome = score === 1 ? 'win' : score === 0 ? 'loss' : 'draw';
  const bOutcome = score === 1 ? 'loss' : score === 0 ? 'win' : 'draw';

  await ctx.repo.update(PROFILES, white.id, {
    [rf]: wAfter,
    [pf]: Math.max(Number(white[pf] ?? DEFAULT_RATING), wAfter),
    [gf]: wGames + 1,
    gamesPlayed: Number(white.gamesPlayed ?? 0) + 1,
    wins: Number(white.wins ?? 0) + (wOutcome === 'win' ? 1 : 0),
    draws: Number(white.draws ?? 0) + (wOutcome === 'draw' ? 1 : 0),
    losses: Number(white.losses ?? 0) + (wOutcome === 'loss' ? 1 : 0),
  });
  await ctx.repo.update(PROFILES, black.id, {
    [rf]: bAfter,
    [pf]: Math.max(Number(black[pf] ?? DEFAULT_RATING), bAfter),
    [gf]: bGames + 1,
    gamesPlayed: Number(black.gamesPlayed ?? 0) + 1,
    wins: Number(black.wins ?? 0) + (bOutcome === 'win' ? 1 : 0),
    draws: Number(black.draws ?? 0) + (bOutcome === 'draw' ? 1 : 0),
    losses: Number(black.losses ?? 0) + (bOutcome === 'loss' ? 1 : 0),
  });

  const historyRows = [
    await ctx.repo.insert(HISTORY, {
      id: ctx.newId(),
      userId: input.whiteId,
      pool,
      before: wBefore,
      after: wAfter,
      delta: wAfter - wBefore,
      kind: 'result',
      sourceResultId: input.sourceResultId,
      opponentId: input.blackId,
      result: input.result,
      at: appliedAt,
    }),
    await ctx.repo.insert(HISTORY, {
      id: ctx.newId(),
      userId: input.blackId,
      pool,
      before: bBefore,
      after: bAfter,
      delta: bAfter - bBefore,
      kind: 'result',
      sourceResultId: input.sourceResultId,
      opponentId: input.whiteId,
      result: input.result,
      at: appliedAt,
    }),
  ];

  await ctx.audit.record({
    action: 'rating.result.apply',
    actorId,
    targetType: 'rated_result',
    targetId: ledger.id,
    detail: { pool, sourceResultId: input.sourceResultId, white: wAfter, black: bAfter },
  });

  return { ledger, history: historyRows, ratings: { white: { before: wBefore, after: wAfter }, black: { before: bBefore, after: bAfter } } };
}

export interface CorrectionInput {
  userId: string;
  pool: string;
  newRating: number;
  reason: string;
}

/** Official rating correction: authorized, reasoned and audited. */
export async function requestCorrection(ctx: FeatureContext, actorId: string, input: CorrectionInput) {
  const pool = assertPool(input?.pool);
  if (!input?.userId) throw badRequest('userId is required');
  if (!input?.reason || !String(input.reason).trim()) throw badRequest('A reason is required for a rating correction');
  const target = Number(input?.newRating);
  if (!Number.isInteger(target)) throw badRequest('newRating must be an integer');
  if (target < RATING_FLOOR || target > RATING_CEILING) {
    throw badRequest(`newRating must be between ${RATING_FLOOR} and ${RATING_CEILING}`);
  }

  const p = await ensureProfile(ctx, input.userId);
  const rf = ratingField(pool);
  const pf = peakField(pool);
  const before = Number(p[rf] ?? DEFAULT_RATING);
  if (before === target) throw conflict('The requested rating equals the current rating');

  const request = await ctx.repo.insert(CORRECTIONS, {
    id: ctx.newId(),
    userId: input.userId,
    pool,
    before,
    newRating: target,
    reason: String(input.reason).trim(),
    requestedBy: actorId,
    status: 'applied',
    createdAt: ctx.now(),
  });

  const updated = await ctx.repo.update(PROFILES, p.id, {
    [rf]: target,
    [pf]: Math.max(Number(p[pf] ?? DEFAULT_RATING), target),
  });

  await ctx.repo.insert(HISTORY, {
    id: ctx.newId(),
    userId: input.userId,
    pool,
    before,
    after: target,
    delta: target - before,
    kind: 'correction',
    correctionId: request.id,
    reason: String(input.reason).trim(),
    actorId,
    at: ctx.now(),
  });

  await ctx.audit.record({
    action: 'rating.correction.apply',
    actorId,
    targetType: 'player_profile',
    targetId: p.id,
    detail: { pool, before, after: target, reason: String(input.reason).trim() },
  });

  return { request, profile: updated };
}

export async function listCorrections(ctx: FeatureContext) {
  return ctx.repo.find(CORRECTIONS, {}, { orderBy: 'createdAt', desc: true });
}

export interface LeaderboardQuery {
  pool?: string;
  department?: string;
  minGames?: number;
  limit?: number;
  offset?: number;
}

/**
 * Leaderboard: university-wide, optional verified-department filter, season/archived snapshots
 * are served by feature 08. Disputed games, unfinalized games and non-active members are excluded.
 * Tie display: equal ratings are ordered by games played, then wins, then userId for stability.
 */
export async function leaderboard(ctx: FeatureContext, q: LeaderboardQuery = {}) {
  const pool = q.pool ? assertPool(q.pool) : 'rapid';
  const minGames = Number.isFinite(Number(q.minGames)) ? Math.max(0, Number(q.minGames)) : 0;
  const limit = Number.isFinite(Number(q.limit)) ? Math.max(1, Number(q.limit)) : 25;
  const offset = Number.isFinite(Number(q.offset)) ? Math.max(0, Number(q.offset)) : 0;

  const rf = ratingField(pool);
  const gf = gamesField(pool);
  const all = await ctx.repo.find(PROFILES, {});

  const eligible = all.filter((p: any) => {
    if (p.hasOpenDispute === true) return false;
    if (p.membershipStatus && p.membershipStatus !== 'active') return false;
    if (Number(p[gf] ?? 0) < minGames) return false;
    if (q.department) {
      if (!p.departmentVerified) return false;
      if (p.department !== q.department) return false;
    }
    return true;
  });

  eligible.sort((a: any, b: any) => {
    const ra = Number(a[rf] ?? DEFAULT_RATING);
    const rb = Number(b[rf] ?? DEFAULT_RATING);
    if (rb !== ra) return rb - ra;
    const ga = Number(a[gf] ?? 0);
    const gb = Number(b[gf] ?? 0);
    if (gb !== ga) return gb - ga;
    const wa = Number(a.wins ?? 0);
    const wb = Number(b.wins ?? 0);
    if (wb !== wa) return wb - wa;
    return String(a.userId).localeCompare(String(b.userId));
  });

  const rows = eligible.map((p: any, i: number) => ({
    rank: i + 1,
    userId: p.userId,
    displayName: p.displayName,
    rating: Number(p[rf] ?? DEFAULT_RATING),
    peak: Number(p[peakField(pool)] ?? DEFAULT_RATING),
    games: Number(p[gf] ?? 0),
    wins: Number(p.wins ?? 0),
    draws: Number(p.draws ?? 0),
    losses: Number(p.losses ?? 0),
    department: p.departmentVerified ? p.department : null,
  }));

  return { pool, minGames, items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

/** Flags a player as having an open dispute so they drop out of published rankings. */
export async function markDisputed(ctx: FeatureContext, actorId: string, userId: string, open = true) {
  const p = await ctx.repo.findOne(PROFILES, { userId });
  if (!p) throw notFound('Player profile not found');
  const updated = await ctx.repo.update(PROFILES, p.id, { hasOpenDispute: !!open });
  await ctx.audit.record({
    action: open ? 'rating.dispute.open' : 'rating.dispute.close',
    actorId,
    targetType: 'player_profile',
    targetId: p.id,
  });
  return updated;
}
