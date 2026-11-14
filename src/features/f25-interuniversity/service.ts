import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 25 — Inter-University Competition & Federation Management (slug: interuniversity)
 *
 * Tables
 *  - interuniversity_federations    federation/association contacts with a verified flag
 *  - interuniversity_competitions   external competitions + documented selection criteria
 *  - interuniversity_fixtures       fixture records: federation id, home/away, result confirmation
 *  - interuniversity_teams          team selection proposals and their approval
 *  - interuniversity_documents      official correspondence (access-controlled)
 *
 * Safeguards: affiliation is only claimed when the federation record is verified; registration and
 * payment are recordkeeping only (no payment processing); travel/finance modules stay authoritative.
 */

export const FEDERATIONS = 'interuniversity_federations';
export const COMPETITIONS = 'interuniversity_competitions';
export const FIXTURES = 'interuniversity_fixtures';
export const TEAMS = 'interuniversity_teams';
export const DOCUMENTS = 'interuniversity_documents';

const HOME_AWAY = ['home', 'away', 'neutral'];

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

function score(value: any, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw badRequest(`${field} must be a non-negative integer`);
  return n;
}

/** Outcome is derived from the boards; it can never contradict the scoreline. */
export function outcomeOf(ourScore: number, opponentScore: number): 'win' | 'loss' | 'draw' {
  if (ourScore > opponentScore) return 'win';
  if (ourScore < opponentScore) return 'loss';
  return 'draw';
}

export async function createFederation(
  ctx: FeatureContext,
  actorId: string,
  input: { name?: string; contactName?: string; contactEmail?: string; website?: string; verified?: boolean } = {},
) {
  const name = need(input?.name, 'name');
  const federation = await ctx.repo.insert(FEDERATIONS, {
    id: ctx.newId(),
    name,
    contactName: input?.contactName ?? null,
    contactEmail: input?.contactEmail ?? null,
    website: input?.website ?? null,
    // affiliation may only be claimed once a human has verified the relationship
    verified: !!input?.verified,
    verifiedBy: input?.verified ? actorId : null,
    verifiedAt: input?.verified ? ctx.now() : null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'interuniversity.federation.create',
    actorId,
    targetType: 'interuniversity_federation',
    targetId: federation.id,
    detail: { name, verified: federation.verified },
  });
  return federation;
}

export async function listFederations(ctx: FeatureContext) {
  return ctx.repo.find(FEDERATIONS, {}, { orderBy: 'name' });
}

export async function verifyFederation(ctx: FeatureContext, actorId: string, id: string) {
  const federation = await ctx.repo.get(FEDERATIONS, id);
  if (!federation) throw notFound('Federation not found');
  if (federation.verified) throw conflict('Federation is already verified');
  const updated = await ctx.repo.update(FEDERATIONS, id, { verified: true, verifiedBy: actorId, verifiedAt: ctx.now() });
  await ctx.audit.record({
    action: 'interuniversity.federation.verify',
    actorId,
    targetType: 'interuniversity_federation',
    targetId: id,
  });
  return updated;
}

export async function createCompetition(
  ctx: FeatureContext,
  actorId: string,
  input: {
    name?: string;
    federationId?: string;
    startsAt?: string;
    endsAt?: string;
    eligibility?: string;
    selectionCriteria?: string;
    externalUrl?: string;
  } = {},
) {
  const name = need(input?.name, 'name');
  const federationId = need(input?.federationId, 'federationId');
  const federation = await ctx.repo.get(FEDERATIONS, federationId);
  if (!federation) throw notFound('Federation not found');
  const selectionCriteria = need(input?.selectionCriteria, 'selectionCriteria');
  const competition = await ctx.repo.insert(COMPETITIONS, {
    id: ctx.newId(),
    name,
    federationId,
    startsAt: input?.startsAt ?? null,
    endsAt: input?.endsAt ?? null,
    eligibility: input?.eligibility ?? null,
    selectionCriteria,
    externalUrl: input?.externalUrl ?? null,
    registrationStatus: 'not_registered', // recordkeeping only
    paymentProcessed: false,
    status: 'planned',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'interuniversity.competition.create',
    actorId,
    targetType: 'interuniversity_competition',
    targetId: competition.id,
    detail: { name, federationId },
  });
  return competition;
}

export async function listCompetitions(ctx: FeatureContext, filter: { status?: string } = {}) {
  const q: Row = {};
  if (filter.status) q.status = filter.status;
  return ctx.repo.find(COMPETITIONS, q, { orderBy: 'createdAt', desc: true });
}

export async function getCompetition(ctx: FeatureContext, id: string) {
  const competition = await ctx.repo.get(COMPETITIONS, id);
  if (!competition) throw notFound('Competition not found');
  const fixtures = await ctx.repo.find(FIXTURES, { competitionId: id }, { orderBy: 'scheduledAt' });
  const teams = await ctx.repo.find(TEAMS, { competitionId: id }, { orderBy: 'createdAt', desc: true });
  const played = fixtures.filter((f) => f.resultStatus === 'confirmed');
  return {
    ...competition,
    fixtures,
    teams,
    record: {
      played: played.length,
      wins: played.filter((f) => f.result === 'win').length,
      draws: played.filter((f) => f.result === 'draw').length,
      losses: played.filter((f) => f.result === 'loss').length,
      pending: fixtures.filter((f) => f.resultStatus !== 'confirmed').length,
    },
  };
}

/** Selection criteria are transparent to eligible participants. */
export async function selectionCriteria(ctx: FeatureContext, competitionId: string) {
  const competition = await ctx.repo.get(COMPETITIONS, competitionId);
  if (!competition) throw notFound('Competition not found');
  return {
    competitionId,
    name: competition.name,
    eligibility: competition.eligibility ?? null,
    selectionCriteria: competition.selectionCriteria,
    approvedTeam: (await ctx.repo.find(TEAMS, { competitionId, status: 'approved' }))[0] ?? null,
  };
}

/** Affiliation may only be claimed when the federation record has been verified. */
export async function affiliation(ctx: FeatureContext, competitionId: string) {
  const competition = await ctx.repo.get(COMPETITIONS, competitionId);
  if (!competition) throw notFound('Competition not found');
  const federation = await ctx.repo.get(FEDERATIONS, competition.federationId);
  if (!federation) throw notFound('Federation not found');
  return {
    competitionId,
    federationId: federation.id,
    federationName: federation.name,
    federationVerified: !!federation.verified,
    affiliationClaimed: !!federation.verified,
  };
}

export async function createFixture(
  ctx: FeatureContext,
  actorId: string,
  competitionId: string,
  input: { opponentUniversity?: string; round?: number; homeAway?: string; scheduledAt?: string; venue?: string } = {},
) {
  const competition = await ctx.repo.get(COMPETITIONS, competitionId);
  if (!competition) throw notFound('Competition not found');
  const opponentUniversity = need(input?.opponentUniversity, 'opponentUniversity');
  const homeAway = need(input?.homeAway, 'homeAway');
  if (!HOME_AWAY.includes(homeAway)) throw badRequest(`homeAway must be one of ${HOME_AWAY.join(', ')}`);
  const round = Number(input?.round ?? 1);
  if (!Number.isInteger(round) || round < 1) throw badRequest('round must be a positive integer');

  const fixture = await ctx.repo.insert(FIXTURES, {
    id: ctx.newId(),
    competitionId,
    federationId: competition.federationId,
    round,
    opponentUniversity,
    homeAway,
    scheduledAt: input?.scheduledAt ?? null,
    venue: input?.venue ?? null,
    result: null,
    ourScore: null,
    opponentScore: null,
    resultStatus: 'pending',
    proposedBy: null,
    proposedAt: null,
    confirmedBy: null,
    confirmedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'interuniversity.fixture.create',
    actorId,
    targetType: 'interuniversity_fixture',
    targetId: fixture.id,
    detail: { competitionId, opponentUniversity, homeAway, federationId: fixture.federationId },
  });
  return fixture;
}

export async function getFixture(ctx: FeatureContext, id: string) {
  const fixture = await ctx.repo.get(FIXTURES, id);
  if (!fixture) throw notFound('Fixture not found');
  return fixture;
}

export async function proposeResult(
  ctx: FeatureContext,
  actorId: string,
  fixtureId: string,
  input: { ourScore?: number; opponentScore?: number; result?: string } = {},
) {
  const fixture = await ctx.repo.get(FIXTURES, fixtureId);
  if (!fixture) throw notFound('Fixture not found');
  if (fixture.resultStatus === 'confirmed') throw conflict('The result of this fixture is already confirmed');
  const ourScore = score(input?.ourScore, 'ourScore');
  const opponentScore = score(input?.opponentScore, 'opponentScore');
  const derived = outcomeOf(ourScore, opponentScore);
  if (input?.result && input.result !== derived) {
    throw badRequest(`result '${input.result}' contradicts the scoreline ${ourScore}-${opponentScore} (${derived})`, {
      expected: derived,
    });
  }
  const updated = await ctx.repo.update(FIXTURES, fixtureId, {
    ourScore,
    opponentScore,
    result: derived,
    resultStatus: 'proposed',
    proposedBy: actorId,
    proposedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'interuniversity.fixture.result.propose',
    actorId,
    targetType: 'interuniversity_fixture',
    targetId: fixtureId,
    detail: { ourScore, opponentScore, result: derived },
  });
  return updated;
}

export async function confirmResult(ctx: FeatureContext, actorId: string, fixtureId: string) {
  const fixture = await ctx.repo.get(FIXTURES, fixtureId);
  if (!fixture) throw notFound('Fixture not found');
  if (fixture.resultStatus !== 'proposed') throw conflict(`No proposed result awaiting confirmation (status: ${fixture.resultStatus})`);
  assertSeparate(actorId, fixture.proposedBy, 'a fixture result');
  const updated = await ctx.repo.update(FIXTURES, fixtureId, {
    resultStatus: 'confirmed',
    confirmedBy: actorId,
    confirmedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'interuniversity.fixture.result.confirm',
    actorId,
    targetType: 'interuniversity_fixture',
    targetId: fixtureId,
    detail: { result: fixture.result, proposedBy: fixture.proposedBy },
  });
  return updated;
}

export async function proposeTeam(
  ctx: FeatureContext,
  actorId: string,
  competitionId: string,
  input: { playerIds?: string[]; criteria?: string } = {},
) {
  const competition = await ctx.repo.get(COMPETITIONS, competitionId);
  if (!competition) throw notFound('Competition not found');
  const playerIds = Array.isArray(input?.playerIds) ? input.playerIds.filter((p) => typeof p === 'string' && p.trim()) : [];
  if (!playerIds.length) throw badRequest('playerIds must contain at least one player');
  const criteria = (input?.criteria || competition.selectionCriteria || '').trim();
  if (!criteria) throw badRequest('Documented selection criteria are required');
  const existing = await ctx.repo.findOne(TEAMS, { competitionId, status: 'proposed' });
  if (existing) throw conflict('A team proposal is already awaiting approval', { teamId: existing.id });

  const team = await ctx.repo.insert(TEAMS, {
    id: ctx.newId(),
    competitionId,
    playerIds,
    criteria,
    status: 'proposed',
    proposedBy: actorId,
    proposedAt: ctx.now(),
    approvedBy: null,
    approvedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'interuniversity.team.propose',
    actorId,
    targetType: 'interuniversity_team',
    targetId: team.id,
    detail: { competitionId, players: playerIds.length },
  });
  return team;
}

export async function approveTeam(ctx: FeatureContext, actorId: string, teamId: string) {
  const team = await ctx.repo.get(TEAMS, teamId);
  if (!team) throw notFound('Team not found');
  if (team.status !== 'proposed') throw conflict(`Team is ${team.status} and cannot be approved`);
  assertSeparate(actorId, team.proposedBy, 'a team selection');
  const updated = await ctx.repo.update(TEAMS, teamId, {
    status: 'approved',
    approvedBy: actorId,
    approvedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'interuniversity.team.approve',
    actorId,
    targetType: 'interuniversity_team',
    targetId: teamId,
    detail: { proposedBy: team.proposedBy, criteria: team.criteria },
  });
  return updated;
}

export async function addDocument(
  ctx: FeatureContext,
  actorId: string,
  competitionId: string,
  input: { title?: string; url?: string; kind?: string; restrictedTo?: string[] } = {},
) {
  const competition = await ctx.repo.get(COMPETITIONS, competitionId);
  if (!competition) throw notFound('Competition not found');
  const title = need(input?.title, 'title');
  const doc = await ctx.repo.insert(DOCUMENTS, {
    id: ctx.newId(),
    competitionId,
    title,
    url: input?.url ?? null,
    kind: input?.kind || 'correspondence',
    restrictedTo: input?.restrictedTo ?? ['interuniversity.manage'],
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'interuniversity.document.add',
    actorId,
    targetType: 'interuniversity_competition',
    targetId: competitionId,
    detail: { documentId: doc.id, title },
  });
  return doc;
}

export async function listDocuments(ctx: FeatureContext, competitionId: string) {
  return ctx.repo.find(DOCUMENTS, { competitionId }, { orderBy: 'createdAt', desc: true });
}
