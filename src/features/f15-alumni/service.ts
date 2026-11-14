import type { FeatureContext, Row } from '../../core/types.js';
import { assertNotSelfApproval } from '../../core/permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

/**
 * Feature 15 — Alumni & Legacy Network.
 *
 * Tables
 *  - alumni_access_requests  { userId, contactEmail, contactEmailVerified, verificationCode,
 *                              graduationYear, programme, status, reviewedBy, reviewReason, decidedAt }
 *  - alumni_profiles         { userId, requestId, status, graduationYear, programme, headline,
 *                              directoryVisible, shareContact, approvedBy, approvedAt }
 *  - alumni_history_entries  { title, year, category, description, attributedUserId, recordedBy }
 *
 * Alumni access requires (a) a verified contact email and (b) administrator-approved
 * club-alumni status given by an approver who is not the applicant. Approval is permanent —
 * there is no expiry field — until an administrator suspends or revokes it.
 * Approval never touches the user's roles or permissions: alumni do not inherit student-only
 * or administrative permissions by becoming alumni.
 */

export const REQUESTS = 'alumni_access_requests';
export const PROFILES = 'alumni_profiles';
export const HISTORY = 'alumni_history_entries';

export const REQUEST_STATUSES = ['pending_verification', 'pending_approval', 'approved', 'rejected', 'revoked'] as const;
export const PROFILE_STATUSES = ['active', 'suspended', 'revoked'] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').toUpperCase();
}

/** Deterministic contact-verification code for a request (emailed to the applicant in production). */
export function contactVerificationCode(userId: string, contactEmail: string): string {
  return `ALU-${fnv1a(`${userId}|${contactEmail.toLowerCase()}`)}`;
}

function ensureNotSelfApproval(actorId: string, applicantId: string, what: string) {
  try {
    assertNotSelfApproval(actorId, applicantId, what);
  } catch (e: any) {
    throw forbidden(e?.message || 'Separation of duties: an applicant cannot approve their own request');
  }
}

/* ------------------------------------------------------------- requests */

export async function requestAlumniAccess(
  ctx: FeatureContext,
  userId: string,
  input: { contactEmail?: string; graduationYear?: number; programme?: string } = {},
) {
  const email = typeof input.contactEmail === 'string' ? input.contactEmail.trim().toLowerCase() : '';
  if (!email) throw badRequest('contactEmail is required');
  if (!EMAIL_RE.test(email)) throw badRequest('contactEmail is not a valid email address');

  const user = await ctx.repo.get('users', userId);
  if (!user) throw notFound('User not found');

  const existing = await ctx.repo.findOne(REQUESTS, { userId });
  if (existing && !['rejected', 'revoked'].includes(existing.status)) {
    throw conflict(`You already have a ${existing.status} alumni access request`);
  }

  const year = input.graduationYear == null ? null : Number(input.graduationYear);
  if (year != null && (!Number.isFinite(year) || year < 1950 || year > 2100)) {
    throw badRequest('graduationYear looks invalid');
  }

  const code = contactVerificationCode(userId, email);
  const patch: Row = {
    userId,
    contactEmail: email,
    contactEmailVerified: false,
    verificationCode: code,
    graduationYear: year,
    programme: input.programme ?? null,
    status: 'pending_verification',
    reviewedBy: null,
    reviewReason: null,
    decidedAt: null,
    submittedAt: ctx.now(),
  };
  const row = existing
    ? await ctx.repo.update(REQUESTS, existing.id, patch)
    : await ctx.repo.insert(REQUESTS, { id: ctx.newId(), ...patch, createdAt: ctx.now() });

  await ctx.audit.record({
    action: 'alumni.request.create',
    actorId: userId,
    targetType: 'alumni_request',
    targetId: row!.id,
    detail: { contactEmail: email },
  });
  // the code is returned here because the platform has no outbound mail integration
  return { ...row, verificationCode: code };
}

export async function verifyContactEmail(ctx: FeatureContext, actorId: string, id: string, input: { code?: string } = {}) {
  const req = await ctx.repo.get(REQUESTS, id);
  if (!req) throw notFound('Alumni access request not found');
  if (req.userId !== actorId) throw forbidden('You may only verify your own request');
  if (req.contactEmailVerified) throw conflict('Contact email is already verified');
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  if (!code) throw badRequest('code is required');
  if (code !== String(req.verificationCode || '').toUpperCase()) throw badRequest('Verification code does not match');

  const updated = await ctx.repo.update(REQUESTS, id, {
    contactEmailVerified: true,
    contactEmailVerifiedAt: ctx.now(),
    status: 'pending_approval',
  });
  await ctx.audit.record({
    action: 'alumni.request.verify_contact',
    actorId,
    targetType: 'alumni_request',
    targetId: id,
    detail: { contactEmail: req.contactEmail },
  });
  return updated;
}

export async function listMyRequests(ctx: FeatureContext, userId: string) {
  return ctx.repo.find(REQUESTS, { userId }, { orderBy: 'createdAt', desc: true });
}

export async function listRequests(ctx: FeatureContext, opts: { status?: string } = {}) {
  return ctx.repo.find(REQUESTS, opts.status ? { status: opts.status } : {}, { orderBy: 'createdAt' });
}

/* -------------------------------------------------------------- approval */

export async function approveRequest(ctx: FeatureContext, actorId: string, id: string, input: { reason?: string } = {}) {
  const req = await ctx.repo.get(REQUESTS, id);
  if (!req) throw notFound('Alumni access request not found');
  ensureNotSelfApproval(actorId, req.userId, 'an alumni access request');
  if (!req.contactEmailVerified) throw conflict('The contact email must be verified before approval');
  if (req.status !== 'pending_approval') throw conflict(`Cannot approve a ${req.status} request`);

  const now = ctx.now();
  const updated = await ctx.repo.update(REQUESTS, id, {
    status: 'approved',
    reviewedBy: actorId,
    reviewReason: typeof input.reason === 'string' ? input.reason.trim() : null,
    decidedAt: now,
  });

  // approval is permanent: no expiry is recorded, only an explicit suspend/revoke ends it
  const existing = await ctx.repo.findOne(PROFILES, { userId: req.userId });
  const profilePatch: Row = {
    userId: req.userId,
    requestId: id,
    status: 'active',
    graduationYear: req.graduationYear ?? null,
    programme: req.programme ?? null,
    directoryVisible: existing ? existing.directoryVisible !== false : true,
    shareContact: existing ? existing.shareContact === true : false,
    approvedBy: actorId,
    approvedAt: now,
    suspendedAt: null,
    revokedAt: null,
  };
  const profile = existing
    ? await ctx.repo.update(PROFILES, existing.id, profilePatch)
    : await ctx.repo.insert(PROFILES, { id: ctx.newId(), headline: null, ...profilePatch, createdAt: now });

  // NOTE: the user's roles and permissions are deliberately untouched.
  await ctx.audit.record({
    action: 'alumni.request.approve',
    actorId,
    targetType: 'alumni_request',
    targetId: id,
    detail: { applicantId: req.userId, profileId: profile!.id },
  });
  return { request: updated, profile };
}

export async function rejectRequest(ctx: FeatureContext, actorId: string, id: string, input: { reason?: string } = {}) {
  const req = await ctx.repo.get(REQUESTS, id);
  if (!req) throw notFound('Alumni access request not found');
  ensureNotSelfApproval(actorId, req.userId, 'an alumni access request');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw badRequest('reason is required to reject a request');
  if (!['pending_approval', 'pending_verification'].includes(req.status)) {
    throw conflict(`Cannot reject a ${req.status} request`);
  }
  const updated = await ctx.repo.update(REQUESTS, id, {
    status: 'rejected',
    reviewedBy: actorId,
    reviewReason: reason,
    decidedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'alumni.request.reject', actorId, targetType: 'alumni_request', targetId: id, detail: { reason } });
  return updated;
}

/* -------------------------------------------------------------- profiles */

export async function setProfilePrivacy(
  ctx: FeatureContext,
  userId: string,
  input: { directoryVisible?: boolean; shareContact?: boolean; headline?: string } = {},
) {
  const profile = await ctx.repo.findOne(PROFILES, { userId });
  if (!profile) throw notFound('Alumni profile not found');
  if (profile.status !== 'active') throw conflict(`Alumni profile is ${profile.status}`);
  const patch: Row = {};
  if (typeof input.directoryVisible === 'boolean') patch.directoryVisible = input.directoryVisible;
  if (typeof input.shareContact === 'boolean') patch.shareContact = input.shareContact;
  if (typeof input.headline === 'string') patch.headline = input.headline.trim();
  if (!Object.keys(patch).length) throw badRequest('Nothing to update');
  const updated = await ctx.repo.update(PROFILES, profile.id, patch);
  await ctx.audit.record({
    action: 'alumni.profile.privacy.update',
    actorId: userId,
    targetType: 'alumni_profile',
    targetId: profile.id,
    detail: patch,
  });
  return updated;
}

export async function getMyProfile(ctx: FeatureContext, userId: string) {
  const profile = await ctx.repo.findOne(PROFILES, { userId });
  if (!profile) throw notFound('Alumni profile not found');
  const request = await ctx.repo.findOne(REQUESTS, { userId });
  return { profile, request };
}

export async function setProfileStatus(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  status: 'suspended' | 'revoked',
  input: { reason?: string } = {},
) {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw badRequest('reason is required');
  const profile = await ctx.repo.get(PROFILES, id);
  if (!profile) throw notFound('Alumni profile not found');
  if (profile.status === status) throw conflict(`Alumni profile is already ${status}`);
  const patch: Row = { status, statusReason: reason, statusChangedBy: actorId, statusChangedAt: ctx.now() };
  if (status === 'suspended') patch.suspendedAt = ctx.now();
  if (status === 'revoked') patch.revokedAt = ctx.now();
  const updated = await ctx.repo.update(PROFILES, id, patch);
  await ctx.repo.update(REQUESTS, profile.requestId, { status: status === 'revoked' ? 'revoked' : 'approved', reviewReason: reason });
  await ctx.audit.record({
    action: `alumni.profile.${status}`,
    actorId,
    targetType: 'alumni_profile',
    targetId: id,
    detail: { reason, userId: profile.userId },
  });
  return updated;
}

/** Directory: consent-controlled and contact details are hidden unless shared. */
export async function directory(ctx: FeatureContext) {
  const profiles = await ctx.repo.find(PROFILES, { status: 'active', directoryVisible: true }, { orderBy: 'approvedAt' });
  const out: Row[] = [];
  for (const p of profiles) {
    const user = await ctx.repo.get('users', p.userId);
    const request = p.requestId ? await ctx.repo.get(REQUESTS, p.requestId) : null;
    const entry: Row = {
      userId: p.userId,
      displayName: user?.name ?? 'Club alumnus',
      graduationYear: p.graduationYear ?? null,
      programme: p.programme ?? null,
      headline: p.headline ?? null,
      joinedAsAlumnusAt: p.approvedAt ?? null,
    };
    if (p.shareContact === true && request?.contactEmail) entry.contactEmail = request.contactEmail;
    out.push(entry);
  }
  return out;
}

/* --------------------------------------------------------------- history */

export async function addHistoryEntry(
  ctx: FeatureContext,
  actorId: string,
  input: { title?: string; year?: number; category?: string; description?: string; attributedUserId?: string } = {},
) {
  if (!input.title || !String(input.title).trim()) throw badRequest('title is required');
  const category = input.category || 'tournament';
  if (!['tournament', 'champion', 'legacy'].includes(category)) throw badRequest('category must be tournament, champion or legacy');
  const year = input.year == null ? null : Number(input.year);
  if (year != null && (!Number.isFinite(year) || year < 1900 || year > 2100)) throw badRequest('year looks invalid');
  const row = await ctx.repo.insert(HISTORY, {
    id: ctx.newId(),
    title: String(input.title).trim(),
    year,
    category,
    description: input.description ?? null,
    attributedUserId: input.attributedUserId ?? null,
    recordedBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'alumni.history.create',
    actorId,
    targetType: 'alumni_history',
    targetId: row.id,
    detail: { category, year },
  });
  return row;
}

export async function listHistory(ctx: FeatureContext) {
  return ctx.repo.find(HISTORY, {}, { orderBy: 'year', desc: true });
}

/** Historical records stay attributed to the same account across the student→alumni transition. */
export async function myHistory(ctx: FeatureContext, userId: string) {
  return ctx.repo.find(HISTORY, { attributedUserId: userId }, { orderBy: 'year', desc: true });
}
