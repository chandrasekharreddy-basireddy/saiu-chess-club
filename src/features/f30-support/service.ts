import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

/**
 * Feature 30 — Feedback, Complaints & Support
 *
 * Tables
 *  support_tickets      — tickets / complaints / feedback with a lifecycle and SLA.
 *  support_ticket_notes — internal staff notes (never returned to a submitter).
 *
 * Lifecycle:  open -> in_progress -> resolved -> closed
 *             resolved|closed -> open  (reopen, policy-limited)
 * Escalation is an audited flag, not a state: a ticket can be escalated at any point.
 *
 * Confidentiality: a submitter only ever sees their own tickets. Staff need
 * `support.handle`; confidential complaints additionally need the narrower
 * `support.confidential.handle` key, which is not granted to ordinary committee roles.
 */

export const TICKETS = 'support_tickets';
export const NOTES = 'support_ticket_notes';

export const CATEGORIES = [
  'technical', 'tournament_dispute', 'membership', 'event_concern',
  'accessibility', 'community_report', 'confidential_complaint', 'general_feedback',
] as const;

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/** hours until the SLA deadline, by priority */
export const SLA_HOURS: Record<string, number> = { urgent: 4, high: 8, normal: 24, low: 72 };

/** categories that must go to the restricted queue */
export const CONFIDENTIAL_CATEGORIES = ['confidential_complaint', 'community_report'];

export const MAX_REOPENS = 2;

export interface TicketInput {
  category: string;
  subject: string;
  body: string;
  priority?: string;
  confidential?: boolean;
  relatedTo?: string;
  attachments?: string[];
}

export const CONFIDENTIAL_PERMISSION = 'support.confidential.handle';

function isStaff(session: any): boolean {
  const perms: string[] = session?.permissions ?? [];
  return perms.includes('*') || perms.includes('support.handle');
}

function canSeeConfidential(session: any): boolean {
  const perms: string[] = session?.permissions ?? [];
  return perms.includes('*') || perms.includes(CONFIDENTIAL_PERMISSION);
}

function slaDueAt(nowIso: string, priority: string): string {
  const hours = SLA_HOURS[priority] ?? SLA_HOURS.normal;
  return new Date(new Date(nowIso).getTime() + hours * 3600 * 1000).toISOString();
}

function slaStatus(ticket: Row, nowIso: string) {
  if (ticket.status === 'resolved' || ticket.status === 'closed') return 'met';
  const due = new Date(ticket.slaDueAt ?? 0).getTime();
  const now = new Date(nowIso).getTime();
  if (now > due) return 'breached';
  if (due - now < 2 * 3600 * 1000) return 'at_risk';
  return 'on_track';
}

export async function createTicket(ctx: FeatureContext, userId: string, input: TicketInput) {
  if (!input || typeof input !== 'object') throw badRequest('A ticket payload is required');
  const category = String(input.category ?? '').toLowerCase();
  if (!CATEGORIES.includes(category as any)) throw badRequest(`category must be one of: ${CATEGORIES.join(', ')}`);
  if (!input.subject || !String(input.subject).trim()) throw badRequest('subject is required');
  if (!input.body || !String(input.body).trim()) throw badRequest('body is required');
  const priority = String(input.priority ?? 'normal').toLowerCase();
  if (!PRIORITIES.includes(priority as any)) throw badRequest(`priority must be one of: ${PRIORITIES.join(', ')}`);

  const confidential = !!input.confidential || CONFIDENTIAL_CATEGORIES.includes(category);
  const now = ctx.now();
  const row = await ctx.repo.insert(TICKETS, {
    id: ctx.newId(),
    reference: `SUP-${ctx.newId()}`,
    category,
    subject: String(input.subject).trim(),
    body: String(input.body).trim(),
    priority,
    confidential,
    queue: confidential ? 'restricted' : 'general',
    status: 'open',
    requesterId: userId,
    assigneeId: null,
    relatedTo: input.relatedTo ?? null,
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    slaDueAt: slaDueAt(now, priority),
    escalated: false,
    escalationReason: null,
    escalatedAt: null,
    escalatedBy: null,
    resolution: null,
    resolvedAt: null,
    closedAt: null,
    acknowledgedAt: null,
    reopenCount: 0,
    openedAt: now,
  });
  await ctx.audit.record({
    action: 'support.ticket.create', actorId: userId, targetType: 'support_ticket', targetId: row.id,
    detail: { category, priority, confidential },
  });
  // the submitter receives the requester-facing view (no internal fields)
  return requesterView(row, now);
}

function requireStaffFor(session: any, ticket: Row) {
  if (!isStaff(session)) throw forbidden('Requires permission: support.handle');
  if (ticket.confidential && !canSeeConfidential(session)) {
    throw forbidden('Confidential complaints require the support.confidential.handle permission');
  }
}

/** Internal-only note. Never exposed to the submitter. */
export async function addNote(ctx: FeatureContext, session: any, id: string, body: string) {
  const ticket = await ctx.repo.get(TICKETS, id);
  if (!ticket) throw notFound('Ticket not found');
  requireStaffFor(session, ticket);
  if (!body || !String(body).trim()) throw badRequest('note body is required');
  const note = await ctx.repo.insert(NOTES, {
    id: ctx.newId(),
    ticketId: id,
    authorId: session.userId,
    body: String(body).trim(),
    internal: true,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'support.ticket.note', actorId: session.userId, targetType: 'support_ticket', targetId: id });
  return note;
}

export async function assignTicket(ctx: FeatureContext, session: any, id: string, assigneeId?: string) {
  const ticket = await ctx.repo.get(TICKETS, id);
  if (!ticket) throw notFound('Ticket not found');
  requireStaffFor(session, ticket);
  if (ticket.status !== 'open') throw conflict(`Only an open ticket can be acknowledged/assigned (current: ${ticket.status})`);
  const updated = await ctx.repo.update(TICKETS, id, {
    status: 'in_progress',
    assigneeId: assigneeId || session.userId,
    assignedBy: session.userId,
    assignedAt: ctx.now(),
    acknowledgedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'support.ticket.assign', actorId: session.userId, targetType: 'support_ticket', targetId: id,
    detail: { assigneeId: updated?.assigneeId },
  });
  return updated;
}

export async function escalateTicket(ctx: FeatureContext, session: any, id: string, reason: string) {
  const ticket = await ctx.repo.get(TICKETS, id);
  if (!ticket) throw notFound('Ticket not found');
  requireStaffFor(session, ticket);
  if (ticket.status === 'closed') throw conflict('A closed ticket cannot be escalated; reopen it first');
  if (!reason || !String(reason).trim()) throw badRequest('An escalation reason is required');
  const updated = await ctx.repo.update(TICKETS, id, {
    escalated: true,
    escalationReason: String(reason).trim(),
    escalatedAt: ctx.now(),
    escalatedBy: session.userId,
    escalatedTo: 'president',
  });
  await ctx.audit.record({
    action: 'support.ticket.escalate', actorId: session.userId, targetType: 'support_ticket', targetId: id,
    detail: { reason },
  });
  return updated;
}

export async function resolveTicket(ctx: FeatureContext, session: any, id: string, resolution: string) {
  const ticket = await ctx.repo.get(TICKETS, id);
  if (!ticket) throw notFound('Ticket not found');
  requireStaffFor(session, ticket);
  if (ticket.status !== 'in_progress' && ticket.status !== 'open') {
    throw conflict(`Only an open or in-progress ticket can be resolved (current: ${ticket.status})`);
  }
  if (!resolution || !String(resolution).trim()) throw badRequest('A resolution summary is required');
  const updated = await ctx.repo.update(TICKETS, id, {
    status: 'resolved', resolution: String(resolution).trim(), resolvedAt: ctx.now(), resolvedBy: session.userId,
  });
  await ctx.audit.record({ action: 'support.ticket.resolve', actorId: session.userId, targetType: 'support_ticket', targetId: id });
  return updated;
}

export async function closeTicket(ctx: FeatureContext, session: any, id: string) {
  const ticket = await ctx.repo.get(TICKETS, id);
  if (!ticket) throw notFound('Ticket not found');
  const owner = ticket.requesterId === session?.userId;
  if (!owner) requireStaffFor(session, ticket);
  if (ticket.status !== 'resolved') throw conflict(`Only a resolved ticket can be closed (current: ${ticket.status})`);
  const updated = await ctx.repo.update(TICKETS, id, {
    status: 'closed', closedAt: ctx.now(), closedBy: session.userId,
  });
  await ctx.audit.record({ action: 'support.ticket.close', actorId: session.userId, targetType: 'support_ticket', targetId: id });
  return updated;
}

/** Reopen under policy: submitter only, at most MAX_REOPENS times. */
export async function reopenTicket(ctx: FeatureContext, session: any, id: string, reason?: string) {
  const ticket = await ctx.repo.get(TICKETS, id);
  if (!ticket) throw notFound('Ticket not found');
  if (ticket.requesterId !== session?.userId) throw forbidden('Only the submitter can reopen this ticket');
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    throw conflict(`Only a resolved or closed ticket can be reopened (current: ${ticket.status})`);
  }
  const count = Number(ticket.reopenCount ?? 0);
  if (count >= MAX_REOPENS) throw conflict(`Reopen policy: a ticket may be reopened at most ${MAX_REOPENS} times`);
  const updated = await ctx.repo.update(TICKETS, id, {
    status: 'open',
    assigneeId: null,
    acknowledgedAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: count + 1,
    reopenReason: reason ?? null,
    reopenedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'support.ticket.reopen', actorId: session.userId, targetType: 'support_ticket', targetId: id });
  return updated;
}

/** Submitter-facing view: no internal notes, no staff-only escalation detail. */
export function requesterView(ticket: Row, nowIso: string) {
  return {
    id: ticket.id,
    reference: ticket.reference,
    category: ticket.category,
    subject: ticket.subject,
    body: ticket.body,
    priority: ticket.priority,
    status: ticket.status,
    queue: ticket.queue,
    confidential: !!ticket.confidential,
    escalated: !!ticket.escalated,
    slaDueAt: ticket.slaDueAt,
    slaStatus: slaStatus(ticket, nowIso),
    resolution: ticket.resolution ?? null,
    openedAt: ticket.openedAt,
    resolvedAt: ticket.resolvedAt ?? null,
    closedAt: ticket.closedAt ?? null,
    reopenCount: ticket.reopenCount ?? 0,
  };
}

export async function getTicket(ctx: FeatureContext, session: any, id: string) {
  const ticket = await ctx.repo.get(TICKETS, id);
  if (!ticket) throw notFound('Ticket not found');
  const owner = ticket.requesterId === session?.userId;
  const staff = isStaff(session);
  if (!owner) {
    if (!staff) throw forbidden('You may only view your own tickets');
    if (ticket.confidential && !canSeeConfidential(session)) {
      throw forbidden('Confidential complaints require the support.confidential.handle permission');
    }
  }
  const nowIso = ctx.now();
  if (owner && !staff) return requesterView(ticket, nowIso);
  const notes = await ctx.repo.find(NOTES, { ticketId: id }, { orderBy: 'createdAt' });
  return { ...ticket, slaStatus: slaStatus(ticket, nowIso), internalNotes: notes };
}

export async function listTickets(ctx: FeatureContext, session: any, filter: { status?: string } = {}) {
  const staff = isStaff(session);
  const nowIso = ctx.now();
  if (!staff) {
    const rows = await ctx.repo.find(TICKETS, { requesterId: session?.userId });
    const f = filter.status ? rows.filter((r: Row) => r.status === filter.status) : rows;
    return f.map((r: Row) => requesterView(r, nowIso));
  }
  const rows = await ctx.repo.find(TICKETS, {}, { orderBy: 'createdAt', desc: true });
  return rows
    .filter((r: Row) => !r.confidential || canSeeConfidential(session))
    .filter((r: Row) => (filter.status ? r.status === filter.status : true))
    .map((r: Row) => ({ ...r, slaStatus: slaStatus(r, nowIso) }));
}

/** Staff queue: confidential cases are hidden unless the caller holds the narrow key. */
export async function staffQueue(ctx: FeatureContext, session: any, filter: { queue?: string; status?: string } = {}) {
  if (!isStaff(session)) throw forbidden('Requires permission: support.handle');
  const nowIso = ctx.now();
  const rows = await ctx.repo.find(TICKETS, {}, { orderBy: 'createdAt' });
  return rows
    .filter((r: Row) => (r.confidential ? canSeeConfidential(session) : true))
    .filter((r: Row) => (filter.queue ? r.queue === filter.queue : true))
    .filter((r: Row) => (filter.status ? r.status === filter.status : true))
    .sort((a: Row, b: Row) => Number(!!b.escalated) - Number(!!a.escalated))
    .map((r: Row) => ({ ...r, slaStatus: slaStatus(r, nowIso) }));
}
