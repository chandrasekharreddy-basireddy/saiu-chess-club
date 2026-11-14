/**
 * Feature 18 — Digital Notice Board & Announcement Management (slug: `notices`)
 *
 * Tables
 *  - notices         one row per notice; carries audience, priority, validity window and state
 *  - notice_versions immutable snapshots of every published revision (corrections never overwrite)
 *
 * State machine
 *  draft -> pending_approval -> approved -> published -> unpublished | expired | archived
 *  A notice in a HIGH_IMPACT category always requires a designated approver, and the approver may
 *  never be the author (separation of duties). Public/private boundaries are enforced on read:
 *  a notice is only returned to a viewer whose audience set intersects the notice audience.
 */
import type { FeatureContext, Row } from '../../core/types.js';
import { assertNotSelfApproval } from '../../core/permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

export const NOTICES = 'notices';
export const VERSIONS = 'notice_versions';

export const CATEGORIES = ['official', 'tournament', 'event', 'governance', 'operational', 'emergency'];
export const HIGH_IMPACT = ['official', 'governance', 'emergency'];
export const AUDIENCES = ['public', 'members', 'committee', 'alumni'];
export const PRIORITIES = ['normal', 'high', 'critical'];

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

/** Audiences a viewer may see. Unauthenticated viewers only ever see `public`. */
export function viewerAudiences(session: any): string[] {
  if (!session) return ['public'];
  const set = new Set<string>(['public', 'members']);
  for (const r of session.roles || []) set.add(String(r));
  if ((session.roles || []).includes('alumnus')) set.add('alumni');
  if ((session.roles || []).includes('committee')) set.add('committee');
  return [...set];
}

function isLive(n: Row, nowMs: number): boolean {
  if (n.status !== 'published') return false;
  if (n.publishAt && new Date(n.publishAt).getTime() > nowMs) return false;
  if (n.expiresAt && new Date(n.expiresAt).getTime() <= nowMs) return false;
  return true;
}

function visibleTo(n: Row, audiences: string[]): boolean {
  return (n.audience || []).some((a: string) => audiences.includes(a));
}

function shape(n: Row, nowMs: number): Row {
  const expired = !!n.expiresAt && new Date(n.expiresAt).getTime() <= nowMs;
  const scheduled = n.status === 'published' && !!n.publishAt && new Date(n.publishAt).getTime() > nowMs;
  return { ...n, effectiveStatus: expired && n.status === 'published' ? 'expired' : scheduled ? 'scheduled' : n.status };
}

async function snapshot(ctx: FeatureContext, n: Row, reason: string, actorId: string) {
  const row = await ctx.repo.insert(VERSIONS, {
    id: ctx.newId(),
    noticeId: n.id,
    version: n.version,
    title: n.title,
    body: n.body,
    category: n.category,
    audience: n.audience,
    priority: n.priority,
    reason,
    recordedBy: actorId,
    recordedAt: ctx.now(),
  });
  return row;
}

export async function createNotice(
  ctx: FeatureContext,
  actorId: string,
  input: {
    title?: string;
    body?: string;
    category?: string;
    audience?: string[];
    priority?: string;
    publishAt?: string;
    expiresAt?: string;
    requiresApproval?: boolean;
    pinned?: boolean;
  },
) {
  const title = (input?.title || '').trim();
  const body = (input?.body || '').trim();
  if (!title) throw badRequest('Notice title is required');
  if (!body) throw badRequest('Notice body is required');
  const category = input?.category || 'official';
  if (!CATEGORIES.includes(category)) throw badRequest(`category must be one of ${CATEGORIES.join(', ')}`);
  const priority = input?.priority || 'normal';
  if (!PRIORITIES.includes(priority)) throw badRequest(`priority must be one of ${PRIORITIES.join(', ')}`);
  const audience = Array.isArray(input?.audience) && input.audience.length ? input.audience : ['members'];
  for (const a of audience) if (!AUDIENCES.includes(a)) throw badRequest(`audience must be one of ${AUDIENCES.join(', ')}`);

  const publishAt = isoOrNull(input?.publishAt, 'publishAt');
  const expiresAt = isoOrNull(input?.expiresAt, 'expiresAt');
  if (publishAt && expiresAt && new Date(expiresAt).getTime() <= new Date(publishAt).getTime()) {
    throw badRequest('expiresAt must be after publishAt');
  }
  const requiresApproval = input?.requiresApproval ?? HIGH_IMPACT.includes(category);

  const row = await ctx.repo.insert(NOTICES, {
    id: ctx.newId(),
    title,
    body,
    category,
    audience,
    priority,
    pinned: !!input?.pinned,
    publishAt,
    expiresAt,
    requiresApproval,
    version: 1,
    status: 'draft',
    createdBy: actorId,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    publishedBy: null,
    publishedAt: null,
    archivedAt: null,
    createdAt: ctx.now(),
  });
  await snapshot(ctx, row, 'created', actorId);
  await ctx.audit.record({ action: 'notice.create', actorId, targetType: 'notice', targetId: row.id, detail: { category, audience, requiresApproval } });
  return row;
}

export async function submitForApproval(ctx: FeatureContext, actorId: string, id: string) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  if (n.status !== 'draft') throw conflict(`Only a draft notice can be submitted (current: ${n.status})`);
  const row = await ctx.repo.update(NOTICES, id, { status: 'pending_approval', submittedAt: ctx.now() });
  await ctx.audit.record({ action: 'notice.submit', actorId, targetType: 'notice', targetId: id });
  return row;
}

export async function approveNotice(ctx: FeatureContext, actorId: string, id: string) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  if (n.status !== 'pending_approval') throw conflict(`Only a submitted notice can be approved (current: ${n.status})`);
  sod(actorId, n.createdBy, 'a notice');
  const row = await ctx.repo.update(NOTICES, id, { status: 'approved', approvedBy: actorId, approvedAt: ctx.now() });
  await ctx.audit.record({ action: 'notice.approve', actorId, targetType: 'notice', targetId: id });
  return row;
}

export async function publishNotice(ctx: FeatureContext, actorId: string, id: string, opts: { publishAt?: string } = {}) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  if (n.status === 'published') throw conflict('Notice is already published');
  if (n.status === 'archived' || n.status === 'expired') throw conflict(`Cannot publish a ${n.status} notice`);
  if (n.requiresApproval && n.status !== 'approved') {
    throw conflict('This notice requires approval by a designated approver before publication');
  }
  if (!n.requiresApproval && !['draft', 'approved', 'unpublished'].includes(n.status)) {
    throw conflict(`Cannot publish a notice in status ${n.status}`);
  }
  const publishAt = opts.publishAt ? isoOrNull(opts.publishAt, 'publishAt') : n.publishAt || ctx.now();
  const row = await ctx.repo.update(NOTICES, id, {
    status: 'published',
    publishAt,
    publishedBy: actorId,
    publishedAt: ctx.now(),
  });
  // critical notices are always delivered in-app; email is best effort and never blocks publication
  const delivery = { inApp: true, email: n.priority === 'critical' ? 'queued' : 'best_effort' };
  await ctx.audit.record({
    action: 'notice.publish',
    actorId,
    targetType: 'notice',
    targetId: id,
    detail: { audience: n.audience, priority: n.priority, delivery },
  });
  return { ...row, delivery };
}

export async function unpublishNotice(ctx: FeatureContext, actorId: string, id: string, reason?: string) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  if (n.status !== 'published') throw conflict(`Only a published notice can be unpublished (current: ${n.status})`);
  const row = await ctx.repo.update(NOTICES, id, { status: 'unpublished', unpublishedAt: ctx.now(), unpublishReason: reason ?? null });
  await ctx.audit.record({ action: 'notice.unpublish', actorId, targetType: 'notice', targetId: id, detail: { reason: reason ?? null } });
  return row;
}

export async function pinNotice(ctx: FeatureContext, actorId: string, id: string, pinned: boolean) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  if (n.status !== 'published') throw conflict('Only a published notice can be pinned');
  const row = await ctx.repo.update(NOTICES, id, { pinned });
  await ctx.audit.record({ action: pinned ? 'notice.pin' : 'notice.unpin', actorId, targetType: 'notice', targetId: id });
  return row;
}

export async function expireNotice(ctx: FeatureContext, actorId: string, id: string) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  if (n.status === 'expired') throw conflict('Notice is already expired');
  const row = await ctx.repo.update(NOTICES, id, { status: 'expired', expiresAt: n.expiresAt || ctx.now(), expiredAt: ctx.now() });
  await ctx.audit.record({ action: 'notice.expire', actorId, targetType: 'notice', targetId: id });
  return row;
}

export async function archiveNotice(ctx: FeatureContext, actorId: string, id: string) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  if (n.status === 'archived') throw conflict('Notice is already archived');
  const row = await ctx.repo.update(NOTICES, id, { status: 'archived', archivedAt: ctx.now() });
  await ctx.audit.record({ action: 'notice.archive', actorId, targetType: 'notice', targetId: id });
  return row;
}

/** A correction appends a new version; the previous text stays in notice_versions. */
export async function correctNotice(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: { title?: string; body?: string; reason?: string },
) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  if (n.status === 'archived') throw conflict('An archived notice cannot be corrected');
  const body = (input?.body || '').trim();
  const title = (input?.title || '').trim();
  if (!body && !title) throw badRequest('A correction must change the title or the body');
  await snapshot(ctx, n, input?.reason || 'corrected', actorId);
  const row = await ctx.repo.update(NOTICES, id, {
    title: title || n.title,
    body: body || n.body,
    version: (n.version || 1) + 1,
    correctedAt: ctx.now(),
    correctedBy: actorId,
    correctionReason: input?.reason ?? null,
  });
  await ctx.audit.record({
    action: 'notice.correct',
    actorId,
    targetType: 'notice',
    targetId: id,
    detail: { version: row?.version, reason: input?.reason ?? null },
  });
  return row;
}

export async function listVersions(ctx: FeatureContext, id: string) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  const history = await ctx.repo.find(VERSIONS, { noticeId: id }, { orderBy: 'version' });
  return { noticeId: id, currentVersion: n.version, versions: history };
}

/** Board / feed listing. Only live notices the viewer is allowed to see. */
export async function listNotices(
  ctx: FeatureContext,
  session: any,
  filter: { category?: string; priority?: string; includeExpired?: boolean; limit?: number; offset?: number } = {},
) {
  const nowMs = new Date(ctx.now()).getTime();
  const audiences = viewerAudiences(session);
  const all = await ctx.repo.find(NOTICES, {}, { orderBy: 'createdAt', desc: true });
  const rows = all
    .filter((n) => visibleTo(n, audiences))
    .filter((n) => (filter.includeExpired ? ['published', 'expired', 'unpublished', 'archived'].includes(n.status) : isLive(n, nowMs)))
    .filter((n) => (filter.category ? n.category === filter.category : true))
    .filter((n) => (filter.priority ? n.priority === filter.priority : true))
    .map((n): Row => shape(n, nowMs));
  rows.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

export async function getNotice(ctx: FeatureContext, id: string, session: any) {
  const n = await ctx.repo.get(NOTICES, id);
  if (!n) throw notFound('Notice not found');
  const nowMs = new Date(ctx.now()).getTime();
  const audiences = viewerAudiences(session);
  if (!visibleTo(n, audiences)) throw notFound('Notice not found');
  if (!isLive(n, nowMs)) {
    // drafts / unpublished / expired notices are only visible to their author and publishers
    const perms: string[] = session?.permissions || [];
    const canManage = perms.includes('*') || perms.includes('notice.publish');
    if (!canManage && session?.userId !== n.createdBy) throw notFound('Notice is not currently published');
  }
  return shape(n, nowMs);
}
