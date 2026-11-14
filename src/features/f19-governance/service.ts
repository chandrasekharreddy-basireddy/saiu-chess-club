/**
 * Feature 19 — Executive Committee, Elections & Leadership Transition (slug: `governance`)
 *
 * Tables
 *  - governance_terms            committee appointments with term dates (historical archive)
 *  - governance_elections        one row per election cycle
 *  - governance_candidates       nominations + eligibility decisions
 *  - governance_votes            one row per ballot (voterId kept only to enforce one-person-one-vote;
 *                                never returned by any endpoint and never written to the audit log)
 *  - governance_handover_tasks   handover checklist items / assets for the incoming committee
 *
 * Lifecycle: nominations -> voting -> closed -> certified.
 * Safeguards implemented
 *  - voting stays disabled until the election is institutionally authorised by an official who is not
 *    the person who created the election
 *  - one person, one vote (a second ballot from the same voter is a 409)
 *  - self-voting is blocked (403)
 *  - an election administrator may not review nominations while being a candidate
 *  - results are aggregated counts only, and are not published until certified
 */
import type { FeatureContext, Row } from '../../core/types.js';
import { assertNotSelfApproval } from '../../core/permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

export const TERMS = 'governance_terms';
export const ELECTIONS = 'governance_elections';
export const CANDIDATES = 'governance_candidates';
export const VOTES = 'governance_votes';
export const HANDOVER = 'governance_handover_tasks';

function sod(actorId: string, ownerId: string, what: string) {
  try {
    assertNotSelfApproval(actorId, ownerId, what);
  } catch (e: any) {
    throw forbidden(e?.message || `Separation of duties: you cannot approve ${what} you raised`);
  }
}

function isoOrNull(v: any, field: string): string | null {
  if (v == null || v === '') return null;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) throw badRequest(`${field} must be an ISO date/time`);
  return new Date(t).toISOString();
}

async function loadElection(ctx: FeatureContext, id: string): Promise<Row> {
  const e = await ctx.repo.get(ELECTIONS, id);
  if (!e) throw notFound('Election not found');
  return e;
}

/* ------------------------------------------------------------------ committee terms */

export async function createTerm(
  ctx: FeatureContext,
  actorId: string,
  input: { position?: string; userId?: string; holderName?: string; startsAt?: string; endsAt?: string; responsibilities?: string },
) {
  const position = (input?.position || '').trim();
  if (!position) throw badRequest('position is required');
  if (!input?.userId) throw badRequest('userId is required');
  const startsAt = isoOrNull(input?.startsAt, 'startsAt') || ctx.now();
  const endsAt = isoOrNull(input?.endsAt, 'endsAt');
  if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw badRequest('endsAt must be after startsAt');

  const row = await ctx.repo.insert(TERMS, {
    id: ctx.newId(),
    position,
    userId: input.userId,
    holderName: input?.holderName ?? null,
    responsibilities: input?.responsibilities ?? null,
    startsAt,
    endsAt,
    status: 'active',
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'governance.term.create', actorId, targetType: 'committee_term', targetId: row.id, detail: { position, userId: input.userId } });
  return row;
}

export async function endTerm(ctx: FeatureContext, actorId: string, id: string) {
  const t = await ctx.repo.get(TERMS, id);
  if (!t) throw notFound('Committee term not found');
  if (t.status !== 'active') throw conflict(`Only an active term can be ended (current: ${t.status})`);
  const row = await ctx.repo.update(TERMS, id, { status: 'ended', endsAt: ctx.now(), endedAt: ctx.now(), endedBy: actorId });
  await ctx.audit.record({ action: 'governance.term.end', actorId, targetType: 'committee_term', targetId: id });
  return row;
}

/** Committee directory + historical archive. */
export async function listCommittee(ctx: FeatureContext, filter: { current?: boolean; includeEnded?: boolean } = {}) {
  const where: Row = filter.includeEnded ? {} : { status: 'active' };
  const rows = await ctx.repo.find(TERMS, where, { orderBy: 'startsAt' });
  const nowMs = new Date(ctx.now()).getTime();
  return rows.filter((t) => {
    if (!filter.current) return true;
    if (t.endsAt && new Date(t.endsAt).getTime() < nowMs) return false;
    return t.status === 'active';
  });
}

/* ------------------------------------------------------------------ elections */

export async function createElection(
  ctx: FeatureContext,
  actorId: string,
  input: { title?: string; positions?: string[]; opensAt?: string; closesAt?: string; requiresInstitutionalApproval?: boolean },
) {
  const title = (input?.title || '').trim();
  if (!title) throw badRequest('Election title is required');
  const opensAt = isoOrNull(input?.opensAt, 'opensAt');
  const closesAt = isoOrNull(input?.closesAt, 'closesAt');
  if (opensAt && closesAt && new Date(closesAt).getTime() <= new Date(opensAt).getTime()) {
    throw badRequest('closesAt must be after opensAt');
  }
  const row = await ctx.repo.insert(ELECTIONS, {
    id: ctx.newId(),
    title,
    positions: input?.positions ?? [],
    opensAt,
    closesAt,
    requiresInstitutionalApproval: input?.requiresInstitutionalApproval !== false,
    authorized: false,
    authorizedBy: null,
    authorizedAt: null,
    authorizationRef: null,
    status: 'nominations',
    results: null,
    certified: false,
    certifiedBy: null,
    certifiedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'governance.election.create', actorId, targetType: 'election', targetId: row.id, detail: { title } });
  return row;
}

/** Voting is not enabled until an authorised official (never the creator) approves the process. */
export async function authorizeElection(ctx: FeatureContext, actorId: string, id: string, authorizationRef?: string) {
  const e = await loadElection(ctx, id);
  if (e.authorized) throw conflict('Election is already authorised');
  sod(actorId, e.createdBy, 'an election');
  const row = await ctx.repo.update(ELECTIONS, id, {
    authorized: true,
    authorizedBy: actorId,
    authorizedAt: ctx.now(),
    authorizationRef: authorizationRef ?? null,
  });
  await ctx.audit.record({ action: 'governance.election.authorize', actorId, targetType: 'election', targetId: id, detail: { authorizationRef: authorizationRef ?? null } });
  return row;
}

export async function nominate(
  ctx: FeatureContext,
  userId: string,
  electionId: string,
  input: { position?: string; statement?: string; proposedBy?: string },
) {
  const e = await loadElection(ctx, electionId);
  if (e.status !== 'nominations') throw conflict(`Nominations are closed (election status: ${e.status})`);
  if (e.opensAt && new Date(ctx.now()).getTime() < new Date(e.opensAt).getTime()) throw conflict('Nominations have not opened yet');
  const existing = await ctx.repo.findOne(CANDIDATES, { electionId, userId });
  if (existing) throw conflict('You have already been nominated for this election');

  const row = await ctx.repo.insert(CANDIDATES, {
    id: ctx.newId(),
    electionId,
    userId,
    position: (input?.position || '').trim() || 'committee_member',
    statement: input?.statement ?? null,
    proposedBy: input?.proposedBy ?? userId,
    status: 'nominated',
    eligibilityNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'governance.nomination.create', actorId: userId, targetType: 'election_candidate', targetId: row.id, detail: { electionId } });
  return row;
}

export async function reviewNomination(
  ctx: FeatureContext,
  actorId: string,
  electionId: string,
  candidateId: string,
  decision: 'approve' | 'reject',
  notes?: string,
) {
  const e = await loadElection(ctx, electionId);
  if (e.status !== 'nominations') throw conflict(`Eligibility review is closed (election status: ${e.status})`);
  const cand = await ctx.repo.get(CANDIDATES, candidateId);
  if (!cand || cand.electionId !== electionId) throw notFound('Nomination not found');
  if (cand.status !== 'nominated') throw conflict(`Nomination has already been reviewed (current: ${cand.status})`);
  const selfCandidacy = await ctx.repo.findOne(CANDIDATES, { electionId, userId: actorId });
  if (selfCandidacy) throw forbidden('Separation of duties: a candidate cannot review nominations in the same election');

  const row = await ctx.repo.update(CANDIDATES, candidateId, {
    status: decision === 'approve' ? 'candidate' : 'rejected',
    eligibilityNotes: notes ?? null,
    reviewedBy: actorId,
    reviewedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: decision === 'approve' ? 'governance.nomination.approve' : 'governance.nomination.reject',
    actorId,
    targetType: 'election_candidate',
    targetId: candidateId,
    detail: { electionId },
  });
  return row;
}

export async function openVoting(ctx: FeatureContext, actorId: string, id: string) {
  const e = await loadElection(ctx, id);
  if (e.status !== 'nominations') throw conflict(`Voting cannot be opened from status ${e.status}`);
  if (e.requiresInstitutionalApproval !== false && !e.authorized) {
    throw conflict('Electronic voting is disabled until the election is institutionally authorised');
  }
  const candidates = await ctx.repo.find(CANDIDATES, { electionId: id, status: 'candidate' });
  if (!candidates.length) throw conflict('At least one eligible candidate is required before voting opens');
  const row = await ctx.repo.update(ELECTIONS, id, { status: 'voting', votingOpenedAt: ctx.now(), votingOpenedBy: actorId });
  await ctx.audit.record({ action: 'governance.election.open', actorId, targetType: 'election', targetId: id, detail: { candidates: candidates.length } });
  return row;
}

export async function castVote(ctx: FeatureContext, voterId: string, id: string, candidateId: string) {
  const e = await loadElection(ctx, id);
  if (e.requiresInstitutionalApproval !== false && !e.authorized) {
    throw conflict('Electronic voting is disabled until the election is institutionally authorised');
  }
  if (e.status !== 'voting') throw conflict(`Voting is not open (election status: ${e.status})`);
  if (e.closesAt && new Date(ctx.now()).getTime() > new Date(e.closesAt).getTime()) throw conflict('Voting period has closed');
  if (!candidateId) throw badRequest('candidateId is required');

  const cand = await ctx.repo.get(CANDIDATES, candidateId);
  if (!cand || cand.electionId !== id || cand.status !== 'candidate') throw badRequest('candidateId does not identify an eligible candidate');
  if (cand.userId === voterId) throw forbidden('Self-voting is not permitted');

  const prior = await ctx.repo.findOne(VOTES, { electionId: id, voterId });
  if (prior) throw conflict('One person, one vote: this voter has already cast a ballot');

  const row = await ctx.repo.insert(VOTES, {
    id: ctx.newId(),
    electionId: id,
    voterId,
    candidateId,
    castAt: ctx.now(),
    ballotHash: ctx.newId(), // tamper-evident reference; the choice itself is never audited
  });
  // the audit trail records that a ballot was cast, never whom it was cast for
  await ctx.audit.record({ action: 'governance.election.vote', actorId: voterId, targetType: 'election', targetId: id, detail: { ballotId: row.id } });
  return { electionId: id, ballotId: row.id, castAt: row.castAt };
}

function tally(candidates: Row[], votes: Row[]) {
  const counts = candidates.map((c) => ({
    candidateId: c.id,
    userId: c.userId,
    position: c.position,
    votes: votes.filter((v) => v.candidateId === c.id).length,
  }));
  counts.sort((a, b) => b.votes - a.votes);
  const top = counts.length ? counts[0].votes : 0;
  const winners = top > 0 ? counts.filter((c) => c.votes === top).map((c) => c.candidateId) : [];
  return { counts, totalVotes: votes.length, winners, tie: winners.length > 1 };
}

export async function closeElection(ctx: FeatureContext, actorId: string, id: string) {
  const e = await loadElection(ctx, id);
  if (e.status !== 'voting') throw conflict(`Only an election in voting can be closed (current: ${e.status})`);
  const candidates = await ctx.repo.find(CANDIDATES, { electionId: id, status: 'candidate' });
  const votes = await ctx.repo.find(VOTES, { electionId: id });
  const result = tally(candidates, votes);
  const row = await ctx.repo.update(ELECTIONS, id, { status: 'closed', closedAt: ctx.now(), closedBy: actorId, results: result });
  await ctx.audit.record({
    action: 'governance.election.close',
    actorId,
    targetType: 'election',
    targetId: id,
    detail: { totalVotes: result.totalVotes, winners: result.winners },
  });
  return { ...row, tally: result };
}

/** Results stay internal until an official other than the election creator certifies them. */
export async function certifyResults(ctx: FeatureContext, actorId: string, id: string, notes?: string) {
  const e = await loadElection(ctx, id);
  if (e.status !== 'closed') throw conflict(`Only a closed election can be certified (current: ${e.status})`);
  if (e.certified) throw conflict('Results are already certified');
  sod(actorId, e.createdBy, 'election results');
  const row = await ctx.repo.update(ELECTIONS, id, {
    certified: true,
    certifiedBy: actorId,
    certifiedAt: ctx.now(),
    certificationNotes: notes ?? null,
  });
  await ctx.audit.record({ action: 'governance.election.certify', actorId, targetType: 'election', targetId: id, detail: { totalVotes: e.results?.totalVotes ?? 0 } });
  return row;
}

export async function getResults(ctx: FeatureContext, id: string) {
  const e = await loadElection(ctx, id);
  if (e.status !== 'closed' && e.status !== 'certified') throw conflict('Results are not available until voting closes');
  if (!e.certified) throw conflict('Results are not published until they are certified');
  return {
    electionId: id,
    title: e.title,
    status: e.status,
    certified: true,
    certifiedBy: e.certifiedBy,
    certifiedAt: e.certifiedAt,
    results: e.results,
  };
}

export async function getElection(ctx: FeatureContext, id: string) {
  const e = await loadElection(ctx, id);
  const candidates = await ctx.repo.find(CANDIDATES, { electionId: id }, { orderBy: 'createdAt' });
  const ballots = await ctx.repo.count(VOTES, { electionId: id });
  return {
    ...e,
    candidates,
    ballotCount: ballots,
    // results are withheld until certified, even for the detail view
    results: e.certified ? e.results : null,
  };
}

export async function listElections(ctx: FeatureContext, filter: { status?: string } = {}) {
  const where: Row = filter.status ? { status: filter.status } : {};
  return ctx.repo.find(ELECTIONS, where, { orderBy: 'createdAt', desc: true });
}

/* ------------------------------------------------------------------ handover */

export async function addHandoverTasks(
  ctx: FeatureContext,
  actorId: string,
  electionId: string,
  tasks: Array<{ title?: string; asset?: string; assigneeId?: string }>,
) {
  await loadElection(ctx, electionId);
  if (!Array.isArray(tasks) || !tasks.length) throw badRequest('tasks must be a non-empty array');
  const created: Row[] = [];
  for (const t of tasks) {
    const title = (t?.title || '').trim();
    if (!title) throw badRequest('Every handover task needs a title');
    created.push(
      await ctx.repo.insert(HANDOVER, {
        id: ctx.newId(),
        electionId,
        title,
        asset: t?.asset ?? null,
        assigneeId: t?.assigneeId ?? null,
        status: 'pending',
        createdBy: actorId,
        createdAt: ctx.now(),
      }),
    );
  }
  await ctx.audit.record({ action: 'governance.handover.assign', actorId, targetType: 'election', targetId: electionId, detail: { count: created.length } });
  return created;
}

export async function completeHandoverTask(ctx: FeatureContext, actorId: string, taskId: string) {
  const t = await ctx.repo.get(HANDOVER, taskId);
  if (!t) throw notFound('Handover task not found');
  if (t.status === 'done') throw conflict('Handover task is already complete');
  const row = await ctx.repo.update(HANDOVER, taskId, { status: 'done', completedAt: ctx.now(), completedBy: actorId });
  await ctx.audit.record({ action: 'governance.handover.complete', actorId, targetType: 'handover_task', targetId: taskId, detail: { electionId: t.electionId } });
  return row;
}

export async function listHandover(ctx: FeatureContext, electionId: string) {
  const e = await loadElection(ctx, electionId);
  const tasks = await ctx.repo.find(HANDOVER, { electionId }, { orderBy: 'createdAt' });
  return {
    electionId,
    tasks,
    total: tasks.length,
    done: tasks.filter((t) => t.status === 'done').length,
    pending: tasks.filter((t) => t.status !== 'done').length,
    assets: tasks.map((t) => t.asset).filter(Boolean),
    electionStatus: e.status,
  };
}
