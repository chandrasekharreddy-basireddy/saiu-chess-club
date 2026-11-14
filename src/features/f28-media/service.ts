import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, quotaExceeded, unprocessable } from '../../core/errors.js';

/**
 * Feature 28 — Media, Gallery & Digital Archive
 *
 * Tables
 *  media_items            — photos / documents / event media (private by default).
 *  media_takedown_requests — report / takedown workflow raised by anyone.
 *
 * Rules encoded here:
 *  - private until publication approval (status: pending -> approved -> published,
 *    plus rejected / removed);
 *  - every item must carry source/owner and licence metadata;
 *  - identifiable people require recorded consent before approval;
 *  - per-item size cap and a per-contributor upload quota (bytes);
 *  - original-resolution downloads can be restricted to media managers;
 *  - takedowns are state changes and are audited.
 * Video is out of scope for storage: external links only.
 */

export const ITEMS = 'media_items';
export const TAKEDOWNS = 'media_takedown_requests';

export const MAX_ITEM_BYTES = 20 * 1024 * 1024;        // 20 MB per item
export const CONTRIBUTOR_QUOTA_BYTES = 60 * 1024 * 1024; // 60 MB per contributor

export const CONSENT_STATES = ['not_required', 'pending', 'granted', 'denied'] as const;

export interface MediaInput {
  title: string;
  caption?: string;
  albumId?: string;
  eventDate?: string;
  archiveYear?: number;
  tags?: string[];
  sourceOwner?: string;
  licence?: string;
  sourceUrl?: string;
  identifiablePeople?: boolean;
  consentStatus?: string;
  storageBytes?: number;
  mediaType?: string;
  externalUrl?: string;
  downloadRestricted?: boolean;
}

function year(value: any, field = 'archiveYear'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1900 || n > 2100) throw badRequest(`${field} must be a four-digit year`);
  return n;
}

function normTags(tags: any): string[] {
  if (tags == null) return [];
  if (!Array.isArray(tags)) throw badRequest('tags must be an array of strings');
  const out: string[] = [];
  for (const t of tags) {
    const s = String(t).trim().toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Fields safe for an anonymous/public client. */
export function publicView(item: Row) {
  return {
    id: item.id,
    title: item.title,
    caption: item.caption ?? null,
    albumId: item.albumId ?? null,
    eventDate: item.eventDate ?? null,
    archiveYear: item.archiveYear ?? null,
    tags: item.tags ?? [],
    contributorName: item.contributorName ?? null,
    mediaType: item.mediaType ?? 'photo',
    previewUrl: item.previewUrl ?? item.externalUrl ?? null,
    downloadRestricted: !!item.downloadRestricted,
    publishedAt: item.publishedAt ?? null,
  };
}

async function usedQuota(ctx: FeatureContext, contributorId: string): Promise<number> {
  const rows = await ctx.repo.find(ITEMS, { contributorId });
  return rows.reduce((sum: number, r: Row) => sum + (Number(r.storageBytes) || 0), 0);
}

export async function createItem(ctx: FeatureContext, contributorId: string, input: MediaInput) {
  if (!input || typeof input !== 'object') throw badRequest('A media payload is required');
  if (!input.title || !String(input.title).trim()) throw badRequest('title is required');
  if (!input.sourceOwner || !String(input.sourceOwner).trim()) throw badRequest('sourceOwner (source/owner) is required');
  if (!input.licence || !String(input.licence).trim()) throw badRequest('licence (copyright/licence) is required');

  const storageBytes = input.storageBytes == null ? 0 : Number(input.storageBytes);
  if (!Number.isFinite(storageBytes) || storageBytes < 0) throw badRequest('storageBytes must be a non-negative number');
  if (storageBytes > MAX_ITEM_BYTES) {
    throw badRequest(`A single media item may not exceed ${MAX_ITEM_BYTES} bytes`);
  }

  const identifiable = !!input.identifiablePeople;
  let consentStatus = input.consentStatus ?? (identifiable ? 'pending' : 'not_required');
  if (!CONSENT_STATES.includes(consentStatus as any)) {
    throw badRequest(`consentStatus must be one of: ${CONSENT_STATES.join(', ')}`);
  }
  if (!identifiable) consentStatus = 'not_required';

  let archiveYear: number | null = null;
  if (input.archiveYear != null) archiveYear = year(input.archiveYear);
  else if (input.eventDate) {
    const d = new Date(input.eventDate);
    if (Number.isNaN(d.getTime())) throw badRequest('eventDate must be an ISO date');
    archiveYear = d.getUTCFullYear();
  } else archiveYear = new Date(ctx.now()).getUTCFullYear();

  const used = await usedQuota(ctx, contributorId);
  if (used + storageBytes > CONTRIBUTOR_QUOTA_BYTES) {
    throw quotaExceeded(`Upload quota exceeded: ${used} of ${CONTRIBUTOR_QUOTA_BYTES} bytes already used`);
  }

  const row = await ctx.repo.insert(ITEMS, {
    id: ctx.newId(),
    title: String(input.title).trim(),
    caption: input.caption ?? null,
    albumId: input.albumId ?? null,
    eventDate: input.eventDate ?? null,
    archiveYear,
    tags: normTags(input.tags),
    sourceOwner: String(input.sourceOwner).trim(),
    licence: String(input.licence).trim(),
    sourceUrl: input.sourceUrl ?? null,
    mediaType: input.mediaType ?? 'photo',
    externalUrl: input.externalUrl ?? null,
    identifiablePeople: identifiable,
    consentStatus,
    consentRecordedAt: consentStatus === 'granted' ? ctx.now() : null,
    storageBytes,
    downloadRestricted: !!input.downloadRestricted,
    status: 'pending',
    publishedAt: null,
    moderationNote: null,
    contributorId,
  });
  await ctx.audit.record({ action: 'media.item.create', actorId: contributorId, targetType: 'media_item', targetId: row.id, detail: { archiveYear } });
  return row;
}

export async function recordConsent(
  ctx: FeatureContext, actorId: string, id: string,
  input: { consentStatus?: string; evidence?: string } = {},
) {
  const item = await ctx.repo.get(ITEMS, id);
  if (!item) throw notFound('Media item not found');
  const status = input?.consentStatus;
  if (!status || !CONSENT_STATES.includes(status as any)) {
    throw badRequest(`consentStatus must be one of: ${CONSENT_STATES.join(', ')}`);
  }
  const updated = await ctx.repo.update(ITEMS, id, {
    consentStatus: status,
    consentEvidence: input.evidence ?? item.consentEvidence ?? null,
    consentRecordedAt: status === 'granted' ? ctx.now() : null,
    consentRecordedBy: actorId,
  });
  await ctx.audit.record({ action: 'media.item.consent', actorId, targetType: 'media_item', targetId: id, detail: { status } });
  return updated;
}

export async function approveItem(ctx: FeatureContext, actorId: string, id: string, note?: string) {
  const item = await ctx.repo.get(ITEMS, id);
  if (!item) throw notFound('Media item not found');
  if (item.status !== 'pending' && item.status !== 'rejected') {
    throw conflict(`Only a pending or rejected item can be approved (current: ${item.status})`);
  }
  if (item.identifiablePeople && item.consentStatus !== 'granted') {
    throw unprocessable('Identifiable people are present but consent has not been recorded');
  }
  const updated = await ctx.repo.update(ITEMS, id, {
    status: 'approved', approvedBy: actorId, approvedAt: ctx.now(), moderationNote: note ?? null,
  });
  await ctx.audit.record({ action: 'media.item.approve', actorId, targetType: 'media_item', targetId: id });
  return updated;
}

export async function publishItem(ctx: FeatureContext, actorId: string, id: string) {
  const item = await ctx.repo.get(ITEMS, id);
  if (!item) throw notFound('Media item not found');
  if (item.status !== 'approved') throw conflict(`Only an approved item can be published (current: ${item.status})`);
  if (item.identifiablePeople && item.consentStatus !== 'granted') {
    throw unprocessable('Identifiable people are present but consent has not been recorded');
  }
  const updated = await ctx.repo.update(ITEMS, id, { status: 'published', publishedAt: ctx.now(), publishedBy: actorId });
  await ctx.audit.record({ action: 'media.item.publish', actorId, targetType: 'media_item', targetId: id });
  return updated;
}

export async function rejectItem(ctx: FeatureContext, actorId: string, id: string, reason: string) {
  const item = await ctx.repo.get(ITEMS, id);
  if (!item) throw notFound('Media item not found');
  if (item.status !== 'pending') throw conflict(`Only a pending item can be rejected (current: ${item.status})`);
  if (!reason || !String(reason).trim()) throw badRequest('A moderation reason is required');
  const updated = await ctx.repo.update(ITEMS, id, {
    status: 'rejected', moderationNote: String(reason).trim(), moderatedBy: actorId, moderatedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'media.item.reject', actorId, targetType: 'media_item', targetId: id, detail: { reason } });
  return updated;
}

/** Removal of published media (or any item) from the public archive. Audited. */
export async function takedownItem(ctx: FeatureContext, actorId: string, id: string, reason: string) {
  const item = await ctx.repo.get(ITEMS, id);
  if (!item) throw notFound('Media item not found');
  if (!reason || !String(reason).trim()) throw badRequest('A takedown reason is required');
  if (item.status === 'removed') throw conflict('Item has already been removed');
  const updated = await ctx.repo.update(ITEMS, id, {
    status: 'removed', removedAt: ctx.now(), removedBy: actorId, removalReason: String(reason).trim(),
  });
  await ctx.audit.record({ action: 'media.item.takedown', actorId, targetType: 'media_item', targetId: id, detail: { reason } });
  return updated;
}

/** Anyone (member or public) may report an item for takedown. */
export async function requestTakedown(
  ctx: FeatureContext, requesterId: string | null, id: string,
  input: { reason?: string; contact?: string } = {},
) {
  const item = await ctx.repo.get(ITEMS, id);
  if (!item) throw notFound('Media item not found');
  if (!input?.reason || !String(input.reason).trim()) throw badRequest('A reason is required');
  const row = await ctx.repo.insert(TAKEDOWNS, {
    id: ctx.newId(),
    mediaId: id,
    requesterId: requesterId ?? null,
    reason: String(input.reason).trim(),
    contact: input.contact ?? null,
    status: 'open',
    raisedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'media.takedown.request', actorId: requesterId ?? undefined, targetType: 'media_item', targetId: id });
  return row;
}

export async function resolveTakedown(ctx: FeatureContext, actorId: string, requestId: string, outcome: string) {
  const req = await ctx.repo.get(TAKEDOWNS, requestId);
  if (!req) throw notFound('Takedown request not found');
  if (req.status !== 'open') throw conflict(`Takedown request is already ${req.status}`);
  if (!outcome || !['removed', 'rejected'].includes(String(outcome))) {
    throw badRequest("outcome must be 'removed' or 'rejected'");
  }
  const updated = await ctx.repo.update(TAKEDOWNS, requestId, {
    status: outcome, resolvedBy: actorId, resolvedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'media.takedown.resolve', actorId, targetType: 'media_takedown_request', targetId: requestId, detail: { outcome } });
  return updated;
}

/** Public gallery / archive search: published items only. */
export async function publicItems(
  ctx: FeatureContext,
  filter: { tag?: string; year?: string | number; albumId?: string; q?: string } = {},
) {
  const rows = await ctx.repo.find(ITEMS, { status: 'published' });
  const tag = filter.tag ? String(filter.tag).trim().toLowerCase() : null;
  const yearFilter = filter.year != null && String(filter.year) !== '' ? year(filter.year) : null;
  const q = filter.q ? String(filter.q).trim().toLowerCase() : null;
  return rows
    .filter((r: Row) => {
      if (tag && !(r.tags || []).includes(tag)) return false;
      if (yearFilter != null && Number(r.archiveYear) !== yearFilter) return false;
      if (filter.albumId && r.albumId !== filter.albumId) return false;
      if (q) {
        const hay = `${r.title ?? ''} ${r.caption ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a: Row, b: Row) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))
    .map(publicView);
}

export async function publicItem(ctx: FeatureContext, id: string) {
  const item = await ctx.repo.get(ITEMS, id);
  if (!item || item.status !== 'published') throw notFound('Media item not found');
  return publicView(item);
}

/** Full record for the contributor or a media manager. */
export async function getItem(ctx: FeatureContext, session: any, id: string) {
  const item = await ctx.repo.get(ITEMS, id);
  if (!item) throw notFound('Media item not found');
  const perms: string[] = session?.permissions ?? [];
  const canManage = perms.includes('*') || perms.includes('media.manage');
  if (!canManage && item.contributorId !== session?.userId) throw forbidden('You may not view this media item');
  return item;
}

export async function moderationQueue(ctx: FeatureContext) {
  return ctx.repo.find(ITEMS, { status: 'pending' }, { orderBy: 'createdAt' });
}

/** Archive year index (published items only). */
export async function archiveYears(ctx: FeatureContext) {
  const rows = await ctx.repo.find(ITEMS, { status: 'published' });
  const counts = new Map<number, number>();
  for (const r of rows) {
    const y = Number(r.archiveYear);
    if (!Number.isFinite(y)) continue;
    counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([archiveYear, count]) => ({ archiveYear, count }))
    .sort((a, b) => b.archiveYear - a.archiveYear);
}

/** Original-resolution download gate. */
export async function downloadItem(ctx: FeatureContext, session: any, id: string) {
  const item = await ctx.repo.get(ITEMS, id);
  if (!item) throw notFound('Media item not found');
  const perms: string[] = session?.permissions ?? [];
  const canManage = perms.includes('*') || perms.includes('media.manage');
  if (item.status !== 'published' && !canManage) throw notFound('Media item not found');
  if (item.downloadRestricted && !canManage) {
    throw forbidden('Original-resolution download of this item is restricted');
  }
  return { id: item.id, title: item.title, licence: item.licence, sourceOwner: item.sourceOwner, original: true };
}
