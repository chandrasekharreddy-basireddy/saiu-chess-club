import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

/**
 * Feature 11 — Chess Community & Social Interaction.
 *
 * Tables
 *  - community_posts     { authorId, title, body, scope, isPublic, moderationState, moderatedBy, moderationReason, moderatedAt }
 *  - community_comments  { postId, authorId, body, moderationState, moderatedBy, moderationReason, moderatedAt }
 *  - community_reports   { targetType, targetId, reporterId, reason, status, verified, resolvedBy, resolutionReason, outcome }
 *  - community_blocks    { blockerId, blockedId }
 *
 * Moderation states are always one of: visible | hidden | removed.
 * 'hidden' and 'removed' content is excluded from the feed, from post detail and
 * cannot receive new comments. Reports are unverified until a moderator resolves them.
 */

export const POSTS = 'community_posts';
export const COMMENTS = 'community_comments';
export const REPORTS = 'community_reports';
export const BLOCKS = 'community_blocks';

export const MODERATION_STATES = ['visible', 'hidden', 'removed'] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

export const REPORT_TARGETS = ['post', 'comment', 'account', 'group'] as const;

function stateOk(state: any): state is ModerationState {
  return typeof state === 'string' && (MODERATION_STATES as readonly string[]).includes(state);
}

function text(v: any, field: string, max = 5000): string {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${field} is required`);
  const t = v.trim();
  if (t.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return t;
}

/* ------------------------------------------------------------------ posts */

export interface PostInput {
  title?: string;
  body?: string;
  scope?: string;
  isPublic?: boolean;
}

export async function createPost(ctx: FeatureContext, authorId: string, input: PostInput = {}) {
  const title = text(input.title, 'title', 200);
  const body = text(input.body, 'body');
  const row = await ctx.repo.insert(POSTS, {
    id: ctx.newId(),
    authorId,
    title,
    body,
    scope: input.scope || 'general',
    isPublic: input.isPublic === true,
    moderationState: 'visible',
    moderatedBy: null,
    moderationReason: null,
    moderatedAt: null,
    commentCount: 0,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'community.post.create',
    actorId: authorId,
    targetType: 'post',
    targetId: row.id,
    detail: { scope: row.scope, isPublic: row.isPublic },
  });
  return row;
}

export async function listFeed(ctx: FeatureContext, opts: { limit?: number; offset?: number; scope?: string } = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const filter: Row = { moderationState: 'visible' };
  if (opts.scope) filter.scope = opts.scope;
  const items = await ctx.repo.find(POSTS, filter, { limit, offset, orderBy: 'createdAt', desc: true });
  const total = await ctx.repo.count(POSTS, filter);
  return { items, total, limit, offset };
}

export async function getPost(ctx: FeatureContext, id: string) {
  const post = await ctx.repo.get(POSTS, id);
  if (!post || post.moderationState === 'removed') throw notFound('Post not found');
  if (post.moderationState !== 'visible') throw notFound('Post not found');
  const comments = await ctx.repo.find(COMMENTS, { postId: id, moderationState: 'visible' }, { orderBy: 'createdAt' });
  return { ...post, comments };
}

export async function editOwnPost(ctx: FeatureContext, actorId: string, id: string, patch: { title?: string; body?: string }) {
  const post = await ctx.repo.get(POSTS, id);
  if (!post || post.moderationState === 'removed') throw notFound('Post not found');
  if (post.authorId !== actorId) throw forbidden('You may only edit your own posts');
  if (post.moderationState === 'hidden') throw conflict('A hidden post cannot be edited');
  const next: Row = {};
  if (patch.title != null) next.title = text(patch.title, 'title', 200);
  if (patch.body != null) next.body = text(patch.body, 'body');
  if (!Object.keys(next).length) throw badRequest('Nothing to update');
  const updated = await ctx.repo.update(POSTS, id, next);
  await ctx.audit.record({ action: 'community.post.update', actorId, targetType: 'post', targetId: id });
  return updated;
}

export async function deleteOwnPost(ctx: FeatureContext, actorId: string, id: string) {
  const post = await ctx.repo.get(POSTS, id);
  if (!post || post.moderationState === 'removed') throw notFound('Post not found');
  if (post.authorId !== actorId) throw forbidden('You may only delete your own posts');
  const updated = await ctx.repo.update(POSTS, id, {
    moderationState: 'removed',
    moderatedBy: actorId,
    moderationReason: 'author_deleted',
    moderatedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'community.post.delete_own', actorId, targetType: 'post', targetId: id });
  return updated;
}

/* --------------------------------------------------------------- comments */

export async function addComment(ctx: FeatureContext, authorId: string, postId: string, input: { body?: string } = {}) {
  const body = text(input.body, 'body');
  const post = await ctx.repo.get(POSTS, postId);
  if (!post || post.moderationState === 'removed') throw notFound('Post not found');
  if (post.moderationState !== 'visible') throw conflict('Comments are closed on a post that is not visible');

  const block = await ctx.repo.findOne(BLOCKS, { blockerId: post.authorId, blockedId: authorId });
  if (block) throw forbidden('You are blocked from interacting with this member');

  const row = await ctx.repo.insert(COMMENTS, {
    id: ctx.newId(),
    postId,
    authorId,
    body,
    moderationState: 'visible',
    moderatedBy: null,
    moderationReason: null,
    moderatedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.repo.update(POSTS, postId, { commentCount: (post.commentCount || 0) + 1 });
  await ctx.audit.record({ action: 'community.comment.create', actorId: authorId, targetType: 'comment', targetId: row.id, detail: { postId } });
  return row;
}

/* ------------------------------------------------------------- moderation */

export async function moderatePost(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: { state?: string; reason?: string } = {},
) {
  if (!stateOk(input.state)) throw badRequest(`state must be one of ${MODERATION_STATES.join(', ')}`);
  const reason = text(input.reason, 'reason', 500);
  const post = await ctx.repo.get(POSTS, id);
  if (!post) throw notFound('Post not found');
  if (post.moderationState === input.state) throw conflict(`Post is already ${input.state}`);
  const updated = await ctx.repo.update(POSTS, id, {
    moderationState: input.state,
    moderatedBy: actorId,
    moderationReason: reason,
    moderatedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'community.post.moderate',
    actorId,
    targetType: 'post',
    targetId: id,
    detail: { state: input.state, reason, previousState: post.moderationState },
  });
  return updated;
}

/* ---------------------------------------------------------------- reports */

export async function reportContent(
  ctx: FeatureContext,
  reporterId: string,
  input: { targetType?: string; targetId?: string; reason?: string } = {},
) {
  if (!input.targetType || !(REPORT_TARGETS as readonly string[]).includes(input.targetType)) {
    throw badRequest(`targetType must be one of ${REPORT_TARGETS.join(', ')}`);
  }
  if (!input.targetId) throw badRequest('targetId is required');
  const reason = text(input.reason, 'reason', 500);

  if (input.targetType === 'post') {
    const p = await ctx.repo.get(POSTS, input.targetId);
    if (!p) throw notFound('Reported post not found');
  }
  if (input.targetType === 'comment') {
    const c = await ctx.repo.get(COMMENTS, input.targetId);
    if (!c) throw notFound('Reported comment not found');
  }

  const dupe = await ctx.repo.findOne(REPORTS, {
    reporterId,
    targetType: input.targetType,
    targetId: input.targetId,
    status: 'open',
  });
  if (dupe) throw conflict('You have already reported this content and it is awaiting review');

  const row = await ctx.repo.insert(REPORTS, {
    id: ctx.newId(),
    reporterId,
    targetType: input.targetType,
    targetId: input.targetId,
    reason,
    status: 'open',
    // a report is a restricted case, not a finding of fact
    verified: false,
    resolvedBy: null,
    resolutionReason: null,
    outcome: null,
    resolvedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'community.report.create',
    actorId: reporterId,
    targetType: 'report',
    targetId: row.id,
    detail: { reportedType: input.targetType, reportedId: input.targetId },
  });
  return row;
}

export async function listReports(ctx: FeatureContext, opts: { status?: string; limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const filter: Row = {};
  if (opts.status) filter.status = opts.status;
  const items = await ctx.repo.find(REPORTS, filter, { limit, offset, orderBy: 'createdAt', desc: true });
  const total = await ctx.repo.count(REPORTS, filter);
  return { items, total, limit, offset };
}

export async function resolveReport(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: { outcome?: string; reason?: string; hideContent?: boolean } = {},
) {
  const outcome = input.outcome;
  if (outcome !== 'upheld' && outcome !== 'dismissed') throw badRequest('outcome must be upheld or dismissed');
  const reason = text(input.reason, 'reason', 500);
  const report = await ctx.repo.get(REPORTS, id);
  if (!report) throw notFound('Report not found');
  if (report.status !== 'open') throw conflict(`Report is already ${report.status}`);

  if (outcome === 'upheld' && input.hideContent === true) {
    if (report.targetType === 'post') {
      const post = await ctx.repo.get(POSTS, report.targetId);
      if (post && post.moderationState === 'visible') {
        await ctx.repo.update(POSTS, report.targetId, {
          moderationState: 'hidden',
          moderatedBy: actorId,
          moderationReason: reason,
          moderatedAt: ctx.now(),
        });
        await ctx.audit.record({
          action: 'community.post.moderate',
          actorId,
          targetType: 'post',
          targetId: report.targetId,
          detail: { state: 'hidden', reason, viaReport: id },
        });
      }
    }
    if (report.targetType === 'comment') {
      const comment = await ctx.repo.get(COMMENTS, report.targetId);
      if (comment && comment.moderationState === 'visible') {
        await ctx.repo.update(COMMENTS, report.targetId, {
          moderationState: 'hidden',
          moderatedBy: actorId,
          moderationReason: reason,
          moderatedAt: ctx.now(),
        });
      }
    }
  }

  const updated = await ctx.repo.update(REPORTS, id, {
    status: 'resolved',
    verified: outcome === 'upheld',
    outcome,
    resolutionReason: reason,
    resolvedBy: actorId,
    resolvedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'community.report.resolve',
    actorId,
    targetType: 'report',
    targetId: id,
    detail: { outcome, reason },
  });
  return updated;
}

/* ----------------------------------------------------------------- blocks */

export async function blockMember(ctx: FeatureContext, actorId: string, targetUserId: string) {
  if (!targetUserId) throw badRequest('memberId is required');
  if (targetUserId === actorId) throw badRequest('You cannot block yourself');
  const existing = await ctx.repo.findOne(BLOCKS, { blockerId: actorId, blockedId: targetUserId });
  if (existing) throw conflict('Member is already blocked');
  const row = await ctx.repo.insert(BLOCKS, {
    id: ctx.newId(),
    blockerId: actorId,
    blockedId: targetUserId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'community.block.create', actorId, targetType: 'member', targetId: targetUserId });
  return row;
}

export async function isBlocked(ctx: FeatureContext, blockerId: string, blockedId: string): Promise<boolean> {
  const row = await ctx.repo.findOne(BLOCKS, { blockerId, blockedId });
  return !!row;
}
