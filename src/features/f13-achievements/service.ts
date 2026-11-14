import type { FeatureContext, Row } from '../../core/types.js';
import { assertNotSelfApproval } from '../../core/permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

/**
 * Feature 13 — Achievements, Certificates & Recognition.
 *
 * Tables
 *  - achievement_templates { code, name, version, active, createdBy }
 *  - achievements          { recipientId, type, title, description, sourceType, sourceId, status,
 *                            reason, nominatedBy, approvingOfficialId, consentPublic, awardedAt }
 *  - certificates          { achievementId, recipientId, templateCode, templateVersion,
 *                            verificationCode, status, issuedBy, issuedAt,
 *                            revokedBy, revokeReason, revokedAt }
 *
 * Achievement statuses: nominated | approved | rejected | disputed | revoked.
 * Certificate statuses:  active | revoked | corrected.
 *
 * Verification codes are deterministic: the same achievement + template version always
 * produces the same code, so a certificate can be re-derived from its source record while
 * a second issuance is still refused as a conflict (unique verification IDs).
 */

export const TEMPLATES = 'achievement_templates';
export const ACHIEVEMENTS = 'achievements';
export const CERTIFICATES = 'certificates';

export const ACHIEVEMENT_TYPES = [
  'tournament_placement',
  'championship',
  'learning_milestone',
  'volunteer_contribution',
  'coaching_contribution',
  'committee_service',
  'special_recognition',
] as const;

export const SOURCE_TYPES = ['verified_event', 'nomination', 'manual'] as const;

/* ------------------------------------------------ deterministic code */

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').toUpperCase();
}

/** Deterministic, template-version aware verification id: SCC-XXXXXXXX-XXXXXXXX. */
export function verificationCode(achievementId: string, templateVersion: number): string {
  const a = fnv1a(`${achievementId}:v${templateVersion}`);
  const b = fnv1a(`v${templateVersion}:${achievementId}:saiu-chess`);
  return `SCC-${a}-${b}`;
}

/* --------------------------------------------------------- templates */

async function resolveTemplate(ctx: FeatureContext, actorId: string, code?: string) {
  const wanted = (code || 'standard').trim();
  const existing = await ctx.repo.findOne(TEMPLATES, { code: wanted, active: true });
  if (existing) return existing;
  if (wanted !== 'standard') throw notFound('Certificate template not found');
  return ctx.repo.insert(TEMPLATES, {
    id: ctx.newId(),
    code: 'standard',
    name: 'Standard Club Certificate',
    version: 1,
    active: true,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
}

/** Publishing a new template version retires the previous one; numbering stays versioned. */
export async function publishTemplate(
  ctx: FeatureContext,
  actorId: string,
  input: { code?: string; name?: string } = {},
) {
  if (typeof input.code !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(input.code.trim())) {
    throw badRequest('code must be a lower-case kebab-case string');
  }
  if (!input.name || !String(input.name).trim()) throw badRequest('name is required');
  const code = input.code.trim();
  const previous = await ctx.repo.find(TEMPLATES, { code });
  const version = previous.reduce((max: number, t: Row) => Math.max(max, Number(t.version) || 0), 0) + 1;
  for (const t of previous) if (t.active) await ctx.repo.update(TEMPLATES, t.id, { active: false, retiredAt: ctx.now() });
  const row = await ctx.repo.insert(TEMPLATES, {
    id: ctx.newId(),
    code,
    name: String(input.name).trim(),
    version,
    active: true,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'achievement.template.publish',
    actorId,
    targetType: 'certificate_template',
    targetId: row.id,
    detail: { code, version },
  });
  return row;
}

export async function listTemplates(ctx: FeatureContext) {
  return ctx.repo.find(TEMPLATES, {}, { orderBy: 'createdAt' });
}

/* ------------------------------------------------------ achievements */

export interface AchievementInput {
  recipientId?: string;
  type?: string;
  title?: string;
  description?: string;
  sourceType?: string;
  sourceId?: string;
  reason?: string;
  approvingOfficialId?: string;
}

export async function createAchievement(ctx: FeatureContext, actorId: string, input: AchievementInput = {}) {
  if (!input.recipientId) throw badRequest('recipientId is required');
  const recipient = await ctx.repo.get('users', input.recipientId);
  if (!recipient) throw notFound('Recipient not found');
  if (!input.type || !(ACHIEVEMENT_TYPES as readonly string[]).includes(input.type)) {
    throw badRequest(`type must be one of ${ACHIEVEMENT_TYPES.join(', ')}`);
  }
  if (!input.title || !String(input.title).trim()) throw badRequest('title is required');

  const sourceType = input.sourceType || 'manual';
  if (!(SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    throw badRequest(`sourceType must be one of ${SOURCE_TYPES.join(', ')}`);
  }
  if (sourceType === 'verified_event' && !input.sourceId) {
    throw badRequest('sourceId is required for a verified event achievement');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (sourceType === 'manual' && !reason) {
    // manual awards always carry a reason and an approving official
    throw badRequest('A manual award requires a reason');
  }
  if (sourceType === 'manual' && !input.approvingOfficialId && !actorId) {
    throw badRequest('A manual award requires an approving official');
  }

  // an official may not award or approve their own recognition
  try {
    assertNotSelfApproval(actorId, input.recipientId, 'an achievement');
  } catch (e: any) {
    throw forbidden(e?.message || 'Separation of duties: you cannot approve your own achievement');
  }

  if (input.sourceId) {
    const dupe = await ctx.repo.findOne(ACHIEVEMENTS, { sourceType, sourceId: input.sourceId, type: input.type, recipientId: input.recipientId });
    if (dupe) throw conflict('An achievement already exists for this source record');
  }

  const status = sourceType === 'nomination' ? 'nominated' : 'approved';
  const row = await ctx.repo.insert(ACHIEVEMENTS, {
    id: ctx.newId(),
    recipientId: input.recipientId,
    type: input.type,
    title: String(input.title).trim(),
    description: input.description ?? null,
    sourceType,
    sourceId: input.sourceId ?? null,
    status,
    reason: reason || null,
    nominatedBy: sourceType === 'nomination' ? actorId : null,
    approvingOfficialId: status === 'approved' ? input.approvingOfficialId || actorId : null,
    consentPublic: false,
    awardedBy: actorId,
    awardedAt: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'achievement.create',
    actorId,
    targetType: 'achievement',
    targetId: row.id,
    detail: { type: row.type, sourceType, status, recipientId: row.recipientId },
  });
  return row;
}

export async function approveAchievement(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: { reason?: string } = {},
) {
  const a = await ctx.repo.get(ACHIEVEMENTS, id);
  if (!a) throw notFound('Achievement not found');
  if (a.status !== 'nominated') throw conflict(`Cannot approve a ${a.status} achievement`);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw badRequest('reason is required to approve an achievement');
  // independent review: neither the recipient nor the nominator may approve
  try {
    assertNotSelfApproval(actorId, a.recipientId, 'an achievement');
  } catch (e: any) {
    throw forbidden(e?.message || 'Separation of duties: you cannot approve your own achievement');
  }
  if (a.nominatedBy && a.nominatedBy === actorId) {
    throw forbidden('Separation of duties: the nominator cannot approve their own nomination');
  }
  const updated = await ctx.repo.update(ACHIEVEMENTS, id, {
    status: 'approved',
    approvingOfficialId: actorId,
    reason,
    approvedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'achievement.approve', actorId, targetType: 'achievement', targetId: id, detail: { reason } });
  return updated;
}

export async function disputeAchievement(ctx: FeatureContext, actorId: string, id: string, input: { reason?: string } = {}) {
  const a = await ctx.repo.get(ACHIEVEMENTS, id);
  if (!a) throw notFound('Achievement not found');
  if (a.status === 'revoked') throw conflict('A revoked achievement cannot be disputed');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw badRequest('reason is required to dispute an achievement');
  const updated = await ctx.repo.update(ACHIEVEMENTS, id, { status: 'disputed', disputeReason: reason, disputedAt: ctx.now() });
  await ctx.audit.record({ action: 'achievement.dispute', actorId, targetType: 'achievement', targetId: id, detail: { reason } });
  return updated;
}

export async function setConsent(ctx: FeatureContext, actorId: string, id: string, input: { consentPublic?: boolean } = {}) {
  const a = await ctx.repo.get(ACHIEVEMENTS, id);
  if (!a) throw notFound('Achievement not found');
  if (a.recipientId !== actorId) throw forbidden('Only the recipient can change the visibility of their achievement');
  if (typeof input.consentPublic !== 'boolean') throw badRequest('consentPublic must be a boolean');
  const updated = await ctx.repo.update(ACHIEVEMENTS, id, { consentPublic: input.consentPublic, consentUpdatedAt: ctx.now() });
  await ctx.audit.record({
    action: 'achievement.consent.update',
    actorId,
    targetType: 'achievement',
    targetId: id,
    detail: { consentPublic: input.consentPublic },
  });
  return updated;
}

export async function listAchievements(ctx: FeatureContext, filter: { recipientId?: string } = {}) {
  const f: Row = {};
  if (filter.recipientId) f.recipientId = filter.recipientId;
  return ctx.repo.find(ACHIEVEMENTS, f, { orderBy: 'awardedAt', desc: true });
}

/* ------------------------------------------------------ certificates */

export async function issueCertificate(
  ctx: FeatureContext,
  actorId: string,
  achievementId: string,
  input: { templateCode?: string } = {},
) {
  const a = await ctx.repo.get(ACHIEVEMENTS, achievementId);
  if (!a) throw notFound('Achievement not found');
  if (a.status === 'disputed') throw conflict('A certificate cannot be issued for a disputed result');
  if (a.status !== 'approved') throw conflict(`A certificate cannot be issued for a ${a.status} achievement`);

  const template = await resolveTemplate(ctx, actorId, input.templateCode);
  const code = verificationCode(a.id, Number(template.version) || 1);

  const existing = await ctx.repo.findOne(CERTIFICATES, { verificationCode: code });
  if (existing) {
    // determinism: the same source record and template version always derive the same code
    throw conflict('A certificate already exists for this achievement', { verificationCode: code, certificateId: existing.id });
  }
  const sameAchievement = await ctx.repo.findOne(CERTIFICATES, { achievementId: a.id, status: 'active' });
  if (sameAchievement) {
    throw conflict('A certificate has already been issued for this achievement', {
      verificationCode: sameAchievement.verificationCode,
      certificateId: sameAchievement.id,
    });
  }

  const row = await ctx.repo.insert(CERTIFICATES, {
    id: ctx.newId(),
    achievementId: a.id,
    recipientId: a.recipientId,
    templateCode: template.code,
    templateVersion: Number(template.version) || 1,
    verificationCode: code,
    status: 'active',
    issuedBy: actorId,
    issuedAt: ctx.now(),
    revokedBy: null,
    revokeReason: null,
    revokedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'achievement.certificate.issue',
    actorId,
    targetType: 'certificate',
    targetId: row.id,
    detail: { achievementId: a.id, verificationCode: code, templateVersion: row.templateVersion },
  });
  return row;
}

export async function revokeCertificate(ctx: FeatureContext, actorId: string, id: string, input: { reason?: string } = {}) {
  const cert = await ctx.repo.get(CERTIFICATES, id);
  if (!cert) throw notFound('Certificate not found');
  if (cert.status === 'revoked') throw conflict('Certificate is already revoked');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw badRequest('reason is required to revoke a certificate');
  const updated = await ctx.repo.update(CERTIFICATES, id, {
    status: 'revoked',
    revokedBy: actorId,
    revokeReason: reason,
    revokedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'achievement.certificate.revoke',
    actorId,
    targetType: 'certificate',
    targetId: id,
    detail: { reason, verificationCode: cert.verificationCode },
  });
  return updated;
}

/** Public verification: minimum information only — no contact details, no account data. */
export async function verifyCertificate(ctx: FeatureContext, code: string) {
  const cert = await ctx.repo.findOne(CERTIFICATES, { verificationCode: String(code || '').trim().toUpperCase() });
  if (!cert) throw notFound('No certificate matches that verification code');
  const achievement = await ctx.repo.get(ACHIEVEMENTS, cert.achievementId);
  const recipient = await ctx.repo.get('users', cert.recipientId);
  return {
    valid: cert.status === 'active',
    status: cert.status,
    verificationCode: cert.verificationCode,
    holderName: recipient?.name ?? 'Club member',
    achievementTitle: achievement?.title ?? null,
    achievementType: achievement?.type ?? null,
    templateCode: cert.templateCode,
    templateVersion: cert.templateVersion,
    issuedAt: cert.issuedAt,
    revokedAt: cert.revokedAt ?? null,
  };
}

export async function hallOfFame(ctx: FeatureContext) {
  const approved = await ctx.repo.find(ACHIEVEMENTS, { status: 'approved', consentPublic: true }, { orderBy: 'awardedAt', desc: true });
  const out: Row[] = [];
  for (const a of approved) {
    const cert = await ctx.repo.findOne(CERTIFICATES, { achievementId: a.id, status: 'active' });
    const recipient = await ctx.repo.get('users', a.recipientId);
    out.push({
      achievementId: a.id,
      title: a.title,
      type: a.type,
      holderName: recipient?.name ?? 'Club member',
      awardedAt: a.awardedAt,
      certificateVerificationCode: cert?.verificationCode ?? null,
    });
  }
  return out;
}

export async function myCertificates(ctx: FeatureContext, recipientId: string) {
  return ctx.repo.find(CERTIFICATES, { recipientId }, { orderBy: 'issuedAt', desc: true });
}
