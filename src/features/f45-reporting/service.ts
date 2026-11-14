import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, forbidden } from '../../core/errors.js';
import { hasPermission } from '../../core/permissions.js';

/**
 * Feature 45 — Unified Institutional Performance & Reporting
 * Tables owned by this feature:
 *   report_exports   permission-checked, audited export history
 *
 * This feature only *reads* authoritative records owned by other modules
 * (`tournaments`, `tournament_registrations`, `users`, `finance_transactions`).
 * Every cross-module table read is wrapped in try/catch so a missing or failing
 * table degrades one metric instead of failing the whole report.
 *
 * Metric definitions and time periods are documented in METRIC_DEFINITIONS.
 * Person-level breakdowns are suppressed below SMALL_CELL_THRESHOLD so private
 * data cannot be inferred from small aggregates.
 */

export const EXPORTS = 'report_exports';

export const SMALL_CELL_THRESHOLD = 5;

export interface MetricDefinition {
  key: string;
  definition: string;
  source: string;
  period: string;
  personLevel: boolean;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: 'tournaments.total',
    definition: 'Count of tournament records in every state',
    source: 'tournaments',
    period: 'all time',
    personLevel: false,
  },
  {
    key: 'tournaments.active',
    definition: 'Tournaments currently open for registration or in progress',
    source: 'tournaments',
    period: 'current',
    personLevel: false,
  },
  {
    key: 'registrations.confirmed',
    definition: 'Confirmed tournament registrations (one per player per tournament)',
    source: 'tournament_registrations',
    period: 'all time',
    personLevel: false,
  },
  {
    key: 'members.active',
    definition: 'Member accounts whose state is active',
    source: 'users',
    period: 'current',
    personLevel: false,
  },
  {
    key: 'members.byRole',
    definition: 'Active members grouped by primary role; suppressed below 5 to prevent re-identification',
    source: 'users',
    period: 'current',
    personLevel: true,
  },
];

export const ACTIVE_TOURNAMENT_STATES = ['registration_open', 'in_progress', 'published'];

function errorMessage(e: any): string {
  return (e && e.message) || 'read failed';
}

/** Guarded table read: a failure yields no rows plus a limitation note. */
async function safeFind(
  ctx: FeatureContext,
  table: string,
  filter: Row = {},
): Promise<{ rows: Row[]; error: string | null }> {
  try {
    return { rows: await ctx.repo.find(table, filter), error: null };
  } catch (e: any) {
    return { rows: [], error: errorMessage(e) };
  }
}

async function safeCount(
  ctx: FeatureContext,
  table: string,
  filter: Row = {},
): Promise<{ value: number | null; error: string | null }> {
  try {
    return { value: await ctx.repo.count(table, filter), error: null };
  } catch (e: any) {
    return { value: null, error: errorMessage(e) };
  }
}

function suppress(count: number | null) {
  if (count == null) return { value: null, suppressed: false, available: false };
  if (count < SMALL_CELL_THRESHOLD) return { value: null, suppressed: true, available: true };
  return { value: count, suppressed: false, available: true };
}

function metric(def: MetricDefinition, value: number | null, extra: Row = {}) {
  return {
    key: def.key,
    definition: def.definition,
    source: def.source,
    period: def.period,
    value,
    available: value != null,
    ...extra,
  };
}

function def(key: string): MetricDefinition {
  const found = METRIC_DEFINITIONS.find((m) => m.key === key);
  if (!found) throw badRequest(`Unknown metric: ${key}`);
  return found;
}

/** Institutional summary across membership and tournament domains. */
export async function buildSummary(ctx: FeatureContext) {
  const limitations: string[] = [];

  const tournaments = await safeFind(ctx, 'tournaments');
  if (tournaments.error) limitations.push(`tournaments could not be read: ${tournaments.error}`);
  const registrations = await safeFind(ctx, 'tournament_registrations');
  if (registrations.error) {
    limitations.push(`tournament_registrations could not be read: ${registrations.error}`);
  }
  const users = await safeFind(ctx, 'users');
  if (users.error) limitations.push(`users could not be read: ${users.error}`);

  const totalTournaments = tournaments.error ? null : tournaments.rows.length;
  const activeTournaments = tournaments.error
    ? null
    : tournaments.rows.filter((t: Row) => ACTIVE_TOURNAMENT_STATES.includes(t.status)).length;
  const confirmedRegistrations = registrations.error
    ? null
    : registrations.rows.filter((r: Row) => r.status === 'confirmed').length;
  const activeMembers = users.error
    ? null
    : users.rows.filter((u: Row) => (u.state || 'active') === 'active').length;

  const byRole: Row[] = [];
  if (!users.error) {
    const groups = new Map<string, number>();
    for (const u of users.rows) {
      if ((u.state || 'active') !== 'active') continue;
      const roles: string[] = Array.isArray(u.roles) && u.roles.length ? u.roles : ['member'];
      const primary = roles[0];
      groups.set(primary, (groups.get(primary) || 0) + 1);
    }
    for (const [role, count] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const s = suppress(count);
      byRole.push({ role, count: s.value, suppressed: s.suppressed, available: s.available });
    }
    if (byRole.some((r) => r.suppressed)) {
      limitations.push(
        `Person-level counts below ${SMALL_CELL_THRESHOLD} are suppressed to prevent re-identification`,
      );
    }
  }

  const metrics = [
    metric(def('tournaments.total'), totalTournaments),
    metric(def('tournaments.active'), activeTournaments),
    metric(def('registrations.confirmed'), confirmedRegistrations),
    metric(def('members.active'), activeMembers),
    {
      ...metric(def('members.byRole'), users.error ? null : activeMembers),
      breakdown: byRole,
      smallCellThreshold: SMALL_CELL_THRESHOLD,
    },
  ];

  return {
    generatedAt: ctx.now(),
    dataFreshness: { asOf: ctx.now(), mode: 'live module records', cached: false },
    metrics,
    limitations,
    note: 'Counts come from authoritative module records; no paid analytics dependency is used.',
  };
}

/** Tournament participation report. */
export async function tournamentReport(ctx: FeatureContext) {
  const limitations: string[] = [];
  const tournaments = await safeFind(ctx, 'tournaments');
  if (tournaments.error) limitations.push(`tournaments could not be read: ${tournaments.error}`);
  const registrations = await safeFind(ctx, 'tournament_registrations');
  if (registrations.error) {
    limitations.push(`tournament_registrations could not be read: ${registrations.error}`);
  }

  const rows = tournaments.rows.map((t: Row) => {
    const mine = registrations.rows.filter((r: Row) => r.tournamentId === t.id);
    const confirmed = mine.filter((r: Row) => r.status === 'confirmed').length;
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      capacity: t.capacity ?? null,
      confirmedRegistrations: confirmed,
      waitlisted: mine.filter((r: Row) => r.status === 'waitlisted').length,
      // fill rate is a rate over an event, not a person-level aggregate
      fillRate: t.capacity ? Math.round((confirmed / Number(t.capacity)) * 100) / 100 : null,
    };
  });

  return {
    generatedAt: ctx.now(),
    dataFreshness: { asOf: ctx.now(), mode: 'live module records', cached: false },
    definition: {
      key: 'tournaments.participation',
      definition: 'Confirmed registrations per tournament, plus waitlist depth and fill rate',
      source: 'tournaments + tournament_registrations',
      period: 'all time',
    },
    totals: {
      tournaments: tournaments.error ? null : rows.length,
      confirmedRegistrations: registrations.error
        ? null
        : registrations.rows.filter((r: Row) => r.status === 'confirmed').length,
    },
    rows,
    limitations,
  };
}

/** Restricted finance report — only for holders of `finance.read`. */
export async function financeReport(ctx: FeatureContext) {
  const limitations: string[] = [];
  const transactions = await safeFind(ctx, 'finance_transactions');
  if (transactions.error) limitations.push(`finance_transactions could not be read: ${transactions.error}`);
  const ledgerCount = await safeCount(ctx, 'finance_transactions');
  if (ledgerCount.error) limitations.push(`finance_transactions count failed: ${ledgerCount.error}`);

  return {
    restricted: true,
    generatedAt: ctx.now(),
    dataFreshness: { asOf: ctx.now(), mode: 'live module records', cached: false },
    definition: {
      key: 'finance.ledger',
      definition: 'Count of finance ledger entries recorded by the finance module',
      source: 'finance_transactions',
      period: 'all time',
    },
    metrics: [
      {
        key: 'finance.ledger.entries',
        definition: 'Count of finance ledger entries',
        source: 'finance_transactions',
        period: 'all time',
        value: ledgerCount.value,
        available: ledgerCount.value != null,
      },
    ],
    limitations,
    note: 'Finance reports are restricted and must not be published as public aggregates.',
  };
}

export const EXPORTABLE_REPORTS = ['summary', 'tournaments', 'finance'];

export async function createExport(
  ctx: FeatureContext,
  actorId: string,
  input: Row = {},
  permissions: string[] = [],
): Promise<Row> {
  const reportKey = input.reportKey || 'summary';
  if (!EXPORTABLE_REPORTS.includes(reportKey)) {
    throw badRequest(`reportKey must be one of ${EXPORTABLE_REPORTS.join(', ')}`);
  }
  const sessionLike = { userId: actorId, roles: [], permissions } as any;
  if (reportKey === 'finance' && !hasPermission(sessionLike, 'finance.read')) {
    throw forbidden('Finance reports are restricted to holders of finance.read');
  }
  const report = reportKey === 'tournaments'
    ? await tournamentReport(ctx)
    : reportKey === 'finance'
      ? await financeReport(ctx)
      : await buildSummary(ctx);
  const rowCount = reportKey === 'tournaments'
    ? ((report as any).rows?.length ?? 0)
    : ((report as any).metrics?.length ?? 0);
  const row = await ctx.repo.insert(EXPORTS, {
    id: ctx.newId(),
    reportKey,
    requestedBy: actorId,
    generatedAt: ctx.now(),
    status: 'generated',
    rowCount,
    format: input.format || 'json',
    limitations: (report as any).limitations || [],
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'reporting.export.create',
    actorId,
    targetType: 'report_export',
    targetId: row.id,
    detail: { reportKey, rowCount, format: row.format },
  });
  return row;
}

export async function listExports(ctx: FeatureContext, filter: Row = {}): Promise<Row[]> {
  const q: Row = {};
  if (filter.reportKey) q.reportKey = filter.reportKey;
  return ctx.repo.find(EXPORTS, q, { orderBy: 'generatedAt', desc: true });
}

export function catalogue() {
  return {
    metrics: METRIC_DEFINITIONS,
    exports: EXPORTABLE_REPORTS,
    smallCellThreshold: SMALL_CELL_THRESHOLD,
    note: 'Every metric documents its definition, source table and time period.',
  };
}
