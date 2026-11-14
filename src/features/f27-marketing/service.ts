import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';

/**
 * Feature 27 — Marketing, Public Relations & Digital Outreach
 *
 * Tables
 *  marketing_campaigns — outreach campaign records (brief -> draft -> in_review ->
 *                        approved -> published -> archived, plus `rejected`).
 *
 * External social platforms are recorded, never called: publishing stores the URL of
 * content that an authorised official posted (or a verified free integration posted).
 * No paid API, credential or automation is assumed.
 */

export const CAMPAIGNS = 'marketing_campaigns';

export const CHANNELS = [
  'instagram', 'x', 'linkedin', 'facebook', 'youtube', 'website', 'newsletter', 'email', 'press', 'print', 'noticeboard',
] as const;

export const STATUSES = ['draft', 'in_review', 'approved', 'rejected', 'published', 'archived'] as const;

const CHANNEL_AUDIENCE: Record<string, string> = {
  newsletter: 'marketing_opt_in',
  email: 'marketing_opt_in',
  instagram: 'public_social',
  x: 'public_social',
  linkedin: 'public_social',
  facebook: 'public_social',
  youtube: 'public_social',
  website: 'public_web',
  press: 'public_press',
  print: 'public_print',
  noticeboard: 'campus',
};

export interface CampaignInput {
  title: string;
  channel: string;
  scheduledAt: string;
  brief?: string;
  content?: string;
  assetUrls?: string[];
  /** identifiable people appear in the media for this campaign */
  identifiablePeople?: boolean;
  consentGranted?: boolean;
  consentEvidence?: string;
  targetAudience?: string;
  transactional?: boolean;
}

function parseDate(value: any, field: string): string {
  if (!value) throw badRequest(`${field} is required`);
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) throw badRequest(`${field} must be an ISO date`);
  return t.toISOString();
}

export async function createCampaign(ctx: FeatureContext, actorId: string, input: CampaignInput) {
  if (!input || typeof input !== 'object') throw badRequest('A campaign payload is required');
  if (!input.title || !String(input.title).trim()) throw badRequest('title is required');
  if (!input.channel) throw badRequest('channel is required');
  const channel = String(input.channel).toLowerCase();
  if (!CHANNELS.includes(channel as any)) throw badRequest(`channel must be one of: ${CHANNELS.join(', ')}`);
  const scheduledAt = parseDate(input.scheduledAt, 'scheduledAt');
  if (input.assetUrls != null && !Array.isArray(input.assetUrls)) throw badRequest('assetUrls must be an array');

  const row = await ctx.repo.insert(CAMPAIGNS, {
    id: ctx.newId(),
    title: String(input.title).trim(),
    channel,
    scheduledAt,
    brief: input.brief ?? null,
    content: input.content ?? null,
    assetUrls: input.assetUrls ?? [],
    identifiablePeople: !!input.identifiablePeople,
    consentGranted: !!input.consentGranted,
    consentEvidence: input.consentEvidence ?? null,
    // marketing consent is kept separate from transactional notices
    audience: input.targetAudience ?? CHANNEL_AUDIENCE[channel] ?? 'public_social',
    transactional: !!input.transactional,
    status: 'draft',
    externalUrl: null,
    publishedAt: null,
    publishedBy: null,
    approvedBy: null,
    rejectedReason: null,
    metrics: null,
    createdBy: actorId,
  });
  await ctx.audit.record({ action: 'marketing.campaign.create', actorId, targetType: 'marketing_campaign', targetId: row.id, detail: { channel } });
  return row;
}

export async function updateCampaign(ctx: FeatureContext, actorId: string, id: string, patch: Partial<CampaignInput>) {
  const c = await ctx.repo.get(CAMPAIGNS, id);
  if (!c) throw notFound('Campaign not found');
  if (c.status === 'published') throw conflict('A published campaign cannot be edited; archive it first');
  if (c.status === 'approved') throw conflict('An approved campaign cannot be edited; submit a new draft');
  const next: Row = { ...patch, updatedBy: actorId };
  delete (next as any).status;
  if (patch?.channel) {
    const channel = String(patch.channel).toLowerCase();
    if (!CHANNELS.includes(channel as any)) throw badRequest(`channel must be one of: ${CHANNELS.join(', ')}`);
    next.channel = channel;
  }
  if (patch?.scheduledAt) next.scheduledAt = parseDate(patch.scheduledAt, 'scheduledAt');
  const updated = await ctx.repo.update(CAMPAIGNS, id, next);
  await ctx.audit.record({ action: 'marketing.campaign.update', actorId, targetType: 'marketing_campaign', targetId: id });
  return updated;
}

export async function submitCampaign(ctx: FeatureContext, actorId: string, id: string) {
  const c = await ctx.repo.get(CAMPAIGNS, id);
  if (!c) throw notFound('Campaign not found');
  if (c.status !== 'draft' && c.status !== 'rejected') {
    throw conflict(`Only a draft or rejected campaign can be submitted for review (current: ${c.status})`);
  }
  const updated = await ctx.repo.update(CAMPAIGNS, id, { status: 'in_review', submittedAt: ctx.now() });
  await ctx.audit.record({ action: 'marketing.campaign.submit', actorId, targetType: 'marketing_campaign', targetId: id });
  return updated;
}

export async function approveCampaign(ctx: FeatureContext, actorId: string, id: string) {
  const c = await ctx.repo.get(CAMPAIGNS, id);
  if (!c) throw notFound('Campaign not found');
  if (c.status !== 'in_review') throw conflict(`Only a campaign under review can be approved (current: ${c.status})`);
  if (c.createdBy && c.createdBy === actorId) {
    throw forbidden('Separation of duties: the author cannot approve their own campaign');
  }
  const updated = await ctx.repo.update(CAMPAIGNS, id, { status: 'approved', approvedBy: actorId, approvedAt: ctx.now() });
  await ctx.audit.record({ action: 'marketing.campaign.approve', actorId, targetType: 'marketing_campaign', targetId: id });
  return updated;
}

export async function rejectCampaign(ctx: FeatureContext, actorId: string, id: string, reason: string) {
  const c = await ctx.repo.get(CAMPAIGNS, id);
  if (!c) throw notFound('Campaign not found');
  if (c.status !== 'in_review') throw conflict(`Only a campaign under review can be rejected (current: ${c.status})`);
  if (!reason || !String(reason).trim()) throw badRequest('A rejection reason is required');
  const updated = await ctx.repo.update(CAMPAIGNS, id, {
    status: 'rejected', rejectedReason: String(reason).trim(), rejectedBy: actorId, rejectedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'marketing.campaign.reject', actorId, targetType: 'marketing_campaign', targetId: id, detail: { reason } });
  return updated;
}

export async function publishCampaign(ctx: FeatureContext, actorId: string, id: string, input: { externalUrl?: string } = {}) {
  const c = await ctx.repo.get(CAMPAIGNS, id);
  if (!c) throw notFound('Campaign not found');
  if (c.status !== 'approved') throw conflict(`Only an approved campaign can be published (current: ${c.status})`);
  if (!input?.externalUrl || !String(input.externalUrl).trim()) {
    throw badRequest('externalUrl is required: record where the approved content was published');
  }
  if (c.identifiablePeople && !c.consentGranted) {
    throw unprocessable('Consent for identifiable people in the campaign media has not been recorded');
  }
  const updated = await ctx.repo.update(CAMPAIGNS, id, {
    status: 'published',
    externalUrl: String(input.externalUrl).trim(),
    publishedBy: actorId,
    publishedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'marketing.campaign.publish', actorId, targetType: 'marketing_campaign', targetId: id,
    detail: { channel: c.channel, externalUrl: updated?.externalUrl },
  });
  return updated;
}

export async function archiveCampaign(ctx: FeatureContext, actorId: string, id: string) {
  const c = await ctx.repo.get(CAMPAIGNS, id);
  if (!c) throw notFound('Campaign not found');
  if (c.status === 'archived') throw conflict('Campaign is already archived');
  const updated = await ctx.repo.update(CAMPAIGNS, id, { status: 'archived', archivedAt: ctx.now() });
  await ctx.audit.record({ action: 'marketing.campaign.archive', actorId, targetType: 'marketing_campaign', targetId: id });
  return updated;
}

export async function recordMetrics(
  ctx: FeatureContext, actorId: string, id: string,
  input: { impressions?: number; engagements?: number; clicks?: number; notes?: string } = {},
) {
  const c = await ctx.repo.get(CAMPAIGNS, id);
  if (!c) throw notFound('Campaign not found');
  if (c.status !== 'published') throw conflict('Engagement metrics can only be recorded for a published campaign');
  const num = (v: any, field: string) => {
    if (v == null) return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw badRequest(`${field} must be a non-negative number`);
    return n;
  };
  const impressions = num(input.impressions, 'impressions');
  const engagements = num(input.engagements, 'engagements');
  const clicks = num(input.clicks, 'clicks');
  const metrics = {
    impressions,
    engagements,
    clicks,
    engagementRate: impressions > 0 ? Math.round((engagements / impressions) * 10000) / 10000 : 0,
    notes: input.notes ?? null,
    recordedAt: ctx.now(),
  };
  const updated = await ctx.repo.update(CAMPAIGNS, id, { metrics });
  await ctx.audit.record({ action: 'marketing.campaign.metrics', actorId, targetType: 'marketing_campaign', targetId: id, detail: metrics });
  return updated;
}

export async function listCampaigns(ctx: FeatureContext, filter: { status?: string; channel?: string } = {}) {
  const f: Row = {};
  if (filter.status) f.status = filter.status;
  if (filter.channel) f.channel = String(filter.channel).toLowerCase();
  return ctx.repo.find(CAMPAIGNS, f, { orderBy: 'scheduledAt', desc: false });
}

export async function getCampaign(ctx: FeatureContext, id: string) {
  const c = await ctx.repo.get(CAMPAIGNS, id);
  if (!c) throw notFound('Campaign not found');
  return c;
}

/** Campaign calendar: scheduled campaigns inside a date window, chronological. */
export async function calendar(ctx: FeatureContext, from?: string, to?: string) {
  const fromMs = from ? new Date(from).getTime() : -Infinity;
  const toMs = to ? new Date(to).getTime() : Infinity;
  if (from && Number.isNaN(fromMs)) throw badRequest('from must be an ISO date');
  if (to && Number.isNaN(toMs)) throw badRequest('to must be an ISO date');
  if (fromMs > toMs) throw badRequest('from must be before to');
  const rows = await ctx.repo.find(CAMPAIGNS, {});
  return rows
    .filter((r: Row) => {
      const t = new Date(r.scheduledAt).getTime();
      return Number.isFinite(t) && t >= fromMs && t <= toMs;
    })
    .sort((a: Row, b: Row) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}
