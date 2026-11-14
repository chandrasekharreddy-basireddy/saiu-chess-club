import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound, forbidden } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Tables (created implicitly on first insert)
 *
 * ops_tasks             cross-module work items: title, scope, projectId, assigneeId, priority,
 *                       dueDate, status, completion evidence, supervisor review
 * ops_task_events       status history (from, to, actorId, note, at)
 * ops_task_dependencies blocker edges: taskId depends on dependsOnId
 *
 * Status machine: open -> in_progress -> submitted -> closed, with 'blocked' and 'cancelled'
 * as side states. A task cannot start while a dependency is not closed, and the person who
 * owns (or raised) a task may not close it: completion needs an independent supervisor review.
 */

export const TASK = 'ops_tasks';
export const EVENT = 'ops_task_events';
export const DEP = 'ops_task_dependencies';

export const SCOPES = ['tournament', 'event', 'facility', 'communications', 'governance', 'platform'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const TERMINAL = ['closed', 'cancelled'];

export const TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['submitted', 'blocked', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  submitted: ['closed', 'in_progress'],
  closed: [],
  cancelled: [],
};

function text(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDate(value: any, field: string): string {
  const raw = text(value);
  if (!raw) throw badRequest(`${field} is required`);
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw badRequest(`${field} must be an ISO date`);
  return new Date(ms).toISOString();
}

/** Overdue is derived from the due date and the state — never stored. */
export function isOverdue(task: Row, nowIso: string): boolean {
  if (!task || TERMINAL.includes(task.status)) return false;
  if (!task.dueDate) return false;
  const due = Date.parse(task.dueDate);
  const now = Date.parse(nowIso);
  if (Number.isNaN(due) || Number.isNaN(now)) return false;
  return due < now;
}

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

export async function createTask(ctx: FeatureContext, actorId: string, input: any) {
  if (!input || typeof input !== 'object') throw badRequest('Task payload is required');
  const title = text(input.title);
  if (!title) throw badRequest('Task title is required');
  const assigneeId = text(input.assigneeId);
  if (!assigneeId) throw badRequest('Task assignee is required');
  const dueDate = parseDate(input.dueDate, 'dueDate');
  const scope = text(input.scope) || 'platform';
  if (!SCOPES.includes(scope)) throw badRequest(`Unknown task scope: ${scope}`);
  const priority = text(input.priority) || 'normal';
  if (!PRIORITIES.includes(priority)) throw badRequest(`Unknown task priority: ${priority}`);

  const row = await ctx.repo.insert(TASK, {
    id: ctx.newId(),
    title,
    description: text(input.description) || null,
    scope,
    projectId: text(input.projectId) || null,
    assigneeId,
    priority,
    dueDate,
    status: 'open',
    sensitive: !!input.sensitive,
    checklist: Array.isArray(input.checklist) ? input.checklist.map((x: any) => String(x)) : [],
    evidence: null,
    submittedAt: null,
    closedAt: null,
    reviewedBy: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.repo.insert(EVENT, {
    id: ctx.newId(),
    taskId: row.id,
    from: null,
    to: 'open',
    actorId,
    note: 'created',
    at: ctx.now(),
  });
  await ctx.audit.record({
    action: 'task.create',
    actorId,
    targetType: 'ops_task',
    targetId: row.id,
    detail: { scope, assigneeId, priority, dueDate },
  });
  return { ...row, overdue: isOverdue(row, ctx.now()) };
}

async function blockersOf(ctx: FeatureContext, taskId: string) {
  const edges = await ctx.repo.find(DEP, { taskId }, { orderBy: 'createdAt' });
  const open: Row[] = [];
  for (const edge of edges) {
    const upstream = await ctx.repo.get(TASK, edge.dependsOnId);
    if (upstream && upstream.status !== 'closed') open.push(upstream);
  }
  return open;
}

export async function transitionTask(ctx: FeatureContext, actorId: string, id: string, input: any) {
  const task = await ctx.repo.get(TASK, id);
  if (!task) throw notFound('Task not found');
  const to = text(input?.to);
  if (!to) throw badRequest('Target status is required');
  if (!canTransition(task.status, to)) {
    throw conflict(`Cannot move a task from '${task.status}' to '${to}'`);
  }
  if (to === 'in_progress' || to === 'submitted') {
    const blockers = await blockersOf(ctx, id);
    if (blockers.length) {
      throw conflict(`Task is blocked by ${blockers.length} unfinished dependency(ies)`, {
        blockers: blockers.map((b) => ({ id: b.id, title: b.title, status: b.status })),
      });
    }
  }
  if (to === 'closed') {
    // completion review must be independent of the person who owns or raised the task
    if (task.assigneeId === actorId || task.createdBy === actorId) {
      try {
        assertNotSelfApproval(actorId, task.assigneeId === actorId ? task.assigneeId : task.createdBy, 'a task completion');
      } catch (err: any) {
        throw forbidden(err?.message || 'Separation of duties: completion requires an independent reviewer');
      }
    }
  }

  const patch: Row = { status: to };
  if (to === 'submitted') {
    patch.submittedAt = ctx.now();
    patch.evidence = text(input?.evidence) || task.evidence || null;
  }
  if (to === 'closed') {
    patch.closedAt = ctx.now();
    patch.reviewedBy = actorId;
    patch.reviewNote = text(input?.note) || null;
  }
  const updated = await ctx.repo.update(TASK, id, patch);
  await ctx.repo.insert(EVENT, {
    id: ctx.newId(),
    taskId: id,
    from: task.status,
    to,
    actorId,
    note: text(input?.note) || null,
    at: ctx.now(),
  });
  await ctx.audit.record({
    action: 'task.transition',
    actorId,
    targetType: 'ops_task',
    targetId: id,
    detail: { from: task.status, to },
  });
  return { ...updated, overdue: isOverdue(updated, ctx.now()) };
}

export async function addDependency(ctx: FeatureContext, actorId: string, taskId: string, input: any) {
  const task = await ctx.repo.get(TASK, taskId);
  if (!task) throw notFound('Task not found');
  const dependsOnId = text(input?.dependsOnId);
  if (!dependsOnId) throw badRequest('dependsOnId is required');
  if (dependsOnId === taskId) throw badRequest('A task cannot depend on itself');
  const upstream = await ctx.repo.get(TASK, dependsOnId);
  if (!upstream) throw notFound('Dependency task not found');
  const existing = await ctx.repo.findOne(DEP, { taskId, dependsOnId });
  if (existing) throw conflict('This dependency already exists');
  // reject a cycle: the upstream task must not (transitively) depend on this task
  const seen = new Set<string>();
  const queue = [dependsOnId];
  while (queue.length) {
    const current = queue.shift() as string;
    if (current === taskId) throw conflict('Dependency would create a cycle');
    if (seen.has(current)) continue;
    seen.add(current);
    const edges = await ctx.repo.find(DEP, { taskId: current });
    for (const edge of edges) queue.push(edge.dependsOnId);
  }
  const row = await ctx.repo.insert(DEP, {
    id: ctx.newId(),
    taskId,
    dependsOnId,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'task.dependency.add',
    actorId,
    targetType: 'ops_task',
    targetId: taskId,
    detail: { dependsOnId },
  });
  return row;
}

export async function getTask(ctx: FeatureContext, id: string) {
  const task = await ctx.repo.get(TASK, id);
  if (!task) throw notFound('Task not found');
  const events = await ctx.repo.find(EVENT, { taskId: id }, { orderBy: 'at' });
  const blockers = await blockersOf(ctx, id);
  return { ...task, overdue: isOverdue(task, ctx.now()), history: events, blockers };
}

export async function listTasks(ctx: FeatureContext, filter: any = {}) {
  const where: Row = {};
  if (text(filter.status)) where.status = text(filter.status);
  if (text(filter.assigneeId)) where.assigneeId = text(filter.assigneeId);
  if (text(filter.projectId)) where.projectId = text(filter.projectId);
  const rows = await ctx.repo.find(TASK, where, { orderBy: 'createdAt', desc: true });
  const now = ctx.now();
  const decorated = rows.map((t) => ({ ...t, overdue: isOverdue(t, now) }));
  const overdueOnly = filter.overdue === true || filter.overdue === 'true';
  return overdueOnly ? decorated.filter((t) => t.overdue) : decorated;
}

export async function listOverdueTasks(ctx: FeatureContext) {
  const rows = await ctx.repo.find(TASK, {}, { orderBy: 'dueDate' });
  const now = ctx.now();
  return rows.filter((t) => isOverdue(t, now)).map((t) => ({ ...t, overdue: true }));
}
