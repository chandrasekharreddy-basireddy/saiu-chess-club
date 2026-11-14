import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertNotSelfApproval, hasPermission } from '../../core/permissions.js';

/**
 * Feature 33 — Knowledge Base, Documentation & Resource Centre.
 *
 * Tables (created implicitly by the first insert):
 *   kb_articles  one row per article (current revision + publication state)
 *   kb_versions  immutable snapshot of every previous revision (history/archive)
 *
 * Rules enforced here:
 *  - every article has an owner, a version number and a review date;
 *  - slugs are unique and stable (they are the public URL);
 *  - drafts and archived articles are invisible to public reads and to search;
 *  - only published articles with a public audience/visibility are readable
 *    without a session, and restricted material needs `kb.publish`;
 *  - publishing an official policy requires a second, authorized editor
 *    (separation of duties) — the author can never self-publish a policy;
 *  - external material must declare its source/licence.
 */

export const ARTICLE = 'kb_articles';
export const VERSION = 'kb_versions';

export const AUDIENCES = ['public', 'members', 'committee'];
export const VISIBILITIES = ['public', 'internal', 'restricted'];
const REVIEW_INTERVAL_DAYS = 180;

function isEditor(session: any): boolean {
  return hasPermission(session, 'kb.publish');
}

export function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function assertSlug(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw badRequest('slug must be lower-case letters, digits and single hyphens');
  }
}

function reviewDate(ctx: FeatureContext, provided?: string): string {
  if (provided) {
    if (Number.isNaN(new Date(provided).getTime())) throw badRequest('reviewDueAt must be an ISO date');
    return new Date(provided).toISOString();
  }
  return new Date(new Date(ctx.now()).getTime() + REVIEW_INTERVAL_DAYS * 24 * 3600 * 1000).toISOString();
}

export async function createArticle(ctx: FeatureContext, actorId: string, input: any = {}) {
  const title = (input.title || '').trim();
  if (!title) throw badRequest('Article title is required');
  if (!input.body || !input.body.toString().trim()) throw badRequest('Article body is required');

  const slug = slugify(input.slug || title);
  assertSlug(slug);
  const clash = await ctx.repo.findOne(ARTICLE, { slug });
  if (clash) throw conflict(`An article with slug "${slug}" already exists`);

  const audience = (input.audience || 'members').toString().toLowerCase();
  if (!AUDIENCES.includes(audience)) throw badRequest(`audience must be one of ${AUDIENCES.join(', ')}`);
  const visibility = (input.visibility || (audience === 'public' ? 'public' : 'internal')).toString().toLowerCase();
  if (!VISIBILITIES.includes(visibility)) throw badRequest(`visibility must be one of ${VISIBILITIES.join(', ')}`);

  const isPolicy = !!input.isPolicy;
  const external = !!input.external;
  if (external && !input.source) throw badRequest('External material must record its source/licence');

  const article = await ctx.repo.insert(ARTICLE, {
    id: ctx.newId(),
    slug,
    title,
    summary: input.summary ? input.summary.toString() : null,
    body: input.body.toString(),
    category: (input.category || 'general').toString(),
    tags: Array.isArray(input.tags) ? input.tags.map((t: any) => t.toString()) : [],
    audience,
    visibility,
    isPolicy,
    external,
    source: input.source ? input.source.toString() : null,
    licence: input.licence ? input.licence.toString() : null,
    ownerId: actorId,
    status: 'draft',
    version: 1,
    reviewDueAt: reviewDate(ctx, input.reviewDueAt),
    publishedAt: null,
    publishedBy: null,
    archivedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'kb.article.create',
    actorId,
    targetType: 'article',
    targetId: article.id,
    detail: { slug, isPolicy },
  });
  return article;
}

export async function updateArticle(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const article = await ctx.repo.get(ARTICLE, id);
  if (!article) throw notFound('Article not found');
  if (article.status === 'archived') throw conflict('Archived articles cannot be edited');

  if (input.slug && slugify(input.slug) !== article.slug) {
    const next = slugify(input.slug);
    assertSlug(next);
    const clash = await ctx.repo.findOne(ARTICLE, { slug: next });
    if (clash && clash.id !== id) throw conflict(`An article with slug "${next}" already exists`);
    input.slug = next;
  }
  if (input.audience) {
    const a = input.audience.toString().toLowerCase();
    if (!AUDIENCES.includes(a)) throw badRequest(`audience must be one of ${AUDIENCES.join(', ')}`);
  }
  if (input.visibility) {
    const v = input.visibility.toString().toLowerCase();
    if (!VISIBILITIES.includes(v)) throw badRequest(`visibility must be one of ${VISIBILITIES.join(', ')}`);
  }

  // Preserve the outgoing revision before changing anything.
  await ctx.repo.insert(VERSION, {
    id: ctx.newId(),
    articleId: id,
    version: article.version,
    title: article.title,
    body: article.body,
    summary: article.summary ?? null,
    audience: article.audience,
    visibility: article.visibility,
    status: article.status,
    savedBy: actorId,
    savedAt: ctx.now(),
  });

  const patch: Row = {
    version: (article.version ?? 1) + 1,
    title: input.title ? input.title.toString().trim() : article.title,
    body: input.body ? input.body.toString() : article.body,
    summary: input.summary !== undefined ? input.summary : article.summary ?? null,
    category: input.category ? input.category.toString() : article.category,
    tags: Array.isArray(input.tags) ? input.tags.map((t: any) => t.toString()) : article.tags ?? [],
    audience: input.audience ? input.audience.toString().toLowerCase() : article.audience,
    visibility: input.visibility ? input.visibility.toString().toLowerCase() : article.visibility,
    reviewDueAt: input.reviewDueAt ? reviewDate(ctx, input.reviewDueAt) : article.reviewDueAt,
    lastEditedBy: actorId,
    lastEditedAt: ctx.now(),
  };
  const updated = await ctx.repo.update(ARTICLE, id, patch);
  await ctx.audit.record({
    action: 'kb.article.update',
    actorId,
    targetType: 'article',
    targetId: id,
    detail: { version: patch.version },
  });
  return updated;
}

export async function publishArticle(ctx: FeatureContext, actorId: string, id: string) {
  const article = await ctx.repo.get(ARTICLE, id);
  if (!article) throw notFound('Article not found');
  if (article.status === 'published') throw conflict('Article is already published');
  if (article.status === 'archived') throw conflict('Archived articles cannot be published');
  if (!article.reviewDueAt) throw conflict('An article needs a review date before publication');

  // Official policy needs an authorized second pair of eyes.
  if (article.isPolicy) {
    try {
      assertNotSelfApproval(actorId, article.ownerId, 'this policy publication');
    } catch (e: any) {
      throw forbidden(e?.message || 'Separation of duties: the author cannot publish a policy alone');
    }
  }

  const updated = await ctx.repo.update(ARTICLE, id, {
    status: 'published',
    publishedAt: ctx.now(),
    publishedBy: actorId,
  });
  await ctx.audit.record({
    action: 'kb.article.publish',
    actorId,
    targetType: 'article',
    targetId: id,
    detail: { isPolicy: !!article.isPolicy, version: article.version },
  });
  return updated;
}

export async function archiveArticle(ctx: FeatureContext, actorId: string, id: string) {
  const article = await ctx.repo.get(ARTICLE, id);
  if (!article) throw notFound('Article not found');
  if (article.status === 'archived') throw conflict('Article is already archived');
  await ctx.repo.insert(VERSION, {
    id: ctx.newId(),
    articleId: id,
    version: article.version,
    title: article.title,
    body: article.body,
    summary: article.summary ?? null,
    audience: article.audience,
    visibility: article.visibility,
    status: 'archived',
    savedBy: actorId,
    savedAt: ctx.now(),
  });
  const updated = await ctx.repo.update(ARTICLE, id, { status: 'archived', archivedAt: ctx.now() });
  await ctx.audit.record({ action: 'kb.article.archive', actorId, targetType: 'article', targetId: id });
  return updated;
}

/** Can this session read this published article? */
function canRead(session: any, article: Row): boolean {
  if (isEditor(session)) return true;
  if (article.status !== 'published') return false;
  if (article.visibility === 'restricted') return false;
  if (article.visibility === 'public' && article.audience === 'public') return true;
  if (article.audience === 'public') return true;
  if (article.audience === 'members') return !!session;
  if (article.audience === 'committee') return !!session && (session.roles || []).includes('committee');
  return false;
}

export async function getArticleBySlug(ctx: FeatureContext, session: any, slug: string) {
  const article = await ctx.repo.findOne(ARTICLE, { slug });
  // Drafts and archived articles are indistinguishable from missing for readers.
  if (!article || !canRead(session, article)) throw notFound('Article not found');
  return article;
}

export async function getArticleById(ctx: FeatureContext, id: string) {
  const article = await ctx.repo.get(ARTICLE, id);
  if (!article) throw notFound('Article not found');
  const versions = await ctx.repo.find(VERSION, { articleId: id }, { orderBy: 'version' });
  return { ...article, history: versions };
}

export async function listPublished(ctx: FeatureContext, session: any, query: any = {}) {
  const where: Row = { status: 'published' };
  if (query.category) where.category = query.category.toString();
  const all = await ctx.repo.find(ARTICLE, where, { orderBy: 'publishedAt', desc: true });
  const visible = all.filter((a) => canRead(session, a));
  const q = (query.q || '').toString().trim().toLowerCase();
  const matched = q
    ? visible.filter((a) => matches(a, q))
    : visible;
  const limit = Math.min(Number(query.limit) || 20, 100);
  const offset = Number(query.offset) || 0;
  return { items: matched.slice(offset, offset + limit), total: matched.length, limit, offset };
}

function matches(a: Row, q: string): boolean {
  const haystack = [a.title, a.summary, a.body, (a.tags || []).join(' '), a.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

/** Search never leaks drafts, restricted documents or items above the caller's audience. */
export async function search(ctx: FeatureContext, session: any, query: any = {}) {
  const q = (query.q || '').toString().trim().toLowerCase();
  if (!q) throw badRequest('q is required');
  const all = await ctx.repo.find(ARTICLE, { status: 'published' });
  const hits = all.filter((a) => canRead(session, a) && matches(a, q));
  return {
    query: q,
    total: hits.length,
    items: hits.map((a) => ({ id: a.id, slug: a.slug, title: a.title, category: a.category, audience: a.audience })),
  };
}

export async function getVersions(ctx: FeatureContext, id: string) {
  const article = await ctx.repo.get(ARTICLE, id);
  if (!article) throw notFound('Article not found');
  const versions = await ctx.repo.find(VERSION, { articleId: id }, { orderBy: 'version' });
  return {
    articleId: id,
    currentVersion: article.version,
    versions: [
      ...versions.map((v) => ({ version: v.version, title: v.title, body: v.body, status: v.status, savedAt: v.savedAt })),
      { version: article.version, title: article.title, body: article.body, status: article.status, savedAt: article.lastEditedAt ?? article.createdAt },
    ],
  };
}

/** Articles whose review date has passed — expired guidance must be flagged. */
export async function reviewsDue(ctx: FeatureContext) {
  const now = new Date(ctx.now()).getTime();
  const all = await ctx.repo.find(ARTICLE, {}, { orderBy: 'reviewDueAt' });
  const due = all.filter((a) => a.status !== 'archived' && a.reviewDueAt && new Date(a.reviewDueAt).getTime() <= now);
  return due.map((a) => ({ id: a.id, slug: a.slug, title: a.title, reviewDueAt: a.reviewDueAt, status: a.status, expired: true }));
}
