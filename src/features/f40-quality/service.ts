import type { FeatureContext, Session, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { hasPermission } from '../../core/permissions.js';

/**
 * Feature 40 — Performance, Reliability & Quality Assurance
 *
 * Tables
 *  - qa_performance_budgets  budget per critical user journey (p95 ms, error-rate ceiling)
 *  - qa_test_runs            a recorded test/QA run with pass/fail/skip counts
 *  - qa_release_gates        release decisions; refused while any recorded run has failures
 *  - qa_metrics              minimized telemetry samples (no personal data, no secrets)
 *  - qa_incidents            defect / incident tracking
 *
 * Telemetry is minimized: payloads containing personal data or secrets are rejected, and load
 * tests are only recorded against our own platform, never against provider free tiers.
 */

export const BUDGETS = 'qa_performance_budgets';
export const RUNS = 'qa_test_runs';
export const GATES = 'qa_release_gates';
export const METRICS = 'qa_metrics';
export const INCIDENTS = 'qa_incidents';

export const CRITICAL_FLOWS = [
  'login',
  'tournament_registration',
  'match_result_submit',
  'leaderboard',
  'arena_move',
  'notice_read',
];

export const SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'];
const PERSONAL_DATA = /(@|email|phone|mobile|address|dob|password|secret|token|bearer|messagebody|chatcontent|fullname)/i;

function assertCount(value: any, field: string) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw badRequest(`${field} must be a non-negative integer`);
  return n;
}

/* --------------------------------------------------------------- budgets */

export async function createBudget(ctx: FeatureContext, actorId: string, input: any = {}) {
  const flow = input.flow;
  if (!CRITICAL_FLOWS.includes(flow)) throw badRequest(`flow must be one of ${CRITICAL_FLOWS.join(', ')}`);
  const p95Ms = Number(input.p95Ms);
  if (!Number.isFinite(p95Ms) || p95Ms <= 0 || p95Ms > 30000) throw badRequest('p95Ms must be between 1 and 30000');
  const errorRatePct = input.errorRatePct === undefined ? 1 : Number(input.errorRatePct);
  if (!Number.isFinite(errorRatePct) || errorRatePct < 0 || errorRatePct > 100) {
    throw unprocessable('errorRatePct must be between 0 and 100');
  }

  const existing = await ctx.repo.findOne(BUDGETS, { flow });
  if (existing) throw conflict(`A performance budget already exists for ${flow}`);

  const row = await ctx.repo.insert(BUDGETS, {
    id: ctx.newId(),
    flow,
    p95Ms,
    errorRatePct,
    notes: input.notes ?? null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'qa.budget.create', actorId, targetType: 'performance_budget', targetId: row.id, detail: { flow, p95Ms } });
  return row;
}

export async function listBudgets(ctx: FeatureContext) {
  return ctx.repo.find(BUDGETS, {}, { orderBy: 'flow' });
}

/* -------------------------------------------------------------- test runs */

export async function recordTestRun(ctx: FeatureContext, actorId: string, input: any = {}) {
  const suite = typeof input.suite === 'string' ? input.suite.trim() : '';
  if (!suite) throw badRequest('suite is required');
  const passed = assertCount(input.passed, 'passed');
  const failed = assertCount(input.failed, 'failed');
  const skipped = assertCount(input.skipped, 'skipped');
  if (passed + failed === 0) throw badRequest('a test run must record at least one executed test');

  const accessibility = input.accessibility || {};
  const violations = assertCount(accessibility.violations, 'accessibility.violations');
  const devices = Array.isArray(input.devices) ? input.devices : [];

  const row = await ctx.repo.insert(RUNS, {
    id: ctx.newId(),
    suite,
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    durationMs: Number(input.durationMs ?? 0) || 0,
    accessibility: { checked: !!accessibility.checked, violations },
    devices,
    loadTest: input.loadTest === true,
    providerCompliant: input.loadTest === true ? input.providerCompliant !== false : true,
    status: failed > 0 ? 'failed' : 'passed',
    runBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'qa.testrun.record',
    actorId,
    targetType: 'test_run',
    targetId: row.id,
    detail: { suite, passed, failed, skipped },
  });
  return row;
}

export async function getTestRun(ctx: FeatureContext, id: string) {
  const row = await ctx.repo.get(RUNS, id);
  if (!row) throw notFound('Test run not found');
  return row;
}

export async function listTestRuns(ctx: FeatureContext) {
  return ctx.repo.find(RUNS, {}, { orderBy: 'createdAt', desc: true });
}

/* ----------------------------------------------------------- release gates */

/** A failed release check blocks deployment: no gate passes while any run has failures. */
export async function evaluateReleaseGate(ctx: FeatureContext, actorId: string, input: any = {}) {
  const version = typeof input.version === 'string' ? input.version.trim() : '';
  if (!version) throw badRequest('version is required');

  const ids: string[] = Array.isArray(input.testRunIds) ? input.testRunIds : [];
  if (ids.length === 0) throw badRequest('testRunIds must list at least one recorded test run');

  const runs: Row[] = [];
  for (const id of ids) {
    const run = await ctx.repo.get(RUNS, id);
    if (!run) throw notFound(`Test run ${id} not found`);
    runs.push(run);
  }

  const totalPassed = runs.reduce((acc, r) => acc + Number(r.passed ?? 0), 0);
  const totalFailed = runs.reduce((acc, r) => acc + Number(r.failed ?? 0), 0);
  const accessibilityViolations = runs.reduce((acc, r) => acc + Number(r.accessibility?.violations ?? 0), 0);

  const blockers: string[] = [];
  if (totalFailed > 0) blockers.push(`${totalFailed} failing test(s)`);
  if (accessibilityViolations > 0) blockers.push(`${accessibilityViolations} accessibility violation(s)`);

  if (blockers.length) {
    await ctx.repo.insert(GATES, {
      id: ctx.newId(),
      version,
      status: 'blocked',
      blockers,
      totalPassed,
      totalFailed,
      accessibilityViolations,
      testRunIds: ids,
      evaluatedBy: actorId,
      createdAt: ctx.now(),
    });
    await ctx.audit.record({
      action: 'qa.release.blocked',
      actorId,
      targetType: 'release_gate',
      targetId: version,
      detail: { blockers, totalFailed },
    });
    throw conflict(`Release ${version} blocked: ${blockers.join(', ')}`, {
      blockers,
      totalPassed,
      totalFailed,
      accessibilityViolations,
    });
  }

  const row = await ctx.repo.insert(GATES, {
    id: ctx.newId(),
    version,
    status: 'passed',
    blockers: [],
    totalPassed,
    totalFailed,
    accessibilityViolations,
    testRunIds: ids,
    evaluatedBy: actorId,
    releasedAt: ctx.now(),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'qa.release.pass',
    actorId,
    targetType: 'release_gate',
    targetId: row.id,
    detail: { version, totalPassed },
  });
  return row;
}

export async function listGates(ctx: FeatureContext) {
  return ctx.repo.find(GATES, {}, { orderBy: 'createdAt', desc: true });
}

/* --------------------------------------------------------------- metrics */

/** Monitoring must minimize personal data: anything that looks personal or secret is refused. */
export async function recordMetric(ctx: FeatureContext, actorId: string, input: any = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw badRequest('name is required');
  if (PERSONAL_DATA.test(name)) throw badRequest('Metric names must not contain personal data');
  if (input.tags !== undefined) {
    const tags = JSON.stringify(input.tags);
    if (PERSONAL_DATA.test(tags)) throw badRequest('Telemetry must not contain personal data or secrets');
  }
  if (typeof input.detail === 'string' && PERSONAL_DATA.test(input.detail)) {
    throw badRequest('Telemetry must not contain personal data or secrets');
  }
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) throw badRequest('value must be a non-negative number');

  const row = await ctx.repo.insert(METRICS, {
    id: ctx.newId(),
    name,
    value,
    unit: input.unit || 'ms',
    kind: input.kind || 'gauge',
    route: input.route ?? null,
    recordedBy: actorId,
    createdAt: ctx.now(),
  });
  return row;
}

export async function summary(ctx: FeatureContext) {
  const metrics = await ctx.repo.find(METRICS, {}, { orderBy: 'createdAt', desc: true });
  const latency = metrics.filter((m) => /latency|p95|response_time/i.test(m.name));
  const errors = metrics.filter((m) => /error/i.test(m.name));
  const avg = (rows: Row[]) => (rows.length ? Math.round(rows.reduce((a, r) => a + Number(r.value ?? 0), 0) / rows.length) : 0);
  const budgets = await ctx.repo.find(BUDGETS, {});
  const incidents = await ctx.repo.find(INCIDENTS, {});
  return {
    samples: metrics.length,
    avgLatencyMs: avg(latency),
    avgErrorRatePct: avg(errors),
    budgetsDefined: budgets.length,
    openIncidents: incidents.filter((i) => i.status === 'open').length,
    generatedAt: ctx.now(),
  };
}

/* ------------------------------------------------------------- incidents */

export async function openIncident(ctx: FeatureContext, actorId: string, input: any = {}) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw badRequest('title is required');
  const severity = input.severity || 'sev3';
  if (!SEVERITIES.includes(severity)) throw badRequest(`severity must be one of ${SEVERITIES.join(', ')}`);

  const row = await ctx.repo.insert(INCIDENTS, {
    id: ctx.newId(),
    title,
    severity,
    detail: input.detail ?? null,
    status: 'open',
    openedBy: actorId,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'qa.incident.open', actorId, targetType: 'incident', targetId: row.id, detail: { severity } });
  return row;
}

export async function resolveIncident(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(INCIDENTS, id);
  if (!row) throw notFound('Incident not found');
  if (row.status === 'resolved') throw conflict('Incident is already resolved');
  const updated = await ctx.repo.update(INCIDENTS, id, {
    status: 'resolved',
    resolution: input.resolution ?? null,
    resolvedBy: actorId,
    resolvedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'qa.incident.resolve', actorId, targetType: 'incident', targetId: id });
  return updated;
}

export async function listIncidents(ctx: FeatureContext, filter: { status?: string } = {}) {
  return ctx.repo.find(INCIDENTS, filter.status ? { status: filter.status } : {}, { orderBy: 'createdAt', desc: true });
}

/** Guard used by other features before a load test: never load-test a provider past its quota. */
export async function assertLoadTestCompliant(ctx: FeatureContext, session: Session, input: any = {}) {
  if (!hasPermission(session, 'qa.manage')) throw forbidden('Requires permission: qa.manage');
  if (input.targetsThirdParty === true && input.providerQuotaConfirmed !== true) {
    throw unprocessable('Load tests must not exceed a provider free quota; confirm the provider terms first');
  }
  return { compliant: true };
}
