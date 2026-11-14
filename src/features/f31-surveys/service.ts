import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { hasPermission } from '../../core/permissions.js';

/**
 * Feature 31 — Surveys, Polls & Community Decision-Making Centre.
 *
 * Tables (created implicitly by the first insert):
 *   survey_polls        one row per survey/poll (questions + options are embedded, ordered)
 *   survey_responses    one row per submission; anonymous rows carry userId: null
 *   survey_vote_ledger  pseudonymous voter tokens — enforces one response per account
 *                       WITHOUT linking an anonymous response back to a person
 *   survey_proposals    community proposals / discussion attached to a poll
 *   survey_actions      follow-up action items created from results
 *
 * Rules enforced here:
 *  - this feature is never an official election (`type: 'election'` is rejected);
 *  - one response per eligible account (single and multi choice alike);
 *  - anonymous responses store no user id anywhere on the response row, and the
 *    eligibility ledger stores only a salted token, never the account id;
 *  - results are permission controlled; a draft/closed-but-private poll's results
 *    are visible only to holders of `survey.create`.
 */

export const POLL = 'survey_polls';
export const RESPONSE = 'survey_responses';
export const LEDGER = 'survey_vote_ledger';
export const PROPOSAL = 'survey_proposals';
export const ACTION = 'survey_actions';

export const POLL_TYPES = ['poll', 'survey'];
export const SELECTION_MODES = ['single', 'multi'];
export const AUDIENCES = ['public', 'members', 'committee', 'coaches'];
export const RESULT_VISIBILITIES = ['public', 'after_close', 'managers_only'];
const EXCLUDED_TYPES = ['election', 'official_election', 'referendum'];

export interface PollInput {
  title?: string;
  type?: string;
  selection?: string;
  options?: Array<string | { label?: string; text?: string }>;
  questions?: Array<{ prompt?: string; options?: Array<string | { label?: string }> }>;
  purpose?: string;
  audience?: string;
  closesAt?: string;
  resultVisibility?: string;
  anonymous?: boolean;
  maxSelections?: number;
}

/** Deterministic, dependency-free digest used for the pseudonymous voter token. */
function digest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + ch, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function normaliseOptions(raw: PollInput['options']): Array<{ id: string; label: string }> {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: Array<{ id: string; label: string }> = [];
  for (const item of list) {
    const label = (typeof item === 'string' ? item : item?.label ?? item?.text ?? '').toString().trim();
    if (!label) throw badRequest('Every option needs a non-empty label');
    const key = label.toLowerCase();
    if (seen.has(key)) throw badRequest(`Duplicate option: ${label}`);
    seen.add(key);
    out.push({ id: `opt_${out.length + 1}`, label });
  }
  return out;
}

export async function createPoll(ctx: FeatureContext, actorId: string, input: PollInput = {}) {
  const title = (input.title || '').trim();
  if (!title) throw badRequest('Poll title is required');

  const type = (input.type || 'poll').toString().toLowerCase();
  if (EXCLUDED_TYPES.includes(type)) {
    throw unprocessable('This feature does not run official elections; use the governance feature instead');
  }
  if (!POLL_TYPES.includes(type)) throw badRequest(`type must be one of ${POLL_TYPES.join(', ')}`);

  const selection = (input.selection || 'single').toString().toLowerCase();
  if (!SELECTION_MODES.includes(selection)) throw badRequest(`selection must be one of ${SELECTION_MODES.join(', ')}`);

  const options = normaliseOptions(input.options);
  if (options.length < 2) throw badRequest('A poll needs at least two options');

  const questions = Array.isArray(input.questions)
    ? input.questions.map((q, i) => ({
        id: `q_${i + 1}`,
        prompt: (q?.prompt || `Question ${i + 1}`).toString().trim(),
        options: normaliseOptions(q?.options as any),
      }))
    : [{ id: 'q_1', prompt: title, options }];

  const audience = (input.audience || 'members').toString().toLowerCase();
  if (!AUDIENCES.includes(audience)) throw badRequest(`audience must be one of ${AUDIENCES.join(', ')}`);

  const resultVisibility = (input.resultVisibility || 'after_close').toString().toLowerCase();
  if (!RESULT_VISIBILITIES.includes(resultVisibility)) {
    throw badRequest(`resultVisibility must be one of ${RESULT_VISIBILITIES.join(', ')}`);
  }

  const maxSelections =
    selection === 'single' ? 1 : Math.max(1, Math.min(Number(input.maxSelections) || options.length, options.length));

  const poll = await ctx.repo.insert(POLL, {
    id: ctx.newId(),
    title,
    type,
    selection,
    maxSelections,
    options,
    questions,
    purpose: input.purpose ? input.purpose.toString().trim() : null,
    audience,
    closesAt: input.closesAt ?? null,
    resultVisibility,
    anonymous: !!input.anonymous,
    status: 'draft',
    officialElection: false,
    voterSalt: ctx.newId(),
    createdBy: actorId,
    publishedAt: null,
    closedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'survey.poll.create', actorId, targetType: 'poll', targetId: poll.id, detail: { type, selection } });
  return poll;
}

export async function publishPoll(ctx: FeatureContext, actorId: string, id: string) {
  const poll = await ctx.repo.get(POLL, id);
  if (!poll) throw notFound('Poll not found');
  if (poll.status !== 'draft') throw conflict(`Cannot publish a ${poll.status} poll`);
  if (!poll.purpose) throw unprocessable('A published poll must state its purpose');
  if (!poll.closesAt) throw unprocessable('A published poll must state its close date');
  if (new Date(poll.closesAt).getTime() <= new Date(ctx.now()).getTime()) {
    throw unprocessable('The close date must be in the future');
  }
  if (!poll.options || poll.options.length < 2) throw unprocessable('A poll needs at least two options');
  const updated = await ctx.repo.update(POLL, id, { status: 'published', publishedAt: ctx.now() });
  await ctx.audit.record({ action: 'survey.poll.publish', actorId, targetType: 'poll', targetId: id });
  return updated;
}

export async function listPolls(ctx: FeatureContext) {
  return ctx.repo.find(POLL, { status: 'published' }, { orderBy: 'publishedAt', desc: true });
}

function isManager(session: any): boolean {
  return hasPermission(session, 'survey.create');
}

export async function getPoll(ctx: FeatureContext, session: any, id: string) {
  const poll = await ctx.repo.get(POLL, id);
  if (!poll) throw notFound('Poll not found');
  const manager = isManager(session);
  if (poll.status === 'draft' && !manager) throw notFound('Poll not found');
  const responseCount = await ctx.repo.count(RESPONSE, { pollId: id });
  const results = (await resultsAllowed(session, poll)) ? await tally(ctx, id) : null;
  return { ...poll, responseCount, results };
}

async function resultsAllowed(session: any, poll: Row): Promise<boolean> {
  if (isManager(session)) return true;
  if (poll.status !== 'closed') return false;
  if (poll.resultVisibility === 'managers_only') return false;
  return poll.resultVisibility === 'public' || poll.resultVisibility === 'after_close';
}

export async function respond(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const poll = await ctx.repo.get(POLL, id);
  if (!poll) throw notFound('Poll not found');
  if (poll.status === 'draft') throw conflict('This poll is not published yet');
  if (poll.status === 'closed') throw conflict('This poll is closed');
  if (poll.closesAt && new Date(ctx.now()).getTime() > new Date(poll.closesAt).getTime()) {
    throw conflict('This poll has closed');
  }

  const optionIds: string[] = Array.isArray(input.optionIds)
    ? input.optionIds.map((o: any) => o?.toString())
    : input.optionId
      ? [input.optionId.toString()]
      : [];
  if (!optionIds.length) throw badRequest('At least one option must be selected');
  if (new Set(optionIds).size !== optionIds.length) throw badRequest('Duplicate option selections are not allowed');

  const known = new Set((poll.options || []).map((o: Row) => o.id));
  for (const oid of optionIds) if (!known.has(oid)) throw badRequest(`Unknown option: ${oid}`);

  if (poll.selection === 'single' && optionIds.length !== 1) {
    throw badRequest('This is a single-choice poll; select exactly one option');
  }
  const max = poll.selection === 'single' ? 1 : poll.maxSelections ?? (poll.options || []).length;
  if (optionIds.length > max) throw badRequest(`Select at most ${max} options`);

  const anonymous = !!poll.anonymous;
  const token = digest(`${poll.id}:${poll.voterSalt || ''}:${actorId}`);
  const already = await ctx.repo.findOne(LEDGER, { pollId: id, voterToken: token });
  if (already) throw conflict('You have already responded to this poll');

  const response = await ctx.repo.insert(RESPONSE, {
    id: ctx.newId(),
    pollId: id,
    // anonymity: an anonymous response carries no identity at all
    userId: anonymous ? null : actorId,
    anonymous,
    optionIds,
    comment: input.comment ? input.comment.toString().slice(0, 2000) : null,
    createdAt: ctx.now(),
  });

  // Eligibility ledger: salted token only — deliberately not linked to the response row.
  await ctx.repo.insert(LEDGER, {
    id: ctx.newId(),
    pollId: id,
    voterToken: token,
    anonymous,
    createdAt: ctx.now(),
  });

  await ctx.audit.record({
    action: 'survey.response.create',
    actorId: anonymous ? undefined : actorId,
    targetType: 'poll',
    targetId: id,
    detail: { anonymous, optionCount: optionIds.length },
  });
  return response;
}

export async function tally(ctx: FeatureContext, pollId: string) {
  const poll = await ctx.repo.get(POLL, pollId);
  if (!poll) throw notFound('Poll not found');
  const responses = await ctx.repo.find(RESPONSE, { pollId });
  const counts = (poll.options || []).map((o: Row) => ({ optionId: o.id, label: o.label, votes: 0 }));
  for (const r of responses) {
    for (const oid of r.optionIds || []) {
      const row = counts.find((c: Row) => c.optionId === oid);
      if (row) row.votes += 1;
    }
  }
  const totalSelections = counts.reduce((a: number, b: Row) => a + b.votes, 0);
  const results = counts.map((c: Row) => ({
    ...c,
    percentage: totalSelections ? Math.round((c.votes / totalSelections) * 1000) / 10 : 0,
  }));
  return {
    pollId,
    status: poll.status,
    anonymous: !!poll.anonymous,
    totalResponses: responses.length,
    totalSelections,
    results,
  };
}

export async function closePoll(ctx: FeatureContext, actorId: string, id: string) {
  const poll = await ctx.repo.get(POLL, id);
  if (!poll) throw notFound('Poll not found');
  if (poll.status === 'draft') throw conflict('Cannot close a poll that was never published');
  if (poll.status === 'closed') throw conflict('Poll is already closed');
  const updated = await ctx.repo.update(POLL, id, { status: 'closed', closedAt: ctx.now() });
  const summary = await tally(ctx, id);
  await ctx.audit.record({
    action: 'survey.poll.close',
    actorId,
    targetType: 'poll',
    targetId: id,
    detail: { totalResponses: summary.totalResponses },
  });
  return { ...updated, results: summary.results, totalResponses: summary.totalResponses };
}

export async function getResults(ctx: FeatureContext, session: any, id: string) {
  const poll = await ctx.repo.get(POLL, id);
  if (!poll) throw notFound('Poll not found');
  if (!(await resultsAllowed(session, poll))) {
    throw forbidden('Results for this poll are not published yet');
  }
  return tally(ctx, id);
}

export async function createProposal(ctx: FeatureContext, actorId: string, pollId: string, input: any = {}) {
  const poll = await ctx.repo.get(POLL, pollId);
  if (!poll) throw notFound('Poll not found');
  const title = (input.title || '').trim();
  if (!title) throw badRequest('Proposal title is required');
  const proposal = await ctx.repo.insert(PROPOSAL, {
    id: ctx.newId(),
    pollId,
    title,
    body: input.body ? input.body.toString().slice(0, 4000) : null,
    authorId: actorId,
    status: 'open',
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'survey.proposal.create', actorId, targetType: 'proposal', targetId: proposal.id, detail: { pollId } });
  return proposal;
}

export async function listProposals(ctx: FeatureContext, pollId: string) {
  return ctx.repo.find(PROPOSAL, { pollId }, { orderBy: 'createdAt' });
}

export async function createAction(ctx: FeatureContext, actorId: string, pollId: string, input: any = {}) {
  const poll = await ctx.repo.get(POLL, pollId);
  if (!poll) throw notFound('Poll not found');
  const title = (input.title || '').trim();
  if (!title) throw badRequest('Action title is required');
  const action = await ctx.repo.insert(ACTION, {
    id: ctx.newId(),
    pollId,
    title,
    ownerId: input.ownerId ?? actorId,
    dueAt: input.dueAt ?? null,
    status: 'open',
    outcome: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'survey.action.create', actorId, targetType: 'action', targetId: action.id, detail: { pollId } });
  return action;
}

export async function listActions(ctx: FeatureContext, pollId: string) {
  return ctx.repo.find(ACTION, { pollId }, { orderBy: 'createdAt' });
}

export async function completeAction(ctx: FeatureContext, actorId: string, pollId: string, actionId: string, input: any = {}) {
  const action = await ctx.repo.get(ACTION, actionId);
  if (!action || action.pollId !== pollId) throw notFound('Action item not found');
  if (action.status === 'done') throw conflict('Action item is already complete');
  const updated = await ctx.repo.update(ACTION, actionId, {
    status: 'done',
    outcome: input.outcome ? input.outcome.toString() : action.outcome,
    completedAt: ctx.now(),
    completedBy: actorId,
  });
  await ctx.audit.record({ action: 'survey.action.complete', actorId, targetType: 'action', targetId: actionId, detail: { pollId } });
  return updated;
}
