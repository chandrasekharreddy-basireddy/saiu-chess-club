import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors.js';

/**
 * Feature 42 — Cybersecurity & Security Operations
 * Tables owned by this feature:
 *   security_incidents             incident register (severity, containment status, timeline)
 *   security_alerts                detection alerts (severity + owner), incl. Blocked Mode signals
 *   security_vulnerabilities       dependency / application vulnerability remediation tracker
 *   security_privileged_reviews    privileged account review cycles
 *   security_secret_rotations      secret rotation log (names + timestamps only, never values)
 *
 * Restrictions baked in: security telemetry is only readable with `security.operations.manage`;
 * a technical Blocked Mode signal is advisory and is never treated as proof of cheating; secret
 * values are rejected rather than stored.
 */

export const INCIDENTS = 'security_incidents';
export const ALERTS = 'security_alerts';
export const VULNS = 'security_vulnerabilities';
export const PRIV_REVIEWS = 'security_privileged_reviews';
export const SECRET_ROTATIONS = 'security_secret_rotations';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const INCIDENT_SEQUENCE = [
  'detected', 'triaged', 'classified', 'contained', 'evidence_preserved',
  'investigating', 'recovered', 'notified', 'reviewed', 'closed',
];

/** The only forward transition is to the next state in the workflow, plus reviewed -> closed. */
function nextStates(status: string): string[] {
  const i = INCIDENT_SEQUENCE.indexOf(status);
  if (i < 0) return [];
  const next = INCIDENT_SEQUENCE[i + 1];
  if (!next) return [];
  if (next === 'notified') return ['notified', 'closed'];
  return [next];
}

function requireSeverity(value: any) {
  const severity = value || 'medium';
  if (!SEVERITIES.includes(severity)) throw badRequest(`severity must be one of ${SEVERITIES.join(', ')}`);
  return severity;
}

// --------------------------------------------------------------- incidents ---

export async function openIncident(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.title?.trim()) throw badRequest('Incident title is required');
  const severity = requireSeverity(input.severity);
  if (!input.ownerId?.trim()) throw badRequest('Every security incident must have an owner');
  const row = await ctx.repo.insert(INCIDENTS, {
    id: ctx.newId(),
    title: input.title.trim(),
    severity,
    category: input.category || 'unclassified',
    ownerId: input.ownerId.trim(),
    status: 'detected',
    containmentStatus: 'not_contained',
    evidenceRefs: [],
    timeline: [{ status: 'detected', at: ctx.now(), by: actorId, note: input.note ?? null }],
    lessons: null,
    detectedAt: ctx.now(),
    containedAt: null,
    closedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'security.incident.open',
    actorId,
    targetType: 'security_incident',
    targetId: row.id,
    detail: { severity, ownerId: row.ownerId },
  });
  return row;
}

export async function transitionIncident(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  next: string,
  input: Row = {},
): Promise<Row> {
  const row = await ctx.repo.get(INCIDENTS, id);
  if (!row) throw notFound('Security incident not found');
  const allowed = nextStates(row.status);
  if (!allowed.includes(next)) {
    throw conflict(`Cannot move a security incident from ${row.status} to ${next}`, { allowed });
  }
  if (next === 'evidence_preserved') {
    const refs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs.filter((r: any) => !!r) : [];
    if (!refs.length) {
      throw unprocessable('At least one evidence reference is required before evidence can be recorded as preserved');
    }
  }
  if (next === 'reviewed' && !input.lessons?.trim()) {
    throw unprocessable('A post-incident review must record lessons learned');
  }

  const patch: Row = {
    status: next,
    timeline: [
      ...(row.timeline || []),
      { status: next, at: ctx.now(), by: actorId, note: input.note ?? null },
    ],
  };
  if (next === 'contained') {
    patch.containmentStatus = 'contained';
    patch.containedAt = ctx.now();
  }
  if (next === 'evidence_preserved') {
    patch.evidenceRefs = [...(row.evidenceRefs || []), ...(input.evidenceRefs || [])];
  }
  if (next === 'reviewed') {
    patch.lessons = input.lessons.trim();
  }
  if (next === 'closed') {
    patch.closedAt = ctx.now();
    patch.containmentStatus = row.containmentStatus === 'contained' ? 'contained' : 'not_contained';
  }
  const updated = await ctx.repo.update(INCIDENTS, id, patch);
  await ctx.audit.record({
    action: `security.incident.${next}`,
    actorId,
    targetType: 'security_incident',
    targetId: id,
    detail: { severity: row.severity, containmentStatus: (updated as Row).containmentStatus },
  });
  return updated as Row;
}

export async function getIncident(ctx: FeatureContext, id: string): Promise<Row> {
  const row = await ctx.repo.get(INCIDENTS, id);
  if (!row) throw notFound('Security incident not found');
  return row;
}

export async function listIncidents(ctx: FeatureContext, filter: Row = {}) {
  const q: Row = {};
  if (filter.status) q.status = filter.status;
  if (filter.severity) q.severity = filter.severity;
  if (filter.containmentStatus) q.containmentStatus = filter.containmentStatus;
  const limit = Number(filter.limit) > 0 ? Number(filter.limit) : 50;
  const offset = Number(filter.offset) > 0 ? Number(filter.offset) : 0;
  const all = await ctx.repo.find(INCIDENTS, q, { orderBy: 'createdAt', desc: true });
  return { items: all.slice(offset, offset + limit), total: all.length, limit, offset };
}

// ------------------------------------------------------------------ alerts ---

export async function raiseAlert(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.title?.trim()) throw badRequest('Alert title is required');
  const severity = requireSeverity(input.severity);
  if (!input.ownerId?.trim()) throw badRequest('Every security alert must have an owner');
  const signal = input.signal || 'generic';
  // A technical Blocked Mode signal is telemetry, never a finding of misconduct.
  const advisoryOnly = signal === 'technical_blocked_mode';
  const row = await ctx.repo.insert(ALERTS, {
    id: ctx.newId(),
    title: input.title.trim(),
    signal,
    severity,
    ownerId: input.ownerId.trim(),
    status: 'open',
    advisoryOnly,
    conclusiveCheating: false,
    requiresHumanReview: advisoryOnly,
    raisedBy: actorId,
    raisedAt: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'security.alert.raise',
    actorId,
    targetType: 'security_alert',
    targetId: row.id,
    detail: { severity, signal, advisoryOnly },
  });
  return row;
}

export async function escalateAlert(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: Row = {},
): Promise<Row> {
  const alert = await ctx.repo.get(ALERTS, id);
  if (!alert) throw notFound('Security alert not found');
  if (alert.status !== 'open') throw conflict(`Alert is already ${alert.status}`);
  if (alert.advisoryOnly && input.conclusiveCheating) {
    throw badRequest(
      'A technical Blocked Mode signal is not proof of cheating; escalate for human review without a conclusive finding',
    );
  }
  const incident = await ctx.repo.insert(INCIDENTS, {
    id: ctx.newId(),
    title: input.title?.trim() || `Review of alert: ${alert.title}`,
    severity: alert.severity,
    category: input.category || 'integrity_review',
    ownerId: input.ownerId?.trim() || alert.ownerId,
    status: 'detected',
    containmentStatus: 'not_contained',
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
    timeline: [{ status: 'detected', at: ctx.now(), by: actorId, note: `raised from alert ${alert.id}` }],
    lessons: null,
    sourceAlertId: alert.id,
    advisoryOnly: !!alert.advisoryOnly,
    detectedAt: ctx.now(),
    containedAt: null,
    closedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.repo.update(ALERTS, id, { status: 'escalated', escalatedAt: ctx.now(), incidentId: incident.id });
  await ctx.audit.record({
    action: 'security.alert.escalate',
    actorId,
    targetType: 'security_alert',
    targetId: id,
    detail: { incidentId: incident.id, advisoryOnly: !!alert.advisoryOnly },
  });
  return { alert: { ...alert, status: 'escalated', incidentId: incident.id }, incident };
}

// --------------------------------------------------------- vulnerabilities ---

export async function registerVulnerability(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.component?.trim()) throw badRequest('component is required');
  if (!input?.advisoryRef?.trim()) throw badRequest('advisoryRef (dependency or advisory reference) is required');
  const severity = requireSeverity(input.severity);
  const row = await ctx.repo.insert(VULNS, {
    id: ctx.newId(),
    component: input.component.trim(),
    advisoryRef: input.advisoryRef.trim(),
    severity,
    status: 'open',
    ownerId: input.ownerId?.trim() || actorId,
    remediationRef: null,
    remediatedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'security.vulnerability.register',
    actorId,
    targetType: 'security_vulnerability',
    targetId: row.id,
    detail: { severity, component: row.component },
  });
  return row;
}

export async function remediateVulnerability(
  ctx: FeatureContext,
  actorId: string,
  id: string,
  input: Row = {},
): Promise<Row> {
  const row = await ctx.repo.get(VULNS, id);
  if (!row) throw notFound('Vulnerability not found');
  if (row.status === 'remediated') throw conflict('Vulnerability is already remediated');
  if (!input.remediationRef?.trim()) throw badRequest('A remediation reference is required to close a vulnerability');
  const updated = await ctx.repo.update(VULNS, id, {
    status: 'remediated',
    remediationRef: input.remediationRef.trim(),
    remediatedBy: actorId,
    remediatedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'security.vulnerability.remediate',
    actorId,
    targetType: 'security_vulnerability',
    targetId: id,
  });
  return updated as Row;
}

export async function listVulnerabilities(ctx: FeatureContext, filter: Row = {}): Promise<Row[]> {
  const q: Row = {};
  if (filter.status) q.status = filter.status;
  if (filter.severity) q.severity = filter.severity;
  return ctx.repo.find(VULNS, q, { orderBy: 'createdAt', desc: true });
}

// ------------------------------------------------------ privileged access ---

export async function recordPrivilegedReview(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.accountId?.trim()) throw badRequest('accountId is required');
  const outcome = input.outcome || 'retained';
  if (!['retained', 'reduced', 'revoked'].includes(outcome)) {
    throw badRequest('outcome must be retained, reduced or revoked');
  }
  const row = await ctx.repo.insert(PRIV_REVIEWS, {
    id: ctx.newId(),
    accountId: input.accountId.trim(),
    outcome,
    notes: input.notes ?? null,
    reviewedBy: actorId,
    reviewedAt: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'security.privileged_access.review',
    actorId,
    targetType: 'privileged_review',
    targetId: row.id,
    detail: { accountId: row.accountId, outcome },
  });
  return row;
}

export async function listPrivilegedReviews(ctx: FeatureContext): Promise<Row[]> {
  return ctx.repo.find(PRIV_REVIEWS, {}, { orderBy: 'reviewedAt', desc: true });
}

// --------------------------------------------------------- secret rotation ---

export async function rotateSecret(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.name?.trim()) throw badRequest('name of the secret to rotate is required');
  if (input.value != null) {
    throw badRequest('Secret values must never be submitted to or stored by the platform; rotate at the provider');
  }
  const prior = await ctx.repo.findOne(SECRET_ROTATIONS, { name: input.name.trim() });
  const row = await ctx.repo.insert(SECRET_ROTATIONS, {
    id: ctx.newId(),
    name: input.name.trim(),
    reason: input.reason ?? null,
    rotatedBy: actorId,
    rotatedAt: ctx.now(),
    previousRotatedAt: prior ? prior.rotatedAt : null,
    storedValue: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'security.secret.rotate',
    actorId,
    targetType: 'secret',
    targetId: row.id,
    detail: { name: row.name },
  });
  return row;
}

export async function listSecretRotations(ctx: FeatureContext): Promise<Row[]> {
  return ctx.repo.find(SECRET_ROTATIONS, {}, { orderBy: 'rotatedAt', desc: true });
}

// ------------------------------------------------------- audit log review ---

export async function recordAuditLogReview(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
): Promise<Row> {
  if (!input?.period?.trim()) throw badRequest('period (e.g. 2026-01) is required');
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const row = await ctx.repo.insert('security_audit_reviews', {
    id: ctx.newId(),
    period: input.period.trim(),
    findings,
    findingCount: findings.length,
    reviewedBy: actorId,
    reviewedAt: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'security.audit_log.review',
    actorId,
    targetType: 'audit_review',
    targetId: row.id,
    detail: { period: row.period, findingCount: findings.length },
  });
  return row;
}
