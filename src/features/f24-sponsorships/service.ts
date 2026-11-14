import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 24 — Sponsorship, Partnerships & University Relations (slug: sponsorships)
 *
 * Tables
 *  - sponsor_partners       sponsor/partner directory + pipeline stage + recognition state
 *  - sponsor_agreements     agreements with committed amounts and explicit approval
 *  - sponsor_deliverables   benefit/deliverable tracking (owner + due date mandatory)
 *  - sponsor_contributions  received-money records that *reference* finance, never replace it
 *
 * Amount rule: committed amounts live on the agreement, received amounts live on contributions.
 * `financeSummary` reconciles the two and never writes back into the finance module.
 */

export const PARTNERS = 'sponsor_partners';
export const AGREEMENTS = 'sponsor_agreements';
export const DELIVERABLES = 'sponsor_deliverables';
export const CONTRIBUTIONS = 'sponsor_contributions';

/** Ordered sponsorship pipeline. */
export const STAGES = ['prospect', 'contacted', 'proposal', 'review', 'approved', 'agreement', 'active', 'renewal', 'archived', 'declined'];

export const STAGE_TRANSITIONS: Record<string, string[]> = {
  prospect: ['contacted', 'declined'],
  contacted: ['proposal', 'declined'],
  proposal: ['review', 'declined'],
  review: ['approved', 'declined'],
  approved: ['agreement', 'declined'],
  agreement: ['active', 'declined'],
  active: ['renewal', 'archived'],
  renewal: ['active', 'archived'],
  archived: [],
  declined: ['prospect'],
};

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

function money(value: any, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${field} must be a non-negative number`);
  return n;
}

export async function createPartner(
  ctx: FeatureContext,
  actorId: string,
  input: {
    name?: string;
    type?: string;
    contactName?: string;
    contactEmail?: string;
    website?: string;
    logoUrl?: string;
    confidentialTerms?: string;
  } = {},
) {
  const name = need(input?.name, 'name');
  const partner = await ctx.repo.insert(PARTNERS, {
    id: ctx.newId(),
    name,
    type: input?.type || 'sponsor',
    stage: 'prospect',
    stageHistory: [{ stage: 'prospect', at: ctx.now(), by: actorId }],
    contactName: input?.contactName ?? null,
    contactEmail: input?.contactEmail ?? null,
    website: input?.website ?? null,
    logoUrl: input?.logoUrl ?? null,
    confidentialTerms: input?.confidentialTerms ?? null,
    recognitionStatus: 'none',
    recognitionApproved: false,
    recognitionPublished: false,
    recognitionApprovedBy: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'sponsorship.partner.create',
    actorId,
    targetType: 'sponsor_partner',
    targetId: partner.id,
    detail: { name, type: partner.type },
  });
  return partner;
}

export async function listPartners(ctx: FeatureContext, filter: { stage?: string; type?: string } = {}) {
  const q: Row = {};
  if (filter.stage) q.stage = filter.stage;
  if (filter.type) q.type = filter.type;
  return ctx.repo.find(PARTNERS, q, { orderBy: 'createdAt', desc: true });
}

export async function advanceStage(ctx: FeatureContext, actorId: string, partnerId: string, next: string) {
  const partner = await ctx.repo.get(PARTNERS, partnerId);
  if (!partner) throw notFound('Partner not found');
  if (!STAGES.includes(next)) throw badRequest(`stage must be one of ${STAGES.join(', ')}`);
  const allowed = STAGE_TRANSITIONS[partner.stage] || [];
  if (!allowed.includes(next)) {
    throw conflict(`Cannot move from ${partner.stage} to ${next}`, { from: partner.stage, allowed });
  }
  const history = Array.isArray(partner.stageHistory) ? partner.stageHistory : [];
  const updated = await ctx.repo.update(PARTNERS, partnerId, {
    stage: next,
    stageHistory: [...history, { stage: next, at: ctx.now(), by: actorId }],
  });
  await ctx.audit.record({
    action: 'sponsorship.partner.stage',
    actorId,
    targetType: 'sponsor_partner',
    targetId: partnerId,
    detail: { from: partner.stage, to: next },
  });
  return updated;
}

export async function createAgreement(
  ctx: FeatureContext,
  actorId: string,
  partnerId: string,
  input: { title?: string; committedAmount?: number; startsAt?: string; endsAt?: string; terms?: string } = {},
) {
  const partner = await ctx.repo.get(PARTNERS, partnerId);
  if (!partner) throw notFound('Partner not found');
  const title = need(input?.title, 'title');
  const committedAmount = money(input?.committedAmount, 'committedAmount');
  const agreement = await ctx.repo.insert(AGREEMENTS, {
    id: ctx.newId(),
    partnerId,
    title,
    committedAmount,
    currency: 'INR',
    startsAt: input?.startsAt ?? null,
    endsAt: input?.endsAt ?? null,
    terms: input?.terms ?? null,
    status: 'pending_approval',
    createdBy: actorId,
    approvedBy: null,
    approvedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'sponsorship.agreement.create',
    actorId,
    targetType: 'sponsor_agreement',
    targetId: agreement.id,
    detail: { partnerId, committedAmount },
  });
  return agreement;
}

export async function approveAgreement(ctx: FeatureContext, actorId: string, agreementId: string) {
  const agreement = await ctx.repo.get(AGREEMENTS, agreementId);
  if (!agreement) throw notFound('Agreement not found');
  if (agreement.status !== 'pending_approval') throw conflict(`Agreement is ${agreement.status} and cannot be approved`);
  assertSeparate(actorId, agreement.createdBy, 'an agreement');
  const updated = await ctx.repo.update(AGREEMENTS, agreementId, {
    status: 'active',
    approvedBy: actorId,
    approvedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'sponsorship.agreement.approve',
    actorId,
    targetType: 'sponsor_agreement',
    targetId: agreementId,
    detail: { createdBy: agreement.createdBy, committedAmount: agreement.committedAmount },
  });
  return updated;
}

export async function addDeliverable(
  ctx: FeatureContext,
  actorId: string,
  agreementId: string,
  input: { title?: string; ownerId?: string; dueAt?: string } = {},
) {
  const agreement = await ctx.repo.get(AGREEMENTS, agreementId);
  if (!agreement) throw notFound('Agreement not found');
  const title = need(input?.title, 'title');
  const ownerId = need(input?.ownerId, 'ownerId');
  const dueAt = need(input?.dueAt, 'dueAt');
  if (Number.isNaN(new Date(dueAt).getTime())) throw badRequest('dueAt must be an ISO date');
  const row = await ctx.repo.insert(DELIVERABLES, {
    id: ctx.newId(),
    agreementId,
    partnerId: agreement.partnerId,
    title,
    ownerId,
    dueAt: new Date(dueAt).toISOString(),
    status: 'pending',
    completedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'sponsorship.deliverable.create',
    actorId,
    targetType: 'sponsor_deliverable',
    targetId: row.id,
    detail: { agreementId, ownerId, dueAt: row.dueAt },
  });
  return row;
}

export async function completeDeliverable(ctx: FeatureContext, actorId: string, deliverableId: string) {
  const row = await ctx.repo.get(DELIVERABLES, deliverableId);
  if (!row) throw notFound('Deliverable not found');
  if (row.status === 'completed') throw conflict('Deliverable is already completed');
  const updated = await ctx.repo.update(DELIVERABLES, deliverableId, {
    status: 'completed',
    completedAt: ctx.now(),
    completedBy: actorId,
  });
  await ctx.audit.record({
    action: 'sponsorship.deliverable.complete',
    actorId,
    targetType: 'sponsor_deliverable',
    targetId: deliverableId,
  });
  return updated;
}

/**
 * Record money actually received. `financeReference` points at the finance module, which stays
 * authoritative for the accounting entry — this row is a reconciliation link only.
 */
export async function recordContribution(
  ctx: FeatureContext,
  actorId: string,
  partnerId: string,
  input: { amount?: number; agreementId?: string; receivedAt?: string; financeReference?: string } = {},
) {
  const partner = await ctx.repo.get(PARTNERS, partnerId);
  if (!partner) throw notFound('Partner not found');
  const amount = money(input?.amount, 'amount');
  if (amount <= 0) throw badRequest('amount must be greater than zero');
  let agreementId: string | null = null;
  if (input?.agreementId) {
    const agreement = await ctx.repo.get(AGREEMENTS, input.agreementId);
    if (!agreement || agreement.partnerId !== partnerId) throw notFound('Agreement not found for this partner');
    agreementId = agreement.id;
  }
  const row = await ctx.repo.insert(CONTRIBUTIONS, {
    id: ctx.newId(),
    partnerId,
    agreementId,
    amount,
    currency: 'INR',
    receivedAt: input?.receivedAt ?? ctx.now(),
    financeReference: input?.financeReference ?? null,
    authoritativeSource: 'finance',
    recordedBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'sponsorship.contribution.record',
    actorId,
    targetType: 'sponsor_partner',
    targetId: partnerId,
    detail: { amount, agreementId, financeReference: row.financeReference },
  });
  return row;
}

/** Committed (agreements) vs received (contributions) reconciliation. */
export async function financeSummary(ctx: FeatureContext, partnerId: string) {
  const partner = await ctx.repo.get(PARTNERS, partnerId);
  if (!partner) throw notFound('Partner not found');
  const agreements = (await ctx.repo.find(AGREEMENTS, { partnerId })).filter((a) => a.status !== 'cancelled');
  const contributions = await ctx.repo.find(CONTRIBUTIONS, { partnerId }, { orderBy: 'receivedAt' });
  const committed = agreements.reduce((s, a) => s + Number(a.committedAmount || 0), 0);
  const received = contributions.reduce((s, c) => s + Number(c.amount || 0), 0);
  return {
    partnerId,
    currency: 'INR',
    committed,
    received,
    outstanding: Math.max(0, committed - received),
    overCommitted: received > committed,
    agreementCount: agreements.length,
    contributionCount: contributions.length,
    contributions,
  };
}

export async function requestRecognition(ctx: FeatureContext, actorId: string, partnerId: string, input: { logoApproved?: boolean } = {}) {
  const partner = await ctx.repo.get(PARTNERS, partnerId);
  if (!partner) throw notFound('Partner not found');
  if (partner.recognitionApproved) throw conflict('Recognition is already approved');
  const updated = await ctx.repo.update(PARTNERS, partnerId, {
    recognitionStatus: 'requested',
    recognitionRequestedBy: actorId,
    recognitionRequestedAt: ctx.now(),
    logoUseApproved: !!input?.logoApproved,
  });
  await ctx.audit.record({
    action: 'sponsorship.recognition.request',
    actorId,
    targetType: 'sponsor_partner',
    targetId: partnerId,
  });
  return updated;
}

/** Public sponsor recognition requires an independent approval before anything is published. */
export async function approveRecognition(ctx: FeatureContext, actorId: string, partnerId: string) {
  const partner = await ctx.repo.get(PARTNERS, partnerId);
  if (!partner) throw notFound('Partner not found');
  if (partner.recognitionStatus !== 'requested') throw conflict('There is no recognition request awaiting approval');
  assertSeparate(actorId, partner.recognitionRequestedBy, 'a sponsor recognition request');
  const updated = await ctx.repo.update(PARTNERS, partnerId, {
    recognitionStatus: 'approved',
    recognitionApproved: true,
    recognitionPublished: true,
    recognitionApprovedBy: actorId,
    recognitionApprovedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'sponsorship.recognition.approve',
    actorId,
    targetType: 'sponsor_partner',
    targetId: partnerId,
  });
  return updated;
}

/** Public feed: approved + published only, and never any contact or commercial terms. */
export async function publicRecognition(ctx: FeatureContext) {
  const partners = await ctx.repo.find(PARTNERS, { recognitionApproved: true, recognitionPublished: true }, { orderBy: 'name' });
  return partners.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    logoUrl: p.logoUrl ?? null,
    website: p.website ?? null,
  }));
}

export async function getPartner(ctx: FeatureContext, partnerId: string) {
  const partner = await ctx.repo.get(PARTNERS, partnerId);
  if (!partner) throw notFound('Partner not found');
  const agreements = await ctx.repo.find(AGREEMENTS, { partnerId }, { orderBy: 'createdAt', desc: true });
  const deliverables = await ctx.repo.find(DELIVERABLES, { partnerId }, { orderBy: 'dueAt' });
  const summary = await financeSummary(ctx, partnerId);
  return {
    ...partner,
    agreements,
    deliverables,
    finance: {
      committed: summary.committed,
      received: summary.received,
      outstanding: summary.outstanding,
      overCommitted: summary.overCommitted,
    },
  };
}
