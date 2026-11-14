import type { FeatureContext, Row } from '../../core/types.js';
import { assertNotSelfApproval } from '../../core/permissions.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';

/**
 * Feature 12 — Club Membership & Student Community.
 *
 * Tables
 *  - domain_allowlist        { domain, applicantType: 'student'|'alumni'|'both', active, addedBy }
 *  - membership_categories   { code, name, mode: 'automatic'|'approval'|'hybrid', active }
 *  - membership_applications { applicantId, applicantType, categoryCode, email, status,
 *                              eligibilityStatus, eligibilityReason,
 *                              decidedBy, decidedAt, decisionReason, infoRequestedReason,
 *                              effectiveFrom, effectiveTo }
 *
 * Account eligibility (university domain allowlist) is stored on the application as
 * `eligibilityStatus` and is deliberately separate from the club `status` field: being an
 * eligible student never implies an active club membership, and a club responsibility never
 * implies administrator permissions (those are permission keys, checked by the routes).
 *
 * Membership statuses: draft | submitted | pending_review | active | declined | expired |
 * suspended | withdrawn.
 */

export const ALLOWLIST = 'domain_allowlist';
export const CATEGORIES = 'membership_categories';
export const APPLICATIONS = 'membership_applications';

export const MODES = ['automatic', 'approval', 'hybrid'] as const;
export const APPLICANT_TYPES = ['student', 'alumni'] as const;
export const STATUSES = [
  'draft', 'submitted', 'pending_review', 'active', 'declined', 'expired', 'suspended', 'withdrawn',
] as const;

const YEAR_MS = 365 * 24 * 3600 * 1000;

function oneYearFrom(iso: string): string {
  return new Date(new Date(iso).getTime() + YEAR_MS).toISOString();
}

function cleanDomain(raw: any): string {
  if (typeof raw !== 'string' || !raw.trim()) throw badRequest('domain is required');
  const d = raw.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw badRequest('domain is not a valid email domain');
  return d;
}

/* --------------------------------------------------------- configuration */

export async function addAllowlistDomain(
  ctx: FeatureContext,
  actorId: string,
  input: { domain?: string; applicantType?: string } = {},
) {
  const domain = cleanDomain(input.domain);
  const applicantType = input.applicantType || 'both';
  if (applicantType !== 'both' && !(APPLICANT_TYPES as readonly string[]).includes(applicantType)) {
    throw badRequest(`applicantType must be one of student, alumni, both`);
  }
  const existing = await ctx.repo.findOne(ALLOWLIST, { domain, applicantType });
  if (existing) throw conflict('That domain is already on the allowlist for this applicant type');
  const row = await ctx.repo.insert(ALLOWLIST, {
    id: ctx.newId(),
    domain,
    applicantType,
    active: true,
    addedBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'membership.allowlist.add', actorId, targetType: 'domain', targetId: row.id, detail: { domain, applicantType } });
  return row;
}

export async function listAllowlist(ctx: FeatureContext) {
  return ctx.repo.find(ALLOWLIST, {}, { orderBy: 'createdAt' });
}

export async function createCategory(
  ctx: FeatureContext,
  actorId: string,
  input: { code?: string; name?: string; mode?: string } = {},
) {
  if (typeof input.code !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(input.code.trim())) {
    throw badRequest('code must be a lower-case kebab-case string');
  }
  const code = input.code.trim();
  if (!input.name || !String(input.name).trim()) throw badRequest('name is required');
  const mode = input.mode || 'approval';
  if (!(MODES as readonly string[]).includes(mode)) throw badRequest(`mode must be one of ${MODES.join(', ')}`);
  const existing = await ctx.repo.findOne(CATEGORIES, { code });
  if (existing) throw conflict('A membership category with that code already exists');
  const row = await ctx.repo.insert(CATEGORIES, {
    id: ctx.newId(),
    code,
    name: String(input.name).trim(),
    mode,
    active: true,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'membership.category.create', actorId, targetType: 'category', targetId: row.id, detail: { code, mode } });
  return row;
}

export async function listCategories(ctx: FeatureContext) {
  return ctx.repo.find(CATEGORIES, {}, { orderBy: 'createdAt' });
}

/** The default category keeps "apply" usable before an administrator configures categories. */
async function resolveCategory(ctx: FeatureContext, code?: string) {
  const wanted = (code || 'general').trim();
  const found = await ctx.repo.findOne(CATEGORIES, { code: wanted });
  if (found) {
    if (found.active === false) throw conflict('That membership category is not open');
    return found;
  }
  if (wanted !== 'general') throw notFound('Membership category not found');
  return ctx.repo.insert(CATEGORIES, {
    id: ctx.newId(),
    code: 'general',
    name: 'General Membership',
    mode: 'approval',
    active: true,
    createdBy: null,
    createdAt: ctx.now(),
  });
}

/* ------------------------------------------------------------ eligibility */

export interface Eligibility {
  eligible: boolean;
  eligibilityStatus: 'eligible' | 'ineligible';
  eligibilityReason: string | null;
  domain: string | null;
}

export async function checkEligibility(
  ctx: FeatureContext,
  userId: string,
  applicantType: string = 'student',
): Promise<Eligibility> {
  const user = await ctx.repo.get('users', userId);
  if (!user) throw notFound('User not found');
  const email = String(user.email || '').toLowerCase();
  const domain = email.includes('@') ? email.split('@').pop()! : null;
  const base = { domain };
  if (!domain) {
    return { ...base, eligible: false, eligibilityStatus: 'ineligible', eligibilityReason: 'account_has_no_email_domain' };
  }
  const rows = await ctx.repo.find(ALLOWLIST, { domain });
  const active = rows.filter((r: Row) => r.active !== false);
  if (!active.length) {
    return { ...base, eligible: false, eligibilityStatus: 'ineligible', eligibilityReason: 'email_domain_not_allowlisted' };
  }
  const match = active.find((r: Row) => r.applicantType === 'both' || r.applicantType === applicantType);
  if (!match) {
    return { ...base, eligible: false, eligibilityStatus: 'ineligible', eligibilityReason: 'domain_not_allowed_for_applicant_type' };
  }
  return { ...base, eligible: true, eligibilityStatus: 'eligible', eligibilityReason: null };
}

/* ---------------------------------------------------------- applications */

export async function applyForMembership(
  ctx: FeatureContext,
  applicantId: string,
  input: { category?: string; applicantType?: string; termsAccepted?: boolean } = {},
) {
  if (input.termsAccepted !== true) throw badRequest('You must review and accept the membership terms');

  const applicantType = input.applicantType || 'student';
  if (!(APPLICANT_TYPES as readonly string[]).includes(applicantType)) {
    throw badRequest(`applicantType must be one of ${APPLICANT_TYPES.join(', ')}`);
  }

  const category = await resolveCategory(ctx, input.category);
  const user = await ctx.repo.get('users', applicantId);
  if (!user) throw notFound('User not found');

  const eligibility = await checkEligibility(ctx, applicantId, applicantType);
  if (!eligibility.eligible) {
    // eligibility is an account property, not a club membership decision
    throw unprocessable(`Account is not eligible for ${applicantType} membership`, {
      reason: eligibility.eligibilityReason,
      domain: eligibility.domain,
    });
  }

  const existing = await ctx.repo.findOne(APPLICATIONS, { applicantId, categoryCode: category.code });
  if (existing && !['declined', 'withdrawn', 'expired'].includes(existing.status)) {
    throw conflict(`You already have a ${existing.status} application for this category`);
  }

  const now = ctx.now();
  const autoAdmit = category.mode === 'automatic' || (category.mode === 'hybrid' && applicantType === 'student');
  const status = autoAdmit ? 'active' : 'pending_review';

  const row = existing
    ? await ctx.repo.update(APPLICATIONS, existing.id, {
        applicantType,
        email: user.email ?? null,
        status,
        eligibilityStatus: eligibility.eligibilityStatus,
        eligibilityReason: eligibility.eligibilityReason,
        termsAcceptedAt: now,
        submittedAt: now,
        decidedBy: autoAdmit ? null : null,
        decisionReason: autoAdmit ? 'automatic_membership_rule' : null,
        effectiveFrom: autoAdmit ? now : null,
        effectiveTo: autoAdmit ? oneYearFrom(now) : null,
      })
    : await ctx.repo.insert(APPLICATIONS, {
        id: ctx.newId(),
        applicantId,
        applicantType,
        categoryCode: category.code,
        mode: category.mode,
        email: user.email ?? null,
        status,
        eligibilityStatus: eligibility.eligibilityStatus,
        eligibilityReason: eligibility.eligibilityReason,
        termsAcceptedAt: now,
        submittedAt: now,
        decidedBy: null,
        decidedAt: autoAdmit ? now : null,
        decisionReason: autoAdmit ? 'automatic_membership_rule' : null,
        infoRequestedReason: null,
        effectiveFrom: autoAdmit ? now : null,
        effectiveTo: autoAdmit ? oneYearFrom(now) : null,
        createdAt: now,
      });

  await ctx.audit.record({
    action: autoAdmit ? 'membership.application.activate' : 'membership.application.submit',
    actorId: applicantId,
    targetType: 'membership_application',
    targetId: row!.id,
    detail: { category: category.code, mode: category.mode, status },
  });
  return row;
}

export async function listMyApplications(ctx: FeatureContext, applicantId: string) {
  return ctx.repo.find(APPLICATIONS, { applicantId }, { orderBy: 'createdAt', desc: true });
}

export async function listApplications(ctx: FeatureContext, opts: { status?: string; limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const filter: Row = {};
  if (opts.status) filter.status = opts.status;
  const items = await ctx.repo.find(APPLICATIONS, filter, { limit, offset, orderBy: 'createdAt' });
  const total = await ctx.repo.count(APPLICATIONS, filter);
  return { items, total, limit, offset };
}

/** Separation of duties, surfaced as a 403 regardless of how the core helper signals. */
function ensureNotSelfApproval(actorId: string, applicantId: string, what: string) {
  try {
    assertNotSelfApproval(actorId, applicantId, what);
  } catch (e: any) {
    throw forbidden(e?.message || 'Separation of duties: an applicant cannot decide their own application');
  }
}

export async function decideApplication(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: { decision?: string; reason?: string; effectiveTo?: string } = {},
) {
  const decision = input.decision;
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'request_info') {
    throw badRequest('decision must be approve, reject or request_info');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if ((decision === 'reject' || decision === 'request_info') && !reason) {
    throw badRequest('reason is required for this decision');
  }

  const app = await ctx.repo.get(APPLICATIONS, id);
  if (!app) throw notFound('Membership application not found');
  ensureNotSelfApproval(actorId, app.applicantId, 'a membership application');

  if (!['submitted', 'pending_review'].includes(app.status)) {
    throw conflict(`Cannot decide a ${app.status} application`);
  }

  const now = ctx.now();
  let patch: Row;
  if (decision === 'approve') {
    const effectiveTo = input.effectiveTo
      ? new Date(input.effectiveTo).toISOString()
      : oneYearFrom(now);
    if (new Date(effectiveTo).getTime() <= new Date(now).getTime()) throw badRequest('effectiveTo must be in the future');
    patch = {
      status: 'active',
      decidedBy: actorId,
      decidedAt: now,
      decisionReason: reason || 'approved',
      effectiveFrom: now,
      effectiveTo,
      infoRequestedReason: null,
    };
  } else if (decision === 'reject') {
    patch = { status: 'declined', decidedBy: actorId, decidedAt: now, decisionReason: reason, effectiveFrom: null, effectiveTo: null };
  } else {
    patch = { status: 'submitted', decidedBy: actorId, decidedAt: now, decisionReason: reason, infoRequestedReason: reason };
  }

  const updated = await ctx.repo.update(APPLICATIONS, id, patch);
  await ctx.audit.record({
    action: `membership.application.${decision}`,
    actorId,
    targetType: 'membership_application',
    targetId: id,
    detail: { decision, reason: reason || null, applicantId: app.applicantId },
  });
  return updated;
}

export async function withdrawApplication(ctx: FeatureContext, actorId: string, id: string) {
  const app = await ctx.repo.get(APPLICATIONS, id);
  if (!app) throw notFound('Membership application not found');
  if (app.applicantId !== actorId) throw forbidden('You may only withdraw your own application');
  if (!['submitted', 'pending_review', 'draft'].includes(app.status)) {
    throw conflict(`Cannot withdraw a ${app.status} application`);
  }
  const updated = await ctx.repo.update(APPLICATIONS, id, {
    status: 'withdrawn',
    withdrawnAt: ctx.now(),
    effectiveFrom: null,
    effectiveTo: null,
  });
  await ctx.audit.record({ action: 'membership.application.withdraw', actorId, targetType: 'membership_application', targetId: id });
  return updated;
}

export async function suspendMembership(ctx: FeatureContext, actorId: string, id: string, input: { reason?: string } = {}) {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw badRequest('reason is required to suspend a membership');
  const app = await ctx.repo.get(APPLICATIONS, id);
  if (!app) throw notFound('Membership application not found');
  if (app.status !== 'active') throw conflict(`Cannot suspend a ${app.status} membership`);
  const updated = await ctx.repo.update(APPLICATIONS, id, {
    status: 'suspended',
    decisionReason: reason,
    suspendedBy: actorId,
    suspendedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'membership.membership.suspend', actorId, targetType: 'membership_application', targetId: id, detail: { reason } });
  return updated;
}

/** Explicit expiry rule: an active membership whose effectiveTo has passed becomes expired. */
export async function expireDueMemberships(ctx: FeatureContext) {
  const now = new Date(ctx.now()).getTime();
  const active = await ctx.repo.find(APPLICATIONS, { status: 'active' });
  const expired: Row[] = [];
  for (const app of active) {
    if (app.effectiveTo && new Date(app.effectiveTo).getTime() < now) {
      const row = await ctx.repo.update(APPLICATIONS, app.id, { status: 'expired', expiredAt: ctx.now() });
      await ctx.audit.record({
        action: 'membership.membership.expire',
        actorId: 'system',
        targetType: 'membership_application',
        targetId: app.id,
        detail: { effectiveTo: app.effectiveTo },
      });
      expired.push(row!);
    }
  }
  return expired;
}

export async function getMyMembership(ctx: FeatureContext, userId: string) {
  await expireDueMemberships(ctx);
  const apps = await ctx.repo.find(APPLICATIONS, { applicantId: userId }, { orderBy: 'createdAt', desc: true });
  const current = apps.find((a: Row) => a.status === 'active') || apps[0] || null;
  const eligibility = await checkEligibility(ctx, userId, current?.applicantType || 'student');
  return {
    // account eligibility is reported separately from club membership status
    eligibilityStatus: eligibility.eligibilityStatus,
    eligibilityReason: eligibility.eligibilityReason,
    membershipStatus: current ? current.status : 'none',
    membership: current,
    applications: apps,
  };
}
