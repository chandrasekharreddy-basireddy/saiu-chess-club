import type { FeatureContext, Session, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable, quotaExceeded } from '../../core/errors.js';
import { hasPermission } from '../../core/permissions.js';

/**
 * Feature 37 — Digital Services & External Integrations
 *
 * Tables
 *  - integration_registry      one row per approved third-party service (provider, purpose, owner,
 *                              data scope, credential *reference* only, quota limit, usage counter,
 *                              enablement, health, failure policy, migration path)
 *  - integration_usage_events  append-only usage ledger (the free-quota meter)
 *  - integration_health_checks append-only health history
 *
 * ₹0 policy: every integration carries a `freeQuotaLimit`; usage beyond it raises 429 and paid
 * usage can never be enabled. Payment integrations are excluded by category and by provider.
 * Secrets are never stored or returned — only a credential reference.
 */

export const REGISTRY = 'integration_registry';
export const USAGE = 'integration_usage_events';
export const HEALTH = 'integration_health_checks';

/** Approved catalogue (spec §"In-scope integration categories"). */
export const PROVIDERS: Array<{ provider: string; category: string; freeQuotaLimit: number; quotaUnit: string }> = [
  { provider: 'brevo', category: 'email', freeQuotaLimit: 300, quotaUnit: 'email/day' },
  { provider: 'google_calendar', category: 'calendar', freeQuotaLimit: 1000, quotaUnit: 'api-call/day' },
  { provider: 'video_meeting', category: 'video', freeQuotaLimit: 100, quotaUnit: 'meeting-hour/month' },
  { provider: 'google_docs', category: 'documents', freeQuotaLimit: 500, quotaUnit: 'api-call/day' },
  { provider: 'university_directory', category: 'verification', freeQuotaLimit: 200, quotaUnit: 'lookup/day' },
  { provider: 'sarvam_ai', category: 'ai', freeQuotaLimit: 100, quotaUnit: 'credit-inr' },
  { provider: 'lichess', category: 'chess_platform', freeQuotaLimit: 500, quotaUnit: 'api-call/day' },
  { provider: 'chess_com', category: 'chess_platform', freeQuotaLimit: 300, quotaUnit: 'api-call/day' },
];

export const CATEGORIES = ['email', 'calendar', 'video', 'documents', 'verification', 'ai', 'chess_platform'];
/** Payment integrations are out of scope for this platform. */
export const EXCLUDED_CATEGORIES = ['payment', 'payments', 'billing', 'payments_gateway'];
export const HEALTH_STATES = ['unknown', 'healthy', 'degraded', 'down'];

const SECRET_KEY = /secret|password|apikey|api_key|token|bearer|private_key/i;

/** Never leak a credential value: strip anything secret-shaped, keep the reference. */
export function publicView(row: Row) {
  const out: Row = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function quotaView(row: Row) {
  const limit = Number(row.freeQuotaLimit ?? 0);
  const used = Number(row.usageCount ?? 0);
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    unit: row.quotaUnit ?? 'request',
    percentUsed: limit > 0 ? Math.round((used / limit) * 100) : 100,
  };
}

function withQuota(row: Row) {
  return { ...publicView(row), quota: quotaView(row) };
}

export async function listProviders() {
  return { providers: PROVIDERS, categories: CATEGORIES, excludedCategories: EXCLUDED_CATEGORIES };
}

export async function listIntegrations(ctx: FeatureContext, filter: { enabled?: boolean; category?: string } = {}) {
  const rows = await ctx.repo.find(REGISTRY, {}, { orderBy: 'createdAt', desc: true });
  const items = rows
    .filter((r) => (filter.enabled === undefined ? true : !!r.enabled === filter.enabled))
    .filter((r) => (filter.category ? r.category === filter.category : true))
    .map(withQuota);
  return items;
}

export async function getIntegration(ctx: FeatureContext, id: string) {
  const row = await ctx.repo.get(REGISTRY, id);
  if (!row) throw notFound('Integration not found');
  return withQuota(row);
}

export async function registerIntegration(ctx: FeatureContext, actor: Session, input: any = {}) {
  const provider = typeof input.provider === 'string' ? input.provider.trim() : '';
  if (!provider) throw badRequest('provider is required');

  const known = PROVIDERS.find((p) => p.provider === provider);
  if (!known) throw unprocessable(`Provider "${provider}" is not on the approved integration list`);

  const category = input.category || known.category;
  if (EXCLUDED_CATEGORIES.includes(String(category).toLowerCase())) {
    throw badRequest('Payment integrations are excluded from this platform');
  }
  if (!CATEGORIES.includes(category)) throw unprocessable(`category must be one of ${CATEGORIES.join(', ')}`);
  if (input.paidPlan === true) throw badRequest('Paid plans are not permitted: integrations must run inside their free tier');

  // secrets must never be stored here
  for (const key of Object.keys(input || {})) {
    if (SECRET_KEY.test(key)) {
      throw badRequest('Secrets must never be stored in the integration registry; store a credential reference instead');
    }
  }
  const credentialRef = input.credentialRef ?? null;
  if (credentialRef && SECRET_KEY.test(String(credentialRef))) {
    throw badRequest('credentialRef must be a reference (e.g. "vault://brevo/prod"), not a secret value');
  }

  const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
  if (!purpose) throw badRequest('purpose is required: every integration must declare why it exists');

  const ownerId = input.ownerId || actor.userId;
  if (!ownerId) throw badRequest('ownerId is required: every integration must have an owner');

  const freeQuotaLimit = input.freeQuotaLimit === undefined ? known.freeQuotaLimit : Number(input.freeQuotaLimit);
  if (!Number.isFinite(freeQuotaLimit) || freeQuotaLimit <= 0) throw badRequest('freeQuotaLimit must be a positive number');

  const currencyBudgetInr = input.currencyBudgetInr === undefined ? null : Number(input.currencyBudgetInr);
  if (currencyBudgetInr !== null && (!Number.isFinite(currencyBudgetInr) || currencyBudgetInr < 0)) {
    throw badRequest('currencyBudgetInr must be a non-negative number');
  }
  if (currencyBudgetInr !== null && currencyBudgetInr > 100) {
    throw unprocessable('No-charge safeguard: a currency budget above ₹100 is not permitted (Sarvam AI free credits are ₹100)');
  }

  const row = await ctx.repo.insert(REGISTRY, {
    id: ctx.newId(),
    provider,
    category,
    purpose,
    ownerId,
    dataScope: Array.isArray(input.dataScope) ? input.dataScope : [],
    credentialRef,
    permissionScopes: Array.isArray(input.permissionScopes) ? input.permissionScopes : [],
    freeQuotaLimit,
    quotaUnit: input.quotaUnit || known.quotaUnit,
    currencyBudgetInr,
    usageCount: 0,
    enabled: false, // integrations are disabled until configured and approved
    healthStatus: 'unknown',
    failurePolicy: input.failurePolicy || 'isolate: failures never block unrelated core features',
    migrationPath: input.migrationPath || null,
    termsReviewed: false,
    termsReviewedBy: null,
    termsReviewedAt: null,
    lastVerifiedAt: null,
    createdBy: actor.userId,
    createdAt: ctx.now(),
  });

  await ctx.audit.record({
    action: 'integration.register',
    actorId: actor.userId,
    targetType: 'integration',
    targetId: row.id,
    detail: { provider, category, freeQuotaLimit },
  });
  return withQuota(row);
}

export async function reviewTerms(ctx: FeatureContext, actor: Session, id: string, input: any = {}) {
  const row = await ctx.repo.get(REGISTRY, id);
  if (!row) throw notFound('Integration not found');
  if (input.termsReviewed !== true) {
    throw badRequest('termsReviewed must be true: free-tier terms and quotas are reviewed before activation');
  }
  const updated = await ctx.repo.update(REGISTRY, id, {
    termsReviewed: true,
    termsReviewedBy: actor.userId,
    termsReviewedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'integration.terms.review',
    actorId: actor.userId,
    targetType: 'integration',
    targetId: id,
    detail: { provider: row.provider },
  });
  return withQuota(updated as Row);
}

export async function setEnabled(ctx: FeatureContext, actor: Session, id: string, enable: boolean) {
  const row = await ctx.repo.get(REGISTRY, id);
  if (!row) throw notFound('Integration not found');

  if (enable) {
    if (EXCLUDED_CATEGORIES.includes(String(row.category).toLowerCase())) {
      throw badRequest('Payment integrations are excluded from this platform');
    }
    if (!row.termsReviewed) {
      throw unprocessable('Free-tier terms must be reviewed before activation');
    }
    if (!row.ownerId) throw unprocessable('An integration owner must be assigned before activation');
    if (!row.purpose) throw unprocessable('An integration purpose must be declared before activation');
  }

  const updated = await ctx.repo.update(REGISTRY, id, {
    enabled: enable,
    enabledAt: enable ? ctx.now() : row.enabledAt ?? null,
    disabledAt: enable ? null : ctx.now(),
    healthStatus: enable ? row.healthStatus ?? 'unknown' : row.healthStatus ?? 'unknown',
    lastVerifiedAt: enable ? ctx.now() : row.lastVerifiedAt ?? null,
  });
  await ctx.audit.record({
    action: enable ? 'integration.enable' : 'integration.disable',
    actorId: actor.userId,
    targetType: 'integration',
    targetId: id,
    detail: { provider: row.provider, enabled: enable },
  });
  return withQuota(updated as Row);
}

/**
 * Metered usage. This is the ₹0 policy enforcement point: usage that would exceed the free
 * quota is refused with 429 and nothing is recorded, so the free tier is never overrun.
 */
export async function recordUsage(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(REGISTRY, id);
  if (!row) throw notFound('Integration not found');
  if (!row.enabled) throw conflict(`Integration "${row.provider}" is disabled`);

  const units = input.units === undefined ? 1 : Number(input.units);
  if (!Number.isFinite(units) || units <= 0) throw badRequest('units must be a positive number');

  const limit = Number(row.freeQuotaLimit ?? 0);
  const used = Number(row.usageCount ?? 0);
  if (used + units > limit) {
    await ctx.audit.record({
      action: 'integration.quota.exceeded',
      actorId,
      targetType: 'integration',
      targetId: id,
      detail: { provider: row.provider, used, limit, requested: units },
    });
    throw quotaExceeded(
      `Free-tier quota for ${row.provider} exhausted (${used}/${limit} ${row.quotaUnit || 'requests'}); paid usage is not permitted`,
    );
  }

  const updated = await ctx.repo.update(REGISTRY, id, { usageCount: used + units, lastUsedAt: ctx.now() });
  await ctx.repo.insert(USAGE, {
    id: ctx.newId(),
    integrationId: id,
    provider: row.provider,
    units,
    kind: input.kind || 'request',
    actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'integration.usage.record',
    actorId,
    targetType: 'integration',
    targetId: id,
    detail: { provider: row.provider, units, usageCount: used + units },
  });
  return { integrationId: id, provider: row.provider, quota: quotaView(updated as Row) };
}

/** Health reporting is isolated: a failed integration must not break unrelated features. */
export async function recordHealth(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(REGISTRY, id);
  if (!row) throw notFound('Integration not found');
  const status = input.status || 'unknown';
  if (!HEALTH_STATES.includes(status)) throw badRequest(`status must be one of ${HEALTH_STATES.join(', ')}`);

  const updated = await ctx.repo.update(REGISTRY, id, {
    healthStatus: status,
    lastVerifiedAt: ctx.now(),
    lastError: status === 'down' ? input.error ?? 'unreachable' : null,
  });
  await ctx.repo.insert(HEALTH, {
    id: ctx.newId(),
    integrationId: id,
    status,
    latencyMs: input.latencyMs ?? null,
    checkedBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'integration.health.record',
    actorId,
    targetType: 'integration',
    targetId: id,
    detail: { provider: row.provider, status },
  });
  return withQuota(updated as Row);
}

export async function listUsage(ctx: FeatureContext, id: string) {
  const row = await ctx.repo.get(REGISTRY, id);
  if (!row) throw notFound('Integration not found');
  const events = await ctx.repo.find(USAGE, { integrationId: id }, { orderBy: 'createdAt', desc: true });
  return { integrationId: id, provider: row.provider, quota: quotaView(row), events };
}

/** Admin dashboard: quota and health of every integration, never a secret. */
export async function statusDashboard(ctx: FeatureContext, session: Session) {
  if (!hasPermission(session, 'system.configuration.manage') && !hasPermission(session, 'ai.manage')) {
    throw forbidden('Requires permission: system.configuration.manage');
  }
  const rows = await ctx.repo.find(REGISTRY, {}, { orderBy: 'createdAt' });
  return {
    total: rows.length,
    enabled: rows.filter((r) => r.enabled).length,
    degraded: rows.filter((r) => r.healthStatus === 'degraded' || r.healthStatus === 'down').length,
    nearQuota: rows.filter((r) => quotaView(r).percentUsed >= 80).map((r) => ({ id: r.id, provider: r.provider, quota: quotaView(r) })),
    integrations: rows.map(withQuota),
  };
}
