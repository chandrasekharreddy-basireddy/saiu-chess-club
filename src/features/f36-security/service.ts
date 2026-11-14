import type { FeatureContext, Session, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable, quotaExceeded } from '../../core/errors.js';
import { hasPermission, permissionsFor, assertNotSelfApproval } from '../../core/permissions.js';
import { hashPassword, verifyPassword } from '../../core/auth.js';

/**
 * Feature 36 — Privacy, Security & Account Protection
 *
 * Tables
 *  - security_privacy_settings     one row per user: profile visibility + consent preferences
 *  - security_blocked_users        user-to-user blocks
 *  - security_requests             data access / correction / deactivation / deletion requests (review workflow)
 *  - security_login_attempts       failed sign-in counter + cooling lock per account email
 *  - security_mfa                  MFA enrolment state per user
 *  - security_events               security notification feed (privileged read only)
 *  - security_session_revocations  revocation log, propagated to API + WebSocket layers
 *  - sessions                      core table (written by core/auth.js) — listed and revoked here
 *
 * Privacy settings never override legal / audit / tournament-integrity retention: retention
 * related keys are rejected outright, and deletion is only ever *authorised* here — the
 * governance + retention process performs it.
 */

export const PRIVACY = 'security_privacy_settings';
export const BLOCKS = 'security_blocked_users';
export const REQUESTS = 'security_requests';
export const ATTEMPTS = 'security_login_attempts';
export const MFA = 'security_mfa';
export const EVENTS = 'security_events';
export const REVOCATIONS = 'security_session_revocations';
export const SESSIONS = 'sessions';
export const USERS = 'users';

export const MAX_FAILURES = 5;
export const COOLING_MS = 15 * 60 * 1000;

export const VISIBILITY = ['public', 'members', 'private'];
export const REQUEST_TYPES = ['data_access', 'data_correction', 'deactivation', 'deletion'];
export const ASSIGNABLE_ROLES = [
  'president', 'administrator', 'organizer', 'coach',
  'committee', 'member', 'alumnus', 'spectator',
];

/** keys that would weaken mandatory retention — never settable from the privacy screen */
const RETENTION_GUARD = ['retentionOverride', 'disableRetention', 'overrideLegalHold', 'deleteAuditLogs', 'purgeAuditTrail'];

const BOOLEAN_PREFS = ['showEmail', 'showRating', 'showRealName', 'allowDirectMessages', 'consentMarketing', 'consentAnalytics'];

/** Protected fields are private by default (spec: "protected fields remain private by default"). */
export const DEFAULT_PRIVACY: Row = {
  profileVisibility: 'private',
  showEmail: false,
  showRating: false,
  showRealName: false,
  allowDirectMessages: false,
  consentMarketing: false,
  consentAnalytics: false,
};

async function recordEvent(ctx: FeatureContext, userId: string | null, type: string, detail?: any) {
  return ctx.repo.insert(EVENTS, {
    id: ctx.newId(),
    userId,
    type,
    detail: detail ?? null,
    createdAt: ctx.now(),
  });
}

/* ------------------------------------------------------------------ privacy */

export async function getPrivacy(ctx: FeatureContext, userId: string) {
  const row = await ctx.repo.findOne(PRIVACY, { userId });
  if (row) return row;
  return ctx.repo.insert(PRIVACY, { id: ctx.newId(), userId, ...DEFAULT_PRIVACY, createdAt: ctx.now() });
}

export async function updatePrivacy(ctx: FeatureContext, actorId: string, input: any = {}) {
  for (const key of RETENTION_GUARD) {
    if (input[key] !== undefined) {
      throw unprocessable('Privacy settings cannot override mandatory legal, audit or tournament-integrity retention');
    }
  }
  const patch: Row = {};
  if (input.profileVisibility !== undefined) {
    if (!VISIBILITY.includes(input.profileVisibility)) {
      throw badRequest(`profileVisibility must be one of ${VISIBILITY.join(', ')}`);
    }
    patch.profileVisibility = input.profileVisibility;
  }
  for (const key of BOOLEAN_PREFS) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') throw badRequest(`${key} must be a boolean`);
    patch[key] = input[key];
  }
  if (!Object.keys(patch).length) throw badRequest('No supported privacy preference supplied');

  const current = await getPrivacy(ctx, actorId);
  const updated = await ctx.repo.update(PRIVACY, current.id, { ...patch, updatedAt: ctx.now() });
  await ctx.audit.record({ action: 'security.privacy.update', actorId, targetType: 'user', targetId: actorId, detail: patch });
  return updated;
}

/* ----------------------------------------------------------------- sessions */

function sessionView(row: Row, nowMs: number, currentToken?: string | null) {
  return {
    id: row.id,
    userId: row.userId,
    device: row.device ?? 'unknown',
    createdAt: row.createdAt ?? null,
    expiresAt: row.expiresAt ?? null,
    revokedAt: row.revokedAt ?? null,
    active: !row.revokedAt && (!row.expiresAt || new Date(row.expiresAt).getTime() > nowMs),
    current: !!currentToken && row.token === currentToken,
  };
}

async function revokeRow(ctx: FeatureContext, actorId: string, row: Row) {
  const revokedAt = ctx.now();
  await ctx.repo.update(SESSIONS, row.id, { revokedAt });
  await ctx.repo.insert(REVOCATIONS, {
    id: ctx.newId(),
    sessionId: row.id,
    userId: row.userId,
    revokedBy: actorId,
    revokedAt,
    channels: ['api', 'websocket'],
    createdAt: revokedAt,
  });
  await recordEvent(ctx, row.userId, 'session_revoked', { sessionId: row.id, byAdmin: row.userId !== actorId });
  return revokedAt;
}

export async function listSessions(
  ctx: FeatureContext,
  session: Session,
  opts: { userId?: string; currentToken?: string | null } = {},
) {
  const target = opts.userId || session.userId;
  if (target !== session.userId && !hasPermission(session, 'security.session.manage')) {
    throw forbidden('You may only review your own sessions');
  }
  const nowMs = new Date(ctx.now()).getTime();
  const rows = await ctx.repo.find(SESSIONS, { userId: target }, { orderBy: 'createdAt', desc: true });
  return {
    userId: target,
    sessions: rows.map((row) => sessionView(row, nowMs, opts.currentToken)),
  };
}

export async function revokeSession(ctx: FeatureContext, session: Session, sessionId: string) {
  if (!sessionId) throw badRequest('Session id is required');
  const row = await ctx.repo.get(SESSIONS, sessionId);
  if (!row) throw notFound('Session not found');
  const isAdmin = hasPermission(session, 'security.session.manage');
  if (row.userId !== session.userId && !isAdmin) throw forbidden('You may only revoke your own sessions');
  if (row.revokedAt) throw conflict('Session is already revoked');

  const revokedAt = await revokeRow(ctx, session.userId, row);
  await ctx.audit.record({
    action: 'security.session.revoke',
    actorId: session.userId,
    targetType: 'session',
    targetId: row.id,
    detail: { ownerId: row.userId, byAdmin: row.userId !== session.userId, channels: ['api', 'websocket'] },
  });
  return { id: row.id, userId: row.userId, revokedAt, channels: ['api', 'websocket'] };
}

export async function revokeAllSessions(
  ctx: FeatureContext,
  session: Session,
  currentToken?: string | null,
) {
  const rows = await ctx.repo.find(SESSIONS, { userId: session.userId });
  const revoked: string[] = [];
  for (const row of rows) {
    if (row.revokedAt) continue;
    if (currentToken && row.token === currentToken) continue;
    await revokeRow(ctx, session.userId, row);
    revoked.push(row.id);
  }
  await ctx.audit.record({
    action: 'security.session.revoke_all',
    actorId: session.userId,
    targetType: 'user',
    targetId: session.userId,
    detail: { count: revoked.length },
  });
  return { revoked: revoked.length, sessionIds: revoked };
}

/** Revocation log consumed by the WebSocket layer so revocation propagates beyond HTTP. */
export async function listRevocations(
  ctx: FeatureContext,
  session: Session,
  opts: { userId?: string; since?: string } = {},
) {
  const target = opts.userId || session.userId;
  if (target !== session.userId && !hasPermission(session, 'security.session.manage')) {
    throw forbidden('You may only review your own session revocations');
  }
  const rows = await ctx.repo.find(REVOCATIONS, { userId: target }, { orderBy: 'revokedAt', desc: true });
  const sinceMs = opts.since ? new Date(opts.since).getTime() : null;
  return sinceMs == null ? rows : rows.filter((r) => new Date(r.revokedAt).getTime() > sinceMs);
}

/* --------------------------------------------------------- password / MFA */

async function requirePassword(ctx: FeatureContext, userId: string, password: any, what: string) {
  if (!password) throw badRequest(`password is required to ${what} (reauthentication)`);
  const user = await ctx.repo.get(USERS, userId);
  if (!user) throw notFound('User not found');
  const valid = await verifyPassword(String(password), String(user.passwordHash || ''));
  if (!valid) throw forbidden(`Reauthentication failed: password is incorrect`);
  return user;
}

export async function changePassword(
  ctx: FeatureContext,
  session: Session,
  input: any = {},
  currentToken?: string | null,
) {
  if (!input.currentPassword) throw badRequest('currentPassword is required (reauthentication)');
  const newPassword = input.newPassword;
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw badRequest('newPassword must be at least 8 characters');
  }
  if (newPassword === input.currentPassword) throw badRequest('newPassword must differ from the current password');
  await requirePassword(ctx, session.userId, input.currentPassword, 'change your password');

  const passwordHash = await hashPassword(newPassword);
  await ctx.repo.update(USERS, session.userId, { passwordHash, passwordChangedAt: ctx.now() });

  const rows = await ctx.repo.find(SESSIONS, { userId: session.userId });
  let revoked = 0;
  for (const row of rows) {
    if (row.revokedAt) continue;
    if (currentToken && row.token === currentToken) continue;
    await revokeRow(ctx, session.userId, row);
    revoked += 1;
  }
  await ctx.audit.record({
    action: 'security.password.change',
    actorId: session.userId,
    targetType: 'user',
    targetId: session.userId,
    detail: { sessionsRevoked: revoked },
  });
  await recordEvent(ctx, session.userId, 'password_changed', { sessionsRevoked: revoked });
  return { userId: session.userId, changedAt: ctx.now(), sessionsRevoked: revoked };
}

export async function getMfa(ctx: FeatureContext, userId: string) {
  const row = await ctx.repo.findOne(MFA, { userId });
  if (row) return row;
  return { userId, enabled: false, method: null, recoveryCodesIssued: 0, enabledAt: null, disabledAt: null };
}

export async function enableMfa(ctx: FeatureContext, session: Session, input: any = {}) {
  const method = input.method || 'totp';
  if (!['totp', 'webauthn'].includes(method)) throw badRequest('method must be totp or webauthn');
  const existing = await ctx.repo.findOne(MFA, { userId: session.userId });
  if (existing && existing.enabled) throw conflict('MFA is already enabled');

  const row = existing
    ? await ctx.repo.update(MFA, existing.id, { enabled: true, method, enabledAt: ctx.now(), disabledAt: null, recoveryCodesIssued: 10 })
    : await ctx.repo.insert(MFA, {
        id: ctx.newId(),
        userId: session.userId,
        enabled: true,
        method,
        enabledAt: ctx.now(),
        disabledAt: null,
        recoveryCodesIssued: 10,
        createdAt: ctx.now(),
      });
  await ctx.audit.record({ action: 'security.mfa.enable', actorId: session.userId, targetType: 'user', targetId: session.userId, detail: { method } });
  await recordEvent(ctx, session.userId, 'mfa_enabled', { method });
  return row;
}

/** MFA recovery is controlled: disabling (and re-issuing recovery codes) needs reauthentication. */
export async function disableMfa(ctx: FeatureContext, session: Session, input: any = {}) {
  await requirePassword(ctx, session.userId, input.password, 'disable MFA');
  const row = await ctx.repo.findOne(MFA, { userId: session.userId });
  if (!row || !row.enabled) throw conflict('MFA is not enabled');
  const updated = await ctx.repo.update(MFA, row.id, { enabled: false, disabledAt: ctx.now(), recoveryCodesIssued: 0 });
  await ctx.audit.record({ action: 'security.mfa.disable', actorId: session.userId, targetType: 'user', targetId: session.userId });
  await recordEvent(ctx, session.userId, 'mfa_disabled', { method: row.method });
  return updated;
}

export async function rotateRecoveryCodes(ctx: FeatureContext, session: Session, input: any = {}) {
  await requirePassword(ctx, session.userId, input.password, 're-issue MFA recovery codes');
  const row = await ctx.repo.findOne(MFA, { userId: session.userId });
  if (!row || !row.enabled) throw conflict('MFA is not enabled');
  const updated = await ctx.repo.update(MFA, row.id, { recoveryCodesIssued: 10, recoveryIssuedAt: ctx.now() });
  await ctx.audit.record({ action: 'security.mfa.recovery.issue', actorId: session.userId, targetType: 'user', targetId: session.userId, detail: { count: 10 } });
  await recordEvent(ctx, session.userId, 'mfa_recovery_issued', { count: 10 });
  return { userId: session.userId, recoveryCodesIssued: updated.recoveryCodesIssued, issuedAt: updated.recoveryIssuedAt };
}

/* ---------------------------------------------------------------- blocking */

export async function blockUser(ctx: FeatureContext, actorId: string, targetId: string) {
  if (!targetId) throw badRequest('userId is required');
  if (targetId === actorId) throw badRequest('You cannot block yourself');
  const target = await ctx.repo.get(USERS, targetId);
  if (!target) throw notFound('User not found');
  const existing = await ctx.repo.findOne(BLOCKS, { ownerId: actorId, blockedUserId: targetId });
  if (existing) throw conflict('User is already blocked');
  const row = await ctx.repo.insert(BLOCKS, { id: ctx.newId(), ownerId: actorId, blockedUserId: targetId, createdAt: ctx.now() });
  await ctx.audit.record({ action: 'security.user.block', actorId, targetType: 'user', targetId });
  return row;
}

export async function unblockUser(ctx: FeatureContext, actorId: string, targetId: string) {
  const row = await ctx.repo.findOne(BLOCKS, { ownerId: actorId, blockedUserId: targetId });
  if (!row) throw notFound('That user is not blocked');
  await ctx.repo.remove(BLOCKS, row.id);
  await ctx.audit.record({ action: 'security.user.unblock', actorId, targetType: 'user', targetId });
  return { unblocked: true, userId: targetId };
}

export async function listBlocked(ctx: FeatureContext, actorId: string) {
  return ctx.repo.find(BLOCKS, { ownerId: actorId }, { orderBy: 'createdAt', desc: true });
}

/* ---------------------------------------------------- account/legal requests */

export async function createRequest(ctx: FeatureContext, actorId: string, input: any = {}) {
  const type = input.type;
  if (!REQUEST_TYPES.includes(type)) throw badRequest(`type must be one of ${REQUEST_TYPES.join(', ')}`);
  const row = await ctx.repo.insert(REQUESTS, {
    id: ctx.newId(),
    userId: actorId,
    type,
    detail: input.detail ?? null,
    status: 'pending',
    reviewerId: null,
    decidedAt: null,
    note: null,
    retentionReviewRequired: type === 'deletion' || type === 'deactivation',
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'security.request.create', actorId, targetType: 'security_request', targetId: row.id, detail: { type } });
  await recordEvent(ctx, actorId, 'request_created', { requestId: row.id, type });
  return row;
}

export async function listRequests(ctx: FeatureContext, session: Session, opts: { all?: boolean } = {}) {
  if (opts.all && !hasPermission(session, 'privacy.request.handle')) {
    throw forbidden('Requires permission: privacy.request.handle');
  }
  const filter = opts.all ? {} : { userId: session.userId };
  return ctx.repo.find(REQUESTS, filter, { orderBy: 'createdAt', desc: true });
}

export async function reviewRequest(ctx: FeatureContext, session: Session, id: string, input: any = {}) {
  const row = await ctx.repo.get(REQUESTS, id);
  if (!row) throw notFound('Request not found');
  const decision = input.decision;
  if (!['approved', 'rejected'].includes(decision)) throw badRequest('decision must be approved or rejected');
  if (row.status !== 'pending') throw conflict(`Request is already ${row.status}`);
  try {
    assertNotSelfApproval(session.userId, row.userId, 'an account request');
  } catch {
    throw forbidden('Separation of duties: you cannot review your own account request');
  }

  const updated = await ctx.repo.update(REQUESTS, id, {
    status: decision,
    reviewerId: session.userId,
    decidedAt: ctx.now(),
    note: input.note ?? null,
    // deletion / anonymisation is executed by the governance + retention process, never here
    handedToGovernance: decision === 'approved' && (row.type === 'deletion' || row.type === 'deactivation'),
  });
  await ctx.audit.record({
    action: 'security.request.review',
    actorId: session.userId,
    targetType: 'security_request',
    targetId: id,
    detail: { decision, type: row.type },
  });
  return updated;
}

/* --------------------------------------------------------- login protection */

export async function recordLoginFailure(ctx: FeatureContext, email: string) {
  if (!email || typeof email !== 'string' || !email.trim()) throw badRequest('email is required');
  const key = email.trim().toLowerCase();
  const nowMs = new Date(ctx.now()).getTime();

  let row = await ctx.repo.findOne(ATTEMPTS, { email: key });
  if (!row) {
    row = await ctx.repo.insert(ATTEMPTS, {
      id: ctx.newId(),
      email: key,
      failures: 0,
      lockedUntil: null,
      lastFailureAt: null,
      createdAt: ctx.now(),
    });
  }

  if (row.lockedUntil && new Date(row.lockedUntil).getTime() > nowMs) {
    throw quotaExceeded(`Account is locked until ${row.lockedUntil} after repeated failed sign-in attempts`);
  }

  const coolingExpired = !!row.lockedUntil && new Date(row.lockedUntil).getTime() <= nowMs;
  const base = coolingExpired ? 0 : (row.failures || 0);
  const failures = base + 1;
  const locked = failures >= MAX_FAILURES;
  const lockedUntil = locked ? new Date(nowMs + COOLING_MS).toISOString() : null;

  const updated = await ctx.repo.update(ATTEMPTS, row.id, { failures, lockedUntil, lastFailureAt: ctx.now() });

  if (locked) {
    await ctx.audit.record({
      action: 'security.login.lock',
      targetType: 'account',
      targetId: key,
      detail: { failures, lockedUntil },
    });
    await recordEvent(ctx, null, 'account_locked', { email: key, failures, lockedUntil });
  }

  return {
    email: key,
    failures: updated.failures,
    maxFailures: MAX_FAILURES,
    remaining: Math.max(0, MAX_FAILURES - failures),
    locked,
    lockedUntil,
  };
}

export async function clearLoginFailures(ctx: FeatureContext, email: string) {
  if (!email || typeof email !== 'string' || !email.trim()) throw badRequest('email is required');
  const key = email.trim().toLowerCase();
  const row = await ctx.repo.findOne(ATTEMPTS, { email: key });
  if (!row) return { email: key, failures: 0, locked: false, lockedUntil: null };
  const updated = await ctx.repo.update(ATTEMPTS, row.id, { failures: 0, lockedUntil: null, lastFailureAt: null });
  await ctx.audit.record({ action: 'security.login.clear', targetType: 'account', targetId: key });
  return { email: key, failures: updated.failures, locked: false, lockedUntil: null };
}

/** Clears the counter for the signed-in account only (called after a successful sign-in). */
export async function clearOwnLoginFailures(ctx: FeatureContext, session: Session) {
  const user = await ctx.repo.get(USERS, session.userId);
  if (!user || !user.email) throw notFound('User not found');
  return clearLoginFailures(ctx, String(user.email));
}

/* ------------------------------------------------------------ role control */

/** Role assignment is restricted to `security.role.assign` and always audited. */
export async function assignRoles(ctx: FeatureContext, session: Session, input: any = {}) {
  const userId = input.userId;
  if (!userId) throw badRequest('userId is required');
  const roles = input.roles;
  if (!Array.isArray(roles) || roles.length === 0) throw badRequest('roles must be a non-empty array');

  const unknown = roles.filter((r: any) => !ASSIGNABLE_ROLES.includes(r));
  if (unknown.length) throw unprocessable(`Unknown role(s): ${unknown.join(', ')}`);

  if (userId === session.userId) throw forbidden('Separation of duties: you cannot change your own roles');

  const actorIsAdmin = (session.permissions || []).includes('*');
  if (roles.includes('administrator') && !actorIsAdmin) {
    throw forbidden('Only an administrator may grant the administrator role');
  }

  const user = await ctx.repo.get(USERS, userId);
  if (!user) throw notFound('User not found');

  const updated = await ctx.repo.update(USERS, userId, {
    roles,
    permissions: permissionsFor(roles as any),
    rolesAssignedBy: session.userId,
    rolesAssignedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'security.role.assign',
    actorId: session.userId,
    targetType: 'user',
    targetId: userId,
    detail: { roles, previousRoles: user.roles || [] },
  });
  await recordEvent(ctx, userId, 'roles_assigned', { roles });
  return { userId, roles: updated?.roles ?? roles, permissions: updated?.permissions ?? permissionsFor(roles as any) };
}

/* ------------------------------------------------------------------- feed */

/** Security telemetry is privileged: ordinary users must not read it. */
export async function listSecurityEvents(ctx: FeatureContext, session: Session, opts: { userId?: string } = {}) {
  if (!hasPermission(session, 'security.operations.manage') && !hasPermission(session, 'audit.log.read')) {
    throw forbidden('Security telemetry requires security.operations.manage');
  }
  const filter = opts.userId ? { userId: opts.userId } : {};
  return ctx.repo.find(EVENTS, filter, { orderBy: 'createdAt', desc: true });
}
