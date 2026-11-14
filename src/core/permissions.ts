import type { Role, Session } from './types.js';

/**
 * Permission catalogue (doc 03). Keys are stable, domain-prefixed strings.
 * Feature modules may enforce additional keys; unknown keys simply deny unless granted.
 */
export const ALL_PERMISSIONS = [
  'account.profile.read_own', 'account.profile.update_own', 'account.read_any',
  'membership.approve', 'membership.manage',
  'tournament.create', 'tournament.manage', 'tournament.registration.manage',
  'tournament.schedule.propose', 'tournament.schedule.approve_president', 'tournament.schedule.approve_admin',
  'match.result.confirm_own', 'match.result.manage', 'match.dispute.resolve_assigned',
  'arena.play', 'arena.spectate',
  'analysis.run', 'analysis.read',
  'rating.recalculate', 'leaderboard.read',
  'academy.read', 'academy.content.publish', 'coaching.assignment.manage',
  'community.post', 'community.moderate',
  'achievement.issue', 'certificate.verify',
  'volunteer.manage', 'alumni.manage',
  'event.manage', 'calendar.manage',
  'notice.publish', 'notice.read',
  'governance.election.manage', 'governance.policy.manage',
  'finance.read', 'finance.expense.approve',
  'inventory.manage', 'travel.manage', 'facility.booking', 'facility.booking.approve',
  'sponsorship.manage', 'interuniversity.manage',
  'marketing.manage', 'media.manage', 'search.read', 'support.handle',
  'survey.create', 'survey.respond', 'feedback.submit',
  'site.experience.manage', 'kb.read', 'kb.publish',
  'accessibility.manage', 'commentary.publish',
  'security.role.assign', 'security.session.manage', 'privacy.request.handle',
  'data.backup.manage', 'data.export.request',
  'system.configuration.manage', 'qa.manage', 'legal.compliance.manage',
  'security.operations.manage', 'disaster.recovery.manage',
  'ai.use', 'ai.manage',
  'reporting.read', 'strategy.manage', 'task.manage', 'alert.broadcast',
  'command.view', 'audit.log.read',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number] | string;

const COMMON: Permission[] = ['account.profile.read_own', 'account.profile.update_own', 'notice.read', 'search.read', 'kb.read', 'leaderboard.read', 'academy.read', 'arena.spectate'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  president: [...COMMON, 'tournament.create', 'tournament.manage', 'tournament.schedule.approve_president',
    'match.result.confirm_own', 'match.result.manage', 'match.dispute.resolve_assigned', 'arena.play',
    'notice.publish', 'governance.policy.manage', 'governance.election.manage', 'finance.read',
    'finance.expense.approve', 'sponsorship.manage', 'interuniversity.manage', 'reporting.read',
    'command.view', 'alert.broadcast', 'audit.log.read', 'strategy.manage', 'achievement.issue',
    'community.post', 'community.moderate', 'event.manage', 'calendar.manage', 'ai.use'],
  administrator: ['*'],
  organizer: [...COMMON, 'tournament.create', 'tournament.manage', 'tournament.registration.manage',
    'tournament.schedule.propose', 'match.result.manage', 'match.result.confirm_own',
    'match.dispute.resolve_assigned', 'arena.play', 'event.manage', 'calendar.manage',
    'notice.publish', 'inventory.manage', 'travel.manage', 'facility.booking', 'commentary.publish',
    'volunteer.manage', 'reporting.read', 'task.manage'],
  coach: [...COMMON, 'coaching.assignment.manage', 'academy.content.publish', 'analysis.run',
    'analysis.read', 'match.result.confirm_own', 'arena.play', 'achievement.issue', 'ai.use',
    'commentary.publish'],
  committee: [...COMMON, 'tournament.manage', 'tournament.registration.manage', 'notice.publish',
    'event.manage', 'finance.read', 'support.handle', 'survey.create', 'community.moderate',
    'match.result.confirm_own', 'arena.play', 'task.manage', 'volunteer.manage'],
  member: [...COMMON, 'arena.play', 'match.result.confirm_own', 'community.post', 'survey.respond',
    'feedback.submit', 'analysis.run', 'analysis.read', 'facility.booking', 'ai.use'],
  alumnus: [...COMMON, 'community.post', 'arena.play', 'survey.respond', 'feedback.submit', 'analysis.read'],
  spectator: [...COMMON],
};

/** Effective permissions = union of role grants. '*' is an explicit full grant (administrator only). */
export function permissionsFor(roles: Role[]): string[] {
  const set = new Set<string>();
  for (const r of roles || []) for (const p of ROLE_PERMISSIONS[r] || []) set.add(p as string);
  return [...set];
}

export function hasPermission(session: Session | null | undefined, perm: string): boolean {
  if (!session) return false;
  if (session.state && session.state !== 'active') return false;
  if (session.permissions.includes('*')) return true;
  return session.permissions.includes(perm);
}

export function hasAny(session: Session | null | undefined, perms: string[]): boolean {
  return perms.some((p) => hasPermission(session, p));
}

/** Separation of duties: an actor may never approve their own request. */
export function assertNotSelfApproval(actorId: string, ownerId: string, what = 'this request') {
  if (actorId && ownerId && actorId === ownerId) {
    const e = new Error(`Separation of duties: you cannot approve ${what} you raised`);
    (e as any).code = 'SEPARATION_OF_DUTIES';
    (e as any).status = 403;
    throw e;
  }
}
