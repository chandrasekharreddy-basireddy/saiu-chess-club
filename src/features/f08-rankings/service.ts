import type { FeatureContext } from '../../core/types.js';
import { badRequest, conflict, notFound, forbidden, unprocessable } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 08 — Rankings, Championships & Seasonal Awards
 *
 * Tables (created implicitly on first insert):
 *   championship_seasons     a season / annual championship with published criteria and a status
 *   award_categories         award definitions (kind, period, min games, rating pool, criteria)
 *   season_points            finalized season results converted to points (idempotent per result)
 *   season_rating_entries    rating baseline/end snapshots used by Most Improved
 *   award_nominations        documented nominations (required for sportsmanship)
 *   award_winners            approved + published winners with unique certificate IDs
 *
 * Workflow enforced here: configure season -> publish criteria -> collect finalized results /
 * nominations -> calculate candidates -> human approval -> publish winner -> archive.
 * Automated suggestions only ever read finalized, eligible records; a human approval step
 * (with separation of duties) always precedes publication.
 */

export const SEASONS = 'championship_seasons';
export const CATEGORIES = 'award_categories';
export const POINTS = 'season_points';
export const RATING_ENTRIES = 'season_rating_entries';
export const NOMINATIONS = 'award_nominations';
export const WINNERS = 'award_winners';

export const AWARD_KINDS = [
  'club_champion',
  'season_champion',
  'department_champion',
  'interdepartment_team',
  'player_of_the_year',
  'most_improved',
  'sportsmanship',
  'team_recognition',
  'hall_of_fame',
] as const;

export const POOLS = ['bullet', 'blitz', 'rapid'];

const OUTCOME_POINTS: Record<string, number> = { win: 3, draw: 1, loss: 0 };

export async function createSeason(ctx: FeatureContext, actorId: string, input: any) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('Season name is required');
  if (!input?.startsAt || !input?.endsAt) throw badRequest('startsAt and endsAt are required');
  if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
    throw badRequest('endsAt must be after startsAt');
  }
  const season = await ctx.repo.insert(SEASONS, {
    id: ctx.newId(),
    name,
    year: Number(input?.year ?? new Date(input.startsAt).getUTCFullYear()),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: 'draft',
    criteriaPublishedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'rankings.season.create', actorId, targetType: 'championship_season', targetId: season.id, detail: { name } });
  return season;
}

export async function listSeasons(ctx: FeatureContext) {
  return ctx.repo.find(SEASONS, {}, { orderBy: 'createdAt', desc: true });
}

async function seasonOr404(ctx: FeatureContext, seasonId: string) {
  const season = await ctx.repo.get(SEASONS, seasonId);
  if (!season) throw notFound('Season not found');
  return season;
}

export async function getSeason(ctx: FeatureContext, seasonId: string) {
  const season = await seasonOr404(ctx, seasonId);
  const categories = await ctx.repo.find(CATEGORIES, { seasonId });
  const winners = await ctx.repo.find(WINNERS, { seasonId });
  return { ...season, categories, winners };
}

export async function addCategory(ctx: FeatureContext, actorId: string, seasonId: string, input: any) {
  const season = await seasonOr404(ctx, seasonId);
  if (season.status === 'archived') throw conflict('Archived seasons cannot be modified');
  const kind = String(input?.kind ?? '');
  if (!AWARD_KINDS.includes(kind as any)) throw badRequest(`kind must be one of: ${AWARD_KINDS.join(', ')}`);
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('Category name is required');
  const minGames = input?.minGames === undefined ? 0 : Number(input.minGames);
  if (!Number.isInteger(minGames) || minGames < 0) throw badRequest('minGames must be a non-negative integer');
  const pool = input?.pool === undefined ? null : String(input.pool);
  if (pool && !POOLS.includes(pool)) throw badRequest(`pool must be one of: ${POOLS.join(', ')}`);

  const category = await ctx.repo.insert(CATEGORIES, {
    id: ctx.newId(),
    seasonId,
    kind,
    name,
    minGames,
    pool,
    baselineStart: input?.baselineStart ?? season.startsAt,
    baselineEnd: input?.baselineEnd ?? season.endsAt,
    criteria: input?.criteria ?? {},
    criteriaPublishedAt: null,
    status: 'draft',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'rankings.category.create', actorId, targetType: 'award_category', targetId: category.id, detail: { seasonId, kind } });
  return category;
}

/** Criteria must be published before the award period begins. */
export async function publishCriteria(ctx: FeatureContext, actorId: string, seasonId: string) {
  const season = await seasonOr404(ctx, seasonId);
  if (season.status === 'archived') throw conflict('Archived seasons cannot be modified');
  if (season.criteriaPublishedAt) throw conflict('Award criteria are already published for this season');
  if (new Date(ctx.now()).getTime() > new Date(season.startsAt).getTime()) {
    throw conflict('Award criteria must be published before the award period begins');
  }
  const categories = await ctx.repo.find(CATEGORIES, { seasonId });
  if (!categories.length) throw conflict('Define at least one award category before publishing criteria');
  const at = ctx.now();
  for (const cat of categories) {
    await ctx.repo.update(CATEGORIES, cat.id, { criteriaPublishedAt: at, status: 'published' });
  }
  const updated = await ctx.repo.update(SEASONS, seasonId, { criteriaPublishedAt: at, status: 'criteria_published' });
  await ctx.audit.record({ action: 'rankings.criteria.publish', actorId, targetType: 'championship_season', targetId: seasonId, detail: { categories: categories.length } });
  return updated;
}

export async function recordSeasonPoints(ctx: FeatureContext, actorId: string, seasonId: string, input: any) {
  const season = await seasonOr404(ctx, seasonId);
  if (season.status === 'archived') throw conflict('Archived seasons cannot be modified');
  if (!input?.userId) throw badRequest('userId is required');
  if (!input?.resultId) throw badRequest('resultId is required');
  const outcome = String(input?.outcome ?? '');
  if (OUTCOME_POINTS[outcome] === undefined) throw badRequest('outcome must be one of: win, draw, loss');
  if (input?.finalized !== true) throw conflict('Only finalized results feed seasonal rankings');
  if (input?.disputed === true) throw conflict('Disputed results cannot feed seasonal rankings');

  const dupe = await ctx.repo.findOne(POINTS, { resultId: String(input.resultId), userId: input.userId });
  if (dupe) throw conflict('This result has already been scored for this player');

  const row = await ctx.repo.insert(POINTS, {
    id: ctx.newId(),
    seasonId,
    userId: input.userId,
    resultId: String(input.resultId),
    outcome,
    points: OUTCOME_POINTS[outcome],
    tournamentId: input?.tournamentId ?? null,
    recordedBy: actorId,
    recordedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'rankings.points.record', actorId, targetType: 'season_points', targetId: row.id, detail: { seasonId, userId: input.userId, outcome } });
  return row;
}

/** Seasonal leaderboard: points desc, wins desc, then userId for a stable tie display. */
export async function seasonLeaderboard(ctx: FeatureContext, seasonId: string) {
  const season = await seasonOr404(ctx, seasonId);
  const rows = await ctx.repo.find(POINTS, { seasonId });
  const byUser = new Map<string, { userId: string; points: number; wins: number; draws: number; losses: number; games: number }>();
  for (const r of rows) {
    const cur = byUser.get(r.userId) || { userId: r.userId, points: 0, wins: 0, draws: 0, losses: 0, games: 0 };
    cur.points += Number(r.points ?? 0);
    cur.games += 1;
    if (r.outcome === 'win') cur.wins += 1;
    else if (r.outcome === 'draw') cur.draws += 1;
    else cur.losses += 1;
    byUser.set(r.userId, cur);
  }
  const items = [...byUser.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.userId.localeCompare(b.userId);
  }).map((r, i) => ({ rank: i + 1, ...r }));
  return { seasonId, season: season.name, items, total: items.length };
}

export async function nominate(ctx: FeatureContext, actorId: string, seasonId: string, categoryId: string, input: any) {
  await seasonOr404(ctx, seasonId);
  const category = await ctx.repo.get(CATEGORIES, categoryId);
  if (!category || category.seasonId !== seasonId) throw notFound('Award category not found');
  if (!category.criteriaPublishedAt) throw conflict('Criteria must be published before nominations open');
  const nominatedUserId = String(input?.nominatedUserId ?? '');
  if (!nominatedUserId) throw badRequest('nominatedUserId is required');
  const reason = String(input?.reason ?? '').trim();
  if (!reason) throw badRequest('A documented reason is required for a nomination');

  const dupe = await ctx.repo.findOne(NOMINATIONS, { seasonId, categoryId, nominatedUserId });
  if (dupe) throw conflict('This player is already nominated for the category');

  const row = await ctx.repo.insert(NOMINATIONS, {
    id: ctx.newId(),
    seasonId,
    categoryId,
    nominatedUserId,
    nominatedBy: actorId,
    reason,
    status: 'nominated',
    reviewedBy: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'rankings.nomination.create', actorId, targetType: 'award_nomination', targetId: row.id, detail: { seasonId, categoryId, nominatedUserId } });
  return row;
}

/**
 * Automated candidate suggestion from finalized records only.
 * Sportsmanship never gets an automated behavioural score — candidates come from nominations.
 */
export interface AwardCandidate {
  userId: string;
  score: number;
  basis: string;
  detail: any;
}

export async function computeCandidates(ctx: FeatureContext, seasonId: string, categoryId: string): Promise<AwardCandidate[]> {
  const category = await ctx.repo.get(CATEGORIES, categoryId);
  if (!category || category.seasonId !== seasonId) throw notFound('Award category not found');
  const minGames = Number(category.minGames ?? 0);

  if (category.kind === 'sportsmanship' || category.kind === 'team_recognition' || category.kind === 'hall_of_fame') {
    const noms = await ctx.repo.find(NOMINATIONS, { seasonId, categoryId });
    return noms.map((n) => ({ userId: n.nominatedUserId, score: 0, basis: 'nomination', detail: { reason: n.reason, nominatedBy: n.nominatedBy } }));
  }

  if (category.kind === 'most_improved') {
    const entries = await ctx.repo.find(RATING_ENTRIES, { seasonId });
    const pool = category.pool || 'rapid';
    const filtered = entries.filter((e) => (e.pool || 'rapid') === pool);
    const byUser = new Map<string, { start: number; end: number; games: number; at: string }>();
    for (const e of filtered) {
      const cur = byUser.get(e.userId);
      if (!cur) {
        byUser.set(e.userId, { start: Number(e.startRating ?? 0), end: Number(e.endRating ?? 0), games: Number(e.games ?? 0), at: String(e.recordedAt || '') });
      } else {
        cur.end = Number(e.endRating ?? cur.end);
        cur.games += Number(e.games ?? 0);
      }
    }
    return [...byUser.entries()]
      .filter(([, v]) => v.games >= minGames)
      .map(([userId, v]) => ({ userId, score: v.end - v.start, basis: 'rating_delta', detail: { pool, start: v.start, end: v.end, games: v.games, baselineStart: category.baselineStart, baselineEnd: category.baselineEnd } }))
      .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  }

  const board = await seasonLeaderboard(ctx, seasonId);
  return board.items
    .filter((r) => r.games >= minGames)
    .map((r) => ({ userId: r.userId, score: r.points, basis: 'season_points', detail: { points: r.points, wins: r.wins, games: r.games } }));
}

export async function listCandidates(ctx: FeatureContext, seasonId: string, categoryId: string) {
  const candidates = await computeCandidates(ctx, seasonId, categoryId);
  return { seasonId, categoryId, candidates, total: candidates.length };
}

function sod(actorId: string, otherId: string | null | undefined, what: string) {
  try {
    assertNotSelfApproval(actorId, String(otherId ?? ''), what);
  } catch (e: any) {
    throw forbidden(e?.message || 'Separation of duties violation');
  }
}

/** Human approval precedes publication. Certificate verification IDs are unique. */
export async function approveWinner(ctx: FeatureContext, actorId: string, seasonId: string, categoryId: string, input: any) {
  const season = await seasonOr404(ctx, seasonId);
  if (season.status === 'archived') throw conflict('Archived seasons cannot be modified');
  const category = await ctx.repo.get(CATEGORIES, categoryId);
  if (!category || category.seasonId !== seasonId) throw notFound('Award category not found');
  if (!category.criteriaPublishedAt) throw conflict('Award criteria must be published before a winner can be approved');

  const userId = String(input?.userId ?? '');
  if (!userId) throw badRequest('userId is required');

  const existing = await ctx.repo.findOne(WINNERS, { seasonId, categoryId });
  if (existing) throw conflict('A winner has already been approved for this category');

  const candidates = await computeCandidates(ctx, seasonId, categoryId);
  const candidate = candidates.find((c) => c.userId === userId);
  if (!candidate) throw unprocessable('The nominated player is not an eligible candidate for this award');

  sod(actorId, userId, 'an award for yourself');
  if (candidate.basis === 'nomination') {
    sod(actorId, (candidate.detail as any)?.nominatedBy, 'an award you nominated');
  }

  let seq = (await ctx.repo.count(WINNERS, { seasonId })) + 1;
  let certificateId = `SAIU-${season.year}-${String(seq).padStart(3, '0')}`;
  while (await ctx.repo.findOne(WINNERS, { certificateId })) {
    seq += 1;
    certificateId = `SAIU-${season.year}-${String(seq).padStart(3, '0')}`;
  }

  const winner = await ctx.repo.insert(WINNERS, {
    id: ctx.newId(),
    seasonId,
    categoryId,
    categoryKind: category.kind,
    userId,
    score: candidate.score,
    basis: candidate.basis,
    certificateId,
    approvedBy: actorId,
    approvedAt: ctx.now(),
    publishedAt: ctx.now(),
    status: 'published',
    version: 1,
  });
  await ctx.repo.update(CATEGORIES, categoryId, { status: 'approved', winnerId: winner.id });
  await ctx.audit.record({
    action: 'rankings.winner.approve',
    actorId,
    targetType: 'award_winner',
    targetId: winner.id,
    detail: { seasonId, categoryId, userId, certificateId },
  });
  return winner;
}

export async function listWinners(ctx: FeatureContext, seasonId: string) {
  await seasonOr404(ctx, seasonId);
  const winners = await ctx.repo.find(WINNERS, { seasonId });
  const categories = await ctx.repo.find(CATEGORIES, { seasonId });
  const byId = new Map<string, any>();
  for (const c of categories) byId.set(c.id, c);
  return winners.map((w) => ({ ...w, categoryName: (byId.get(w.categoryId) as any)?.name ?? null }));
}

export async function verifyCertificate(ctx: FeatureContext, certificateId: string) {
  const winner = await ctx.repo.findOne(WINNERS, { certificateId });
  if (!winner) throw notFound('Certificate not found');
  return { valid: true, certificateId, seasonId: winner.seasonId, categoryId: winner.categoryId, userId: winner.userId, publishedAt: winner.publishedAt };
}

export async function archiveSeason(ctx: FeatureContext, actorId: string, seasonId: string) {
  const season = await seasonOr404(ctx, seasonId);
  if (season.status === 'archived') throw conflict('Season is already archived');
  const updated = await ctx.repo.update(SEASONS, seasonId, { status: 'archived', archivedAt: ctx.now(), archivedBy: actorId });
  await ctx.audit.record({ action: 'rankings.season.archive', actorId, targetType: 'championship_season', targetId: seasonId });
  return updated;
}

/** Rating baseline/end snapshot used by the Most Improved calculation. */
export async function recordRatingEntry(ctx: FeatureContext, actorId: string, seasonId: string, input: any) {
  await seasonOr404(ctx, seasonId);
  if (!input?.userId) throw badRequest('userId is required');
  const start = Number(input?.startRating);
  const end = Number(input?.endRating);
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw badRequest('startRating and endRating must be integers');
  const pool = String(input?.pool ?? 'rapid');
  if (!POOLS.includes(pool)) throw badRequest(`pool must be one of: ${POOLS.join(', ')}`);
  const games = input?.games === undefined ? 0 : Number(input.games);
  if (!Number.isInteger(games) || games < 0) throw badRequest('games must be a non-negative integer');

  const row = await ctx.repo.insert(RATING_ENTRIES, {
    id: ctx.newId(),
    seasonId,
    userId: input.userId,
    pool,
    startRating: start,
    endRating: end,
    games,
    recordedBy: actorId,
    recordedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'rankings.rating_entry.record', actorId, targetType: 'season_rating_entry', targetId: row.id, detail: { seasonId, userId: input.userId, pool } });
  return row;
}
