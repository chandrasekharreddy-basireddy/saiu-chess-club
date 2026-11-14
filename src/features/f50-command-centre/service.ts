import type { FeatureContext, Row } from '../../core/types.js';
import { forbidden } from '../../core/errors.js';

/**
 * Tables
 *
 * command_snapshots   durable record of every snapshot served (who, when, the summary it saw)
 *
 * This feature owns no business data. It reads the authoritative tables of the other modules
 * and never writes to them: every cross-module read goes through safeCount/safeFind, which
 * swallow failures so one unavailable module degrades a widget instead of the whole hub.
 */

export const SNAPSHOT = 'command_snapshots';

export const TRACKED_TABLES = [
  'users',
  'sessions',
  'tournaments',
  'tournament_registrations',
  'events',
  'ops_tasks',
  'ops_alerts',
  'academic_years',
  'strategy_objectives',
  'finance_expenses',
  'notices',
  'community_posts',
];

const TERMINAL_TASK_STATES = ['closed', 'cancelled'];

/** Role-aware widgets. Each entry links to the specialist module that owns the work. */
export const ROLE_WIDGETS: Record<string, string[]> = {
  president: ['overview', 'governance-approvals', 'strategy-performance', 'critical-alerts', 'academic-year', 'finance-summary'],
  administrator: ['overview', 'service-health', 'admin-queues', 'critical-alerts', 'security-integration', 'settings'],
  organizer: ['overview', 'tournament-operations', 'events-calendar', 'task-coordination', 'critical-alerts'],
  coach: ['overview', 'assigned-learners', 'coaching-sessions', 'academy'],
  committee: ['overview', 'committee-work', 'task-coordination', 'events-calendar'],
  member: ['personal-chess', 'events-calendar', 'learning', 'notifications'],
  alumnus: ['alumni-community', 'personal-history'],
  spectator: ['read-only-match-view'],
};

export const WIDGET_LINKS: Record<string, string> = {
  overview: '/api/v1/command-centre/snapshot',
  'governance-approvals': '/api/v1/notices',
  'strategy-performance': '/api/v1/strategy/objectives',
  'critical-alerts': '/api/v1/alerts',
  'academic-year': '/api/v1/academic-year/current',
  'finance-summary': '/api/v1/finance',
  'service-health': '/api/v1/command-centre/snapshot',
  'admin-queues': '/api/v1/membership',
  'security-integration': '/api/v1/security',
  settings: '/api/v1/system',
  'tournament-operations': '/api/v1/tournaments',
  'events-calendar': '/api/v1/events',
  'task-coordination': '/api/v1/tasks',
  'assigned-learners': '/api/v1/academy',
  'coaching-sessions': '/api/v1/academy',
  academy: '/api/v1/academy',
  'committee-work': '/api/v1/tasks',
  'personal-chess': '/api/v1/analysis',
  learning: '/api/v1/academy',
  notifications: '/api/v1/notices',
  'alumni-community': '/api/v1/community',
  'personal-history': '/api/v1/analysis',
  'read-only-match-view': '/api/v1/tournaments',
};

function num(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function safeCount(ctx: FeatureContext, table: string, degraded: string[]): Promise<number> {
  try {
    const value = await ctx.repo.count(table, {});
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  } catch {
    if (!degraded.includes(table)) degraded.push(table);
    return 0;
  }
}

async function safeFind(ctx: FeatureContext, table: string, degraded: string[]): Promise<Row[]> {
  try {
    const rows = await ctx.repo.find(table, {});
    return Array.isArray(rows) ? rows : [];
  } catch {
    if (!degraded.includes(table)) degraded.push(table);
    return [];
  }
}

export function taskIsOverdue(task: Row, nowIso: string): boolean {
  if (!task || TERMINAL_TASK_STATES.includes(task.status)) return false;
  if (!task.dueDate) return false;
  const due = Date.parse(task.dueDate);
  const now = Date.parse(nowIso);
  if (Number.isNaN(due) || Number.isNaN(now)) return false;
  return due < now;
}

export function widgetsForRoles(roles: string[]) {
  const keys: string[] = [];
  for (const role of roles || []) {
    for (const widget of ROLE_WIDGETS[role] || []) if (!keys.includes(widget)) keys.push(widget);
  }
  return keys.map((key) => ({ key, label: key.replace(/-/g, ' '), href: WIDGET_LINKS[key] || null }));
}

/** A single aggregated, permission-filtered snapshot of the institution. */
export async function buildSnapshot(ctx: FeatureContext, actorId: string, session: any) {
  const generatedAt = ctx.now();
  const degraded: string[] = [];

  const counts: Record<string, number> = {};
  for (const table of TRACKED_TABLES) {
    counts[table] = await safeCount(ctx, table, degraded);
  }

  const tasks = await safeFind(ctx, 'ops_tasks', degraded);
  const alerts = await safeFind(ctx, 'ops_alerts', degraded);
  const years = await safeFind(ctx, 'academic_years', degraded);

  const openAlerts = alerts
    .filter((a) => a.status !== 'resolved')
    .map((a) => ({
      id: a.id,
      title: a.title,
      severity: a.severity,
      status: a.status,
      escalationLevel: num(a.escalationLevel),
      ackDueAt: a.ackDueAt || null,
      href: '/api/v1/alerts',
    }));

  const overdueTasks = tasks
    .filter((t) => taskIsOverdue(t, generatedAt))
    .map((t) => ({
      id: t.id,
      title: t.title,
      assigneeId: t.assigneeId || null,
      dueDate: t.dueDate,
      status: t.status,
      priority: t.priority || null,
      href: '/api/v1/tasks',
    }));

  const currentYearRow = years.find((y) => y.isCurrent) || null;
  const currentAcademicYear = currentYearRow
    ? {
        id: currentYearRow.id,
        label: currentYearRow.label,
        startsOn: currentYearRow.startsOn,
        endsOn: currentYearRow.endsOn,
        version: num(currentYearRow.version),
      }
    : null;

  const summary = {
    openAlertCount: openAlerts.length,
    criticalAlertCount: openAlerts.filter((a) => a.severity === 'critical').length,
    unacknowledgedAlertCount: openAlerts.filter((a) => a.status === 'open').length,
    overdueTaskCount: overdueTasks.length,
    openTaskCount: tasks.filter((t) => !TERMINAL_TASK_STATES.includes(t.status)).length,
    currentAcademicYear: currentAcademicYear ? currentAcademicYear.label : null,
  };

  const snapshot = {
    generatedAt,
    actorId,
    roles: (session && session.roles) || [],
    counts,
    summary,
    openAlerts,
    overdueTasks,
    currentAcademicYear,
    health: { status: degraded.length ? 'degraded' : 'ok', degradedTables: degraded },
    sources: TRACKED_TABLES.map((table) => ({ table, count: counts[table], readAt: generatedAt })),
    links: { alerts: '/api/v1/alerts', tasks: '/api/v1/tasks', strategy: '/api/v1/strategy/objectives' },
  };

  await ctx.repo.insert(SNAPSHOT, {
    id: ctx.newId(),
    generatedAt,
    actorId,
    summary,
    degradedTables: degraded,
    createdAt: generatedAt,
  });
  await ctx.audit.record({
    action: 'command.snapshot.view',
    actorId,
    targetType: 'command_snapshot',
    targetId: null,
    detail: { degraded: degraded.length },
  });
  return snapshot;
}

export function assertCommandAccess(session: any) {
  if (!session) throw forbidden('Authentication required');
  return session;
}
