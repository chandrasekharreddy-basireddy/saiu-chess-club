import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

/**
 * Feature 26 — Public Website & Club Branding
 *
 * Tables
 *  site_blocks — versioned public website content blocks.
 *                kind: hero | about | mission | committee | tournaments | academy |
 *                      achievements | gallery | notices | contact | membership |
 *                      privacy | accessibility
 *                status: draft -> in_review -> approved -> published -> archived
 *
 * Public reads only ever return `published` blocks, and only through `publicView`,
 * which strips author/reviewer identity, internal notes and any contact detail that
 * is not explicitly marked public. Public/private boundaries are therefore enforced
 * server-side, never by the client.
 */

export const BLOCKS = 'site_blocks';

export const KINDS = [
  'hero', 'about', 'mission', 'committee', 'tournaments', 'academy', 'achievements',
  'gallery', 'notices', 'contact', 'membership', 'privacy', 'accessibility',
] as const;

export type BlockKind = (typeof KINDS)[number];

/** fields of a contact block that may be shown to the public */
const PUBLIC_CONTACT_FIELDS = ['email', 'phone', 'officeHours', 'location'];

/** fields of a content block that are safe to publish */
const PUBLIC_FIELDS = ['id', 'kind', 'title', 'summary', 'body', 'heroImageUrl', 'links', 'publishedAt', 'version', 'seo'];

export interface BlockInput {
  kind: string;
  title: string;
  summary?: string;
  body?: string;
  heroImageUrl?: string;
  links?: Array<{ label: string; href: string }>;
  contact?: Record<string, any>;
  seo?: { title?: string; description?: string };
  internalNotes?: string;
}

function requireKind(kind: string): string {
  if (!kind || !KINDS.includes(kind as BlockKind)) {
    throw badRequest(`kind must be one of: ${KINDS.join(', ')}`);
  }
  return kind;
}

function cleanLinks(links: any): Array<{ label: string; href: string }> {
  if (links == null) return [];
  if (!Array.isArray(links)) throw badRequest('links must be an array of { label, href }');
  return links.map((l, i) => {
    if (!l || typeof l.href !== 'string' || !l.href.trim()) throw badRequest(`links[${i}].href is required`);
    return { label: String(l.label ?? l.href), href: l.href.trim() };
  });
}

/** Strips every field that must never reach an anonymous client. */
export function publicView(block: Row) {
  const out: Row = {};
  for (const f of PUBLIC_FIELDS) if (block[f] !== undefined && block[f] !== null) out[f] = block[f];
  if (block.contact && typeof block.contact === 'object') {
    const contact: Row = {};
    for (const f of PUBLIC_CONTACT_FIELDS) {
      if (block.contact[f] !== undefined && block.contact[f] !== null) contact[f] = block.contact[f];
    }
    out.contact = contact;
  }
  if (out.seo) {
    // SEO metadata must never carry private data: only these two keys survive.
    out.seo = { title: out.seo.title ?? null, description: out.seo.description ?? null };
  }
  return out;
}

export async function createBlock(ctx: FeatureContext, actorId: string, input: BlockInput) {
  if (!input || typeof input !== 'object') throw badRequest('A content block payload is required');
  const kind = requireKind(input.kind);
  if (!input.title || !String(input.title).trim()) throw badRequest('title is required');

  const existing = await ctx.repo.findOne(BLOCKS, { kind });
  const row = await ctx.repo.insert(BLOCKS, {
    id: ctx.newId(),
    kind,
    title: String(input.title).trim(),
    summary: input.summary ?? null,
    body: input.body ?? null,
    heroImageUrl: input.heroImageUrl ?? null,
    links: cleanLinks(input.links),
    contact: input.contact ?? null,
    seo: input.seo ?? null,
    internalNotes: input.internalNotes ?? null,
    status: 'draft',
    version: 1,
    supersedesId: null,
    authorId: actorId,
    reviewerId: null,
    approvedBy: null,
    publishedAt: null,
    archivedAt: null,
    isFirstOfKind: !existing,
  });
  await ctx.audit.record({ action: 'site.block.create', actorId, targetType: 'site_block', targetId: row.id, detail: { kind } });
  return row;
}

export async function updateBlock(ctx: FeatureContext, actorId: string, id: string, patch: Partial<BlockInput>) {
  const block = await ctx.repo.get(BLOCKS, id);
  if (!block) throw notFound('Content block not found');
  if (block.status === 'published') throw conflict('A published block must be archived before it is edited');
  if (block.status === 'in_review') throw conflict('A block under review cannot be edited; withdraw it first');
  if (block.status === 'approved') throw conflict('An approved block cannot be edited; archive it and create a new draft');
  if (patch?.kind && patch.kind !== block.kind) throw conflict('The kind of a content block cannot be changed');

  const next: Row = { ...patch, updatedBy: actorId };
  delete (next as any).status;
  delete (next as any).version;
  if (patch?.title != null) {
    if (!String(patch.title).trim()) throw badRequest('title cannot be empty');
    next.title = String(patch.title).trim();
  }
  if (patch?.links !== undefined) next.links = cleanLinks(patch.links);
  const updated = await ctx.repo.update(BLOCKS, id, next);
  await ctx.audit.record({ action: 'site.block.update', actorId, targetType: 'site_block', targetId: id });
  return updated;
}

export async function submitBlock(ctx: FeatureContext, actorId: string, id: string) {
  const block = await ctx.repo.get(BLOCKS, id);
  if (!block) throw notFound('Content block not found');
  if (block.status !== 'draft') throw conflict(`Only a draft can be submitted for review (current: ${block.status})`);
  const updated = await ctx.repo.update(BLOCKS, id, { status: 'in_review', submittedAt: ctx.now() });
  await ctx.audit.record({ action: 'site.block.submit', actorId, targetType: 'site_block', targetId: id });
  return updated;
}

export async function approveBlock(ctx: FeatureContext, actorId: string, id: string) {
  const block = await ctx.repo.get(BLOCKS, id);
  if (!block) throw notFound('Content block not found');
  if (block.status !== 'in_review') throw conflict(`Only a block under review can be approved (current: ${block.status})`);
  if (block.authorId && block.authorId === actorId) {
    throw forbidden('Separation of duties: the author cannot approve their own content block');
  }
  const updated = await ctx.repo.update(BLOCKS, id, { status: 'approved', approvedBy: actorId, approvedAt: ctx.now() });
  await ctx.audit.record({ action: 'site.block.approve', actorId, targetType: 'site_block', targetId: id });
  return updated;
}

export async function publishBlock(ctx: FeatureContext, actorId: string, id: string) {
  const block = await ctx.repo.get(BLOCKS, id);
  if (!block) throw notFound('Content block not found');
  if (block.status !== 'approved') throw conflict(`Only an approved block can be published (current: ${block.status})`);

  // One live block per kind: retire the previous published version.
  const live = await ctx.repo.find(BLOCKS, { kind: block.kind, status: 'published' });
  let version = 1;
  let supersedesId: string | null = null;
  for (const old of live) {
    if (old.id === id) continue;
    version = Math.max(version, (old.version ?? 1) + 1);
    supersedesId = old.id;
    await ctx.repo.update(BLOCKS, old.id, { status: 'archived', archivedAt: ctx.now() });
  }

  const updated = await ctx.repo.update(BLOCKS, id, {
    status: 'published',
    version,
    supersedesId,
    publishedBy: actorId,
    publishedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'site.block.publish', actorId, targetType: 'site_block', targetId: id,
    detail: { kind: block.kind, version },
  });
  return updated;
}

export async function archiveBlock(ctx: FeatureContext, actorId: string, id: string) {
  const block = await ctx.repo.get(BLOCKS, id);
  if (!block) throw notFound('Content block not found');
  if (block.status !== 'published' && block.status !== 'approved') {
    throw conflict(`Only a published or approved block can be archived (current: ${block.status})`);
  }
  const updated = await ctx.repo.update(BLOCKS, id, { status: 'archived', archivedAt: ctx.now() });
  await ctx.audit.record({ action: 'site.block.archive', actorId, targetType: 'site_block', targetId: id });
  return updated;
}

/** Public list of published blocks. Anonymous-safe. */
export async function publicBlocks(ctx: FeatureContext, kind?: string) {
  const filter: Row = { status: 'published' };
  if (kind) filter.kind = requireKind(kind);
  const rows = await ctx.repo.find(BLOCKS, filter, { orderBy: 'publishedAt', desc: true });
  return rows.map(publicView);
}

/** Public single block by kind. Drafts are invisible. */
export async function publicBlockByKind(ctx: FeatureContext, kind: string) {
  requireKind(kind);
  const block = await ctx.repo.findOne(BLOCKS, { kind, status: 'published' });
  if (!block) throw notFound('No published content for this section');
  return publicView(block);
}

export async function adminBlocks(ctx: FeatureContext, filter: { status?: string; kind?: string } = {}) {
  const f: Row = {};
  if (filter.status) f.status = filter.status;
  if (filter.kind) f.kind = requireKind(filter.kind);
  return ctx.repo.find(BLOCKS, f, { orderBy: 'createdAt', desc: true });
}

export async function getBlock(ctx: FeatureContext, id: string) {
  const block = await ctx.repo.get(BLOCKS, id);
  if (!block) throw notFound('Content block not found');
  return block;
}
