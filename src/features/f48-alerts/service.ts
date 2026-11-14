import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors.js';

/**
 * Tables (created implicitly on first insert)
 *
 * ops_alerts        incidents: category, severity, ownerRole, escalationPath, ackDueAt,
 *                   escalationLevel, occurrenceCount, status, resolution
 * ops_alert_config  tunable acknowledgement thresholds (minutes per severity)
 *
 * Escalation ladder: an alert that is still unacknowledged after its ackDueAt moves one rung
 * up its escalationPath on every sweep, capped at min(MAX_ESCALATION_LEVEL, path.length - 1).
 * Everything is derived from ctx.now() so the behaviour is deterministic in tests.
 */

export const ALERT = 'ops_alerts';
export const CONFIG = 'ops_alert_config';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const CATEGORIES = [
  'tournament_disruption',
  'attendance_escalation',
  'match_integrity',
  'security_incident',
  'provider_quota_risk',
  'facility_issue',
  'disaster_recovery',
  'governance_urgent',
];

export const MAX_ESCALATION_LEVEL = 3;

export const DEFAULT_ACK_MINUTES: Record<string, number> = {
  low: 240,
  medium: 120,
  high: 60,
  critical: 15,
};

function text(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function defaultEscalationPath(severity: string): string[] {
  if (severity === 'critical') return ['organizer', 'committee', 'president', 'administrator'];
  if (severity === 'low') return ['organizer', 'president'];
  return ['organizer', 'president', 'administrator'];
}

/** Highest level an alert may reach: never beyond the configured ladder, never above the cap. */
export function escalationCap(path: string[]): number {
  const length = Array.isArray(path) ? path.length : 0;
  return Math.max(0, Math.min(MAX_ESCALATION_LEVEL, length - 1));
}

/** Merge stored configuration over the defaults. */
export async function getThresholds(ctx: FeatureContext): Promise<Record<string, number>> {
  const row = await ctx.repo.findOne(CONFIG, { key: 'ack_minutes' });
  const stored = row && row.value && typeof row.value === 'object' ? row.value : {};
  const merged: Record<string, number> = { ...DEFAULT_ACK_MINUTES };
  for (const severity of SEVERITIES) {
    const value = num(stored[severity]);
    if (value > 0) merged[severity] = value;
  }
  return merged;
}

export async function configureThresholds(ctx: FeatureContext, actorId: string, input: any) {
  const patch = input && typeof input === 'object' ? input : {};
  const current = await getThresholds(ctx);
  const next: Record<string, number> = { ...current };
  let changed = 0;
  for (const severity of SEVERITIES) {
    if (patch[severity] == null) continue;
    const minutes = num(patch[severity]);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
      throw badRequest(`${severity} acknowledgement target must be a whole number of minutes between 1 and 10080`);
    }
    next[severity] = minutes;
    changed += 1;
  }
  if (changed === 0) throw badRequest('Provide at least one severity acknowledgement target');

  const existing = await ctx.repo.findOne(CONFIG, { key: 'ack_minutes' });
  const row = existing
    ? await ctx.repo.update(CONFIG, existing.id, { value: next, updatedBy: actorId, updatedAt: ctx.now() })
    : await ctx.repo.insert(CONFIG, {
        id: ctx.newId(),
        key: 'ack_minutes',
        value: next,
        updatedBy: actorId,
        updatedAt: ctx.now(),
        createdAt: ctx.now(),
      });
  await ctx.audit.record({
    action: 'alert.thresholds.update',
    actorId,
    targetType: 'alert_config',
    targetId: row ? row.id : null,
    detail: next,
  });
  return { thresholds: next, source: CONFIG, updatedAt: ctx.now() };
}

export async function createAlert(ctx: FeatureContext, actorId: string, input: any) {
  if (!input || typeof input !== 'object') throw badRequest('Alert payload is required');
  const title = text(input.title);
  if (!title) throw badRequest('Alert title is required');
  const category = text(input.category);
  if (!CATEGORIES.includes(category)) throw badRequest(`Unknown alert category: ${category || '(missing)'}`);
  const severity = text(input.severity) || 'medium';
  if (!SEVERITIES.includes(severity)) throw badRequest(`Unknown alert severity: ${severity}`);
  const ownerRole = text(input.ownerRole) || 'organizer';
  const detail = text(input.detail) || null;

  // Alerts must not assert cheating from technical signals alone.
  if (category === 'match_integrity' && input.humanVerified !== true && /cheat/i.test(`${title} ${detail || ''}`)) {
    throw unprocessable(
      'A match-integrity alert may not assert cheating from technical signals alone; record it as an integrity incident pending human review',
    );
  }

  const thresholds = await getThresholds(ctx);
  const nowMs = Date.parse(ctx.now());
  let ackDueAt: string;
  if (input.ackDueAt != null && text(input.ackDueAt)) {
    const ms = Date.parse(String(input.ackDueAt));
    if (Number.isNaN(ms)) throw badRequest('ackDueAt must be an ISO date');
    ackDueAt = new Date(ms).toISOString();
  } else {
    ackDueAt = new Date(nowMs + thresholds[severity] * 60000).toISOString();
  }

  const escalationPath = Array.isArray(input.escalationPath) && input.escalationPath.length
    ? input.escalationPath.map((r: any) => String(r))
    : defaultEscalationPath(severity);

  const dedupeKey = (text(input.dedupeKey) || `${category}:${title.toLowerCase()}`).slice(0, 200);
  const sameKey = await ctx.repo.find(ALERT, { dedupeKey }, { orderBy: 'createdAt' });
  const existing = sameKey.find((a) => a.status !== 'resolved');
  if (existing) {
    const updated = await ctx.repo.update(ALERT, existing.id, {
      occurrenceCount: num(existing.occurrenceCount) + 1,
      lastSeenAt: ctx.now(),
      severity: SEVERITIES.indexOf(severity) > SEVERITIES.indexOf(existing.severity) ? severity : existing.severity,
    });
    await ctx.audit.record({
      action: 'alert.dedupe',
      actorId,
      targetType: 'alert',
      targetId: existing.id,
      detail: { dedupeKey, occurrenceCount: updated ? updated.occurrenceCount : null },
    });
    return { ...updated, deduplicated: true };
  }

  const row = await ctx.repo.insert(ALERT, {
    id: ctx.newId(),
    category,
    severity,
    title,
    detail,
    ownerRole,
    sensitive: !!input.sensitive,
    dedupeKey,
    escalationPath,
    escalationLevel: 0,
    escalatedTo: null,
    escalatedAt: null,
    ackDueAt,
    acknowledgedBy: null,
    acknowledgedAt: null,
    status: 'open',
    occurrenceCount: 1,
    lastSeenAt: ctx.now(),
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'alert.create',
    actorId,
    targetType: 'alert',
    targetId: row.id,
    detail: { category, severity, ownerRole },
  });
  return { ...row, deduplicated: false };
}

/** Sensitive security detail is restricted to holders of security.operations.manage. */
export function redactAlert(alert: Row, canSeeSensitive: boolean) {
  if (!alert) return alert;
  if (!alert.sensitive || canSeeSensitive) return alert;
  return { ...alert, detail: '[restricted]', resolutionNote: alert.resolutionNote ? '[restricted]' : null };
}

export async function getAlert(ctx: FeatureContext, id: string, canSeeSensitive: boolean) {
  const alert = await ctx.repo.get(ALERT, id);
  if (!alert) throw notFound('Alert not found');
  return redactAlert(alert, canSeeSensitive);
}

export async function listAlerts(ctx: FeatureContext, filter: any = {}, canSeeSensitive = false) {
  const where: Row = {};
  if (text(filter.severity)) where.severity = text(filter.severity);
  if (text(filter.status)) where.status = text(filter.status);
  if (text(filter.category)) where.category = text(filter.category);
  const rows = await ctx.repo.find(ALERT, where, { orderBy: 'createdAt', desc: true });
  return rows.map((a) => redactAlert(a, canSeeSensitive));
}

export async function acknowledgeAlert(ctx: FeatureContext, actorId: string, id: string) {
  const alert = await ctx.repo.get(ALERT, id);
  if (!alert) throw notFound('Alert not found');
  if (alert.status === 'resolved') throw conflict('A resolved alert cannot be acknowledged');
  if (alert.status === 'acknowledged') throw conflict('Alert is already acknowledged');
  const updated = await ctx.repo.update(ALERT, id, {
    status: 'acknowledged',
    acknowledgedBy: actorId,
    acknowledgedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'alert.acknowledge',
    actorId,
    targetType: 'alert',
    targetId: id,
    detail: { escalationLevel: alert.escalationLevel },
  });
  return updated;
}

export async function resolveAlert(ctx: FeatureContext, actorId: string, id: string, input: any) {
  const alert = await ctx.repo.get(ALERT, id);
  if (!alert) throw notFound('Alert not found');
  if (alert.status === 'resolved') throw conflict('Alert is already resolved');
  const note = text(input?.resolutionNote) || text(input?.note);
  if (alert.severity === 'critical' && !note) {
    throw unprocessable('Critical alerts require a resolution note before they can be closed');
  }
  const updated = await ctx.repo.update(ALERT, id, {
    status: 'resolved',
    resolvedBy: actorId,
    resolvedAt: ctx.now(),
    resolutionNote: note || null,
  });
  await ctx.audit.record({
    action: 'alert.resolve',
    actorId,
    targetType: 'alert',
    targetId: id,
    detail: { severity: alert.severity, hadNote: !!note },
  });
  return updated;
}

/** One escalation sweep: every unacknowledged alert past its due time climbs one rung. */
export async function escalateOverdue(ctx: FeatureContext, actorId: string) {
  const nowMs = Date.parse(ctx.now());
  const rows = await ctx.repo.find(ALERT, {}, { orderBy: 'createdAt' });
  const escalated: Row[] = [];
  for (const alert of rows) {
    if (alert.status !== 'open') continue;
    if (!alert.ackDueAt) continue;
    const dueMs = Date.parse(alert.ackDueAt);
    if (Number.isNaN(dueMs) || nowMs < dueMs) continue;
    const path = Array.isArray(alert.escalationPath) ? alert.escalationPath : defaultEscalationPath(alert.severity);
    const cap = escalationCap(path);
    const level = num(alert.escalationLevel);
    if (level >= cap) continue;
    const nextLevel = level + 1;
    const target = path[Math.min(nextLevel, path.length - 1)] || null;
    const updated = await ctx.repo.update(ALERT, alert.id, {
      escalationLevel: nextLevel,
      escalatedTo: target,
      escalatedAt: ctx.now(),
    });
    escalated.push(updated);
    await ctx.audit.record({
      action: 'alert.escalate',
      actorId,
      targetType: 'alert',
      targetId: alert.id,
      detail: { from: level, to: nextLevel, escalatedTo: target },
    });
  }
  return { escalatedCount: escalated.length, alerts: escalated };
}
