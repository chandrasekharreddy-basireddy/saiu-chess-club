import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { hasPermission } from '../../core/permissions.js';

/**
 * Feature 32 — Website Experience Improvement Centre.
 *
 * Tables (created implicitly by the first insert):
 *   experience_feedback       one row per submission (bug / usability / feature request /
 *                             accessibility / security) with severity and triage status
 *   experience_votes          one row per (feedback, user) — public prioritisation only
 *   experience_release_notes  release/status notes attached to a feedback item
 *
 * Rules enforced here:
 *  - feedback types are distinct and validated;
 *  - security-sensitive reports go to a restricted queue, are never public and are
 *    readable only by holders of `site.experience.manage`;
 *  - triage follows a fixed state machine and every transition is audited and kept
 *    on the row as triage history;
 *  - duplicates are linked to an existing item, never merged blindly;
 *  - a roadmap item must be triaged (approved by the team) before publication.
 */

export const FEEDBACK = 'experience_feedback';
export const VOTE = 'experience_votes';
export const RELEASE_NOTE = 'experience_release_notes';

export const TYPES = ['bug', 'usability', 'feature_request', 'accessibility', 'security'];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const STATUSES = ['new', 'triaged', 'in_progress', 'resolved', 'declined', 'duplicate'];

/** Allowed triage transitions. */
const TRANSITIONS: Record<string, string[]> = {
  new: ['triaged', 'declined', 'duplicate'],
  triaged: ['in_progress', 'declined', 'duplicate'],
  in_progress: ['resolved', 'declined'],
  resolved: ['in_progress'],
  declined: [],
  duplicate: [],
};

function isManager(session: any): boolean {
  return hasPermission(session, 'site.experience.manage');
}

export async function submitFeedback(ctx: FeatureContext, actorId: string, input: any = {}) {
  const type = (input.type || '').toString().toLowerCase();
  if (!TYPES.includes(type)) throw badRequest(`type must be one of ${TYPES.join(', ')}`);

  const title = (input.title || '').trim();
  if (!title) throw badRequest('A short title is required');
  if (title.length > 160) throw badRequest('title must be 160 characters or fewer');

  const severity = (input.severity || 'medium').toString().toLowerCase();
  if (!SEVERITIES.includes(severity)) throw badRequest(`severity must be one of ${SEVERITIES.join(', ')}`);

  const securitySensitive = type === 'security' || !!input.securitySensitive;

  const row = await ctx.repo.insert(FEEDBACK, {
    id: ctx.newId(),
    type,
    title,
    description: input.description ? input.description.toString().slice(0, 8000) : null,
    severity,
    page: input.page ? input.page.toString() : null,
    context: input.context ?? null,
    submittedBy: actorId,
    // Security-sensitive reports never enter the public queue.
    queue: securitySensitive ? 'restricted' : 'general',
    visibility: securitySensitive ? 'restricted' : 'internal',
    publicVotable: !securitySensitive,
    securitySensitive,
    status: 'new',
    priority: null,
    assignedTo: null,
    duplicateOf: null,
    roadmapPublished: false,
    triageHistory: [{ at: ctx.now(), by: actorId, from: null, to: 'new' }],
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'experience.feedback.submit',
    actorId,
    targetType: 'feedback',
    targetId: row.id,
    detail: { type, severity, queue: row.queue },
  });
  return row;
}

export async function listFeedback(ctx: FeatureContext, filter: any = {}) {
  const where: any = {};
  if (filter.type) where.type = filter.type.toString();
  if (filter.status) where.status = filter.status.toString();
  if (filter.queue) where.queue = filter.queue.toString();
  const limit = Math.min(Number(filter.limit) || 50, 100);
  const offset = Number(filter.offset) || 0;
  const items = await ctx.repo.find(FEEDBACK, where, { limit, offset, orderBy: 'createdAt', desc: true });
  const total = await ctx.repo.count(FEEDBACK, where);
  return { items, total, limit, offset };
}

export async function getFeedback(ctx: FeatureContext, session: any, id: string) {
  const row = await ctx.repo.get(FEEDBACK, id);
  if (!row) throw notFound('Feedback item not found');
  if (row.securitySensitive && !isManager(session)) {
    throw forbidden('Security-sensitive reports are restricted to the experience team');
  }
  if (!isManager(session) && row.submittedBy !== session?.userId) {
    throw forbidden('You can only read feedback you submitted');
  }
  const votes = await ctx.repo.count(VOTE, { feedbackId: id });
  const notes = await ctx.repo.find(RELEASE_NOTE, { feedbackId: id }, { orderBy: 'createdAt' });
  return { ...row, votes, releaseNotes: notes };
}

export async function triage(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(FEEDBACK, id);
  if (!row) throw notFound('Feedback item not found');

  const to = (input.status || '').toString();
  if (!STATUSES.includes(to)) throw badRequest(`status must be one of ${STATUSES.join(', ')}`);
  const allowed = TRANSITIONS[row.status] || [];
  if (!allowed.includes(to)) {
    throw conflict(`Cannot move feedback from ${row.status} to ${to}`);
  }
  if (input.priority != null) {
    const p = input.priority.toString().toLowerCase();
    if (!SEVERITIES.includes(p)) throw badRequest(`priority must be one of ${SEVERITIES.join(', ')}`);
  }

  const history = Array.isArray(row.triageHistory) ? row.triageHistory.slice() : [];
  history.push({ at: ctx.now(), by: actorId, from: row.status, to, note: input.note ?? null });

  const updated = await ctx.repo.update(FEEDBACK, id, {
    status: to,
    priority: input.priority ? input.priority.toString().toLowerCase() : row.priority,
    assignedTo: input.assignedTo ?? row.assignedTo,
    triageHistory: history,
    triagedBy: actorId,
    triagedAt: ctx.now(),
    resolvedAt: to === 'resolved' ? ctx.now() : row.resolvedAt ?? null,
  });
  await ctx.audit.record({
    action: 'experience.feedback.triage',
    actorId,
    targetType: 'feedback',
    targetId: id,
    detail: { from: row.status, to, priority: updated?.priority ?? null },
  });
  return updated;
}

export async function linkDuplicate(ctx: FeatureContext, session: any, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(FEEDBACK, id);
  if (!row) throw notFound('Feedback item not found');
  const targetId = (input.duplicateOf || input.targetId || '').toString();
  if (!targetId) throw badRequest('duplicateOf is required');
  if (targetId === id) throw badRequest('An item cannot be a duplicate of itself');
  const target = await ctx.repo.get(FEEDBACK, targetId);
  if (!target) throw notFound('The linked feedback item does not exist');
  if (target.securitySensitive && !isManager(session)) {
    throw forbidden('Cannot link to a restricted report');
  }
  if (row.duplicateOf) throw conflict('This item is already linked to a duplicate target');
  if (row.status === 'duplicate') throw conflict('This item is already marked as a duplicate');

  const history = Array.isArray(row.triageHistory) ? row.triageHistory.slice() : [];
  history.push({ at: ctx.now(), by: actorId, from: row.status, to: 'duplicate', note: `duplicate of ${targetId}` });

  const updated = await ctx.repo.update(FEEDBACK, id, {
    duplicateOf: targetId,
    status: 'duplicate',
    triageHistory: history,
  });
  await ctx.audit.record({
    action: 'experience.feedback.duplicate_link',
    actorId,
    targetType: 'feedback',
    targetId: id,
    detail: { duplicateOf: targetId },
  });
  return updated;
}

export async function vote(ctx: FeatureContext, actorId: string, id: string) {
  const row = await ctx.repo.get(FEEDBACK, id);
  if (!row) throw notFound('Feedback item not found');
  if (row.securitySensitive || !row.publicVotable) {
    throw forbidden('This item is not open to public prioritisation');
  }
  const existing = await ctx.repo.findOne(VOTE, { feedbackId: id, userId: actorId });
  if (existing) throw conflict('You have already voted for this item');
  const v = await ctx.repo.insert(VOTE, { id: ctx.newId(), feedbackId: id, userId: actorId, createdAt: ctx.now() });
  await ctx.audit.record({ action: 'experience.feedback.vote', actorId, targetType: 'feedback', targetId: id });
  return { ...v, votes: await ctx.repo.count(VOTE, { feedbackId: id }) };
}

export async function publishRoadmapItem(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(FEEDBACK, id);
  if (!row) throw notFound('Feedback item not found');
  if (row.securitySensitive) throw forbidden('Security-sensitive reports are never published');
  if (row.status === 'new') throw conflict('An item must be triaged before it can be published to the roadmap');
  if (row.status === 'declined' || row.status === 'duplicate') {
    throw conflict(`A ${row.status} item cannot be published to the roadmap`);
  }
  const updated = await ctx.repo.update(FEEDBACK, id, {
    roadmapPublished: true,
    publicApproved: true,
    approvedBy: actorId,
    publicTitle: (input.publicTitle || row.title).toString().slice(0, 160),
    // no delivery promise until a release is approved
    promisedDate: null,
    roadmapPublishedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'experience.feedback.roadmap_publish',
    actorId,
    targetType: 'feedback',
    targetId: id,
  });
  return updated;
}

export async function publicRoadmap(ctx: FeatureContext) {
  const all = await ctx.repo.find(FEEDBACK, { roadmapPublished: true }, { orderBy: 'roadmapPublishedAt', desc: true });
  return all
    .filter((r) => !r.securitySensitive)
    .map((r) => ({
      id: r.id,
      title: r.publicTitle || r.title,
      type: r.type,
      status: r.status,
      priority: r.priority,
      promisedDate: r.promisedDate ?? null,
    }));
}

export async function addReleaseNote(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(FEEDBACK, id);
  if (!row) throw notFound('Feedback item not found');
  const summary = (input.summary || '').trim();
  if (!summary) throw badRequest('A release note summary is required');
  const note = await ctx.repo.insert(RELEASE_NOTE, {
    id: ctx.newId(),
    feedbackId: id,
    version: input.version ? input.version.toString() : null,
    summary,
    published: false,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'experience.release_note.create',
    actorId,
    targetType: 'feedback',
    targetId: id,
    detail: { version: note.version },
  });
  return note;
}
