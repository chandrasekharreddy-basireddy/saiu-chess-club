import type { FeatureContext, Session, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { hasPermission, assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 39 — System Administration & Platform Control
 *
 * Tables
 *  - system_settings          current value + version per allowlisted key (pending changes too)
 *  - system_setting_history   append-only, versioned configuration history (rollback source)
 *  - integration_registry     read-only here, for quota/usage display on the status board
 *
 * Only keys in SETTINGS may ever be written — that allowlist is what stops a setting from
 * enabling paid usage. High-risk keys need reauthentication plus a second administrator.
 */

export const SETTINGS_TABLE = 'system_settings';
export const HISTORY = 'system_setting_history';
export const INTEGRATIONS = 'integration_registry';

export interface SettingDef {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  default: any;
  values?: string[];
  min?: number;
  max?: number;
  scope: 'global' | 'academic' | 'communications' | 'integrations' | 'quality' | 'platform';
  impact: string;
  highRisk: boolean;
  rollbackSafe: boolean;
}

/** The complete allowlist. Anything else is rejected outright. */
export const SETTINGS: Record<string, SettingDef> = {
  'academic.year': {
    key: 'academic.year', type: 'string', default: '2025-26', scope: 'academic',
    impact: 'Labels the academic year on tournaments, certificates and reports.',
    highRisk: false, rollbackSafe: true,
  },
  'academic.maxRoundsPerTournament': {
    key: 'academic.maxRoundsPerTournament', type: 'number', default: 11, min: 1, max: 15, scope: 'academic',
    impact: 'Upper bound on rounds a single tournament may schedule.',
    highRisk: false, rollbackSafe: true,
  },
  'chess.defaultTimeControl': {
    key: 'chess.defaultTimeControl', type: 'enum', default: 'rapid', values: ['blitz', 'rapid', 'classical'], scope: 'academic',
    impact: 'Default time control applied to newly created tournaments.',
    highRisk: false, rollbackSafe: true,
  },
  'chess.ratingKFactor': {
    key: 'chess.ratingKFactor', type: 'number', default: 20, min: 10, max: 40, scope: 'academic',
    impact: 'Elo K-factor used by the rating engine.',
    highRisk: true, rollbackSafe: false,
  },
  'notifications.emailEnabled': {
    key: 'notifications.emailEnabled', type: 'boolean', default: true, scope: 'communications',
    impact: 'Turns transactional email (Brevo) on or off platform-wide.',
    highRisk: false, rollbackSafe: true,
  },
  'notifications.reminderHours': {
    key: 'notifications.reminderHours', type: 'number', default: 24, min: 1, max: 168, scope: 'communications',
    impact: 'How many hours before an event a reminder is queued.',
    highRisk: false, rollbackSafe: true,
  },
  'integrations.quotaThresholdPct': {
    key: 'integrations.quotaThresholdPct', type: 'number', default: 80, min: 1, max: 100, scope: 'integrations',
    impact: 'Warn administrators when a free-tier quota passes this percentage.',
    highRisk: false, rollbackSafe: true,
  },
  'integrations.aiCreditLimitInr': {
    key: 'integrations.aiCreditLimitInr', type: 'number', default: 100, min: 0, max: 100, scope: 'integrations',
    impact: 'Hard cap on Sarvam AI free credits; cannot be raised above the ₹100 free allowance.',
    highRisk: false, rollbackSafe: true,
  },
  'platform.maintenanceMode': {
    key: 'platform.maintenanceMode', type: 'boolean', default: false, scope: 'platform',
    impact: 'Puts the public site into read-only maintenance mode.',
    highRisk: true, rollbackSafe: true,
  },
  'platform.registrationOpen': {
    key: 'platform.registrationOpen', type: 'boolean', default: true, scope: 'platform',
    impact: 'Allows new member registrations.',
    highRisk: true, rollbackSafe: true,
  },
  'quality.releaseGateRequired': {
    key: 'quality.releaseGateRequired', type: 'boolean', default: true, scope: 'quality',
    impact: 'Blocks a release unless the QA quality gate passes.',
    highRisk: true, rollbackSafe: false,
  },
};

export const SETTING_KEYS = Object.keys(SETTINGS);
const SECRET_KEY = /secret|password|apikey|api_key|token|credential|private_key/i;
const PAID_KEY = /paid|payment|billing|premium|subscription/i;

function defOf(key: string): SettingDef {
  const def = SETTINGS[key];
  if (!def) throw badRequest(`Setting key "${key}" is not in the administration allowlist`);
  return def;
}

export function validateValue(def: SettingDef, value: any) {
  switch (def.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw badRequest(`${def.key} must be a boolean`);
      return value;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`${def.key} must be a number`);
      if (def.min !== undefined && value < def.min) throw unprocessable(`${def.key} must be at least ${def.min}`);
      if (def.max !== undefined && value > def.max) throw unprocessable(`${def.key} must be at most ${def.max}`);
      return value;
    }
    case 'enum':
      if (!def.values || !def.values.includes(String(value))) {
        throw unprocessable(`${def.key} must be one of ${(def.values || []).join(', ')}`);
      }
      return String(value);
    default:
      if (typeof value !== 'string' || !value.trim()) throw badRequest(`${def.key} must be a non-empty string`);
      if (value.length > 200) throw unprocessable(`${def.key} must be 200 characters or fewer`);
      return value.trim();
  }
}

async function appendHistory(ctx: FeatureContext, key: string, value: any, version: number, action: string, actorId: string) {
  return ctx.repo.insert(HISTORY, {
    id: ctx.newId(),
    key,
    value,
    version,
    action,
    actorId,
    createdAt: ctx.now(),
  });
}

export async function listSettings(ctx: FeatureContext) {
  const rows = await ctx.repo.find(SETTINGS_TABLE, {});
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTING_KEYS.map((key) => {
    const def = SETTINGS[key];
    const row = byKey.get(key);
    const applied = row && row.status === 'applied';
    return {
      key,
      type: def.type,
      scope: def.scope,
      impact: def.impact,
      highRisk: def.highRisk,
      rollbackSafe: def.rollbackSafe,
      default: def.default,
      values: def.values ?? null,
      min: def.min ?? null,
      max: def.max ?? null,
      value: applied ? row.value : def.default,
      version: applied ? row.version ?? 1 : 0,
      status: row ? row.status : 'default',
      pendingValue: row && row.status === 'pending_approval' ? row.pendingValue : null,
      pendingRequestedBy: row && row.status === 'pending_approval' ? row.pendingRequestedBy : null,
      updatedAt: row ? row.updatedAt ?? null : null,
    };
  });
}

export async function getSetting(ctx: FeatureContext, key: string) {
  const def = defOf(key);
  const row = await ctx.repo.findOne(SETTINGS_TABLE, { key });
  if (!row) return { key, value: def.default, version: 0, status: 'default', type: def.type, scope: def.scope, impact: def.impact };
  return {
    key,
    value: row.status === 'applied' ? row.value : def.default,
    version: row.version ?? 0,
    status: row.status,
    pendingValue: row.status === 'pending_approval' ? row.pendingValue : null,
    type: def.type,
    scope: def.scope,
    impact: def.impact,
  };
}

/** Resolve a setting for other features (falls back to the declared default). */
export async function resolveSetting(ctx: FeatureContext, key: string) {
  const def = SETTINGS[key];
  if (!def) throw badRequest(`Setting key "${key}" is not in the administration allowlist`);
  const row = await ctx.repo.findOne(SETTINGS_TABLE, { key });
  return row && row.status === 'applied' ? row.value : def.default;
}

export async function updateSetting(ctx: FeatureContext, session: Session, key: string, input: any = {}) {
  const def = defOf(key);
  if (SECRET_KEY.test(key)) throw badRequest('Secrets are managed in provider secret storage, never in platform settings');
  if (PAID_KEY.test(key)) throw badRequest('No setting may enable paid usage');

  if (input.value === undefined) throw badRequest('value is required');
  const value = validateValue(def, input.value);

  if (def.highRisk && input.reauthenticated !== true) {
    throw forbidden(`Reauthentication is required to change the high-risk setting ${key}`);
  }

  const row = await ctx.repo.findOne(SETTINGS_TABLE, { key });
  const nextVersion = (row?.version ?? 0) + 1;

  if (def.highRisk) {
    // two-person rule: the change is staged until a different administrator approves it
    if (row && row.status === 'pending_approval') throw conflict('A change to this setting is already awaiting approval');
    const staged = row
      ? await ctx.repo.update(SETTINGS_TABLE, row.id, {
          status: 'pending_approval',
          pendingValue: value,
          pendingRequestedBy: session.userId,
          pendingRequestedAt: ctx.now(),
          pendingVersion: nextVersion,
          pendingReason: input.reason ?? null,
        })
      : await ctx.repo.insert(SETTINGS_TABLE, {
          id: ctx.newId(),
          key,
          value: def.default,
          version: 0,
          status: 'pending_approval',
          pendingValue: value,
          pendingRequestedBy: session.userId,
          pendingRequestedAt: ctx.now(),
          pendingVersion: nextVersion,
          pendingReason: input.reason ?? null,
          createdAt: ctx.now(),
        });
    await ctx.audit.record({
      action: 'system.setting.request',
      actorId: session.userId,
      targetType: 'setting',
      targetId: key,
      detail: { value, highRisk: true, reason: input.reason ?? null },
    });
    return {
      key,
      status: 'pending_approval',
      pendingValue: staged?.pendingValue ?? value,
      requiresSecondApproval: true,
      pendingRequestedBy: session.userId,
    };
  }

  const applied = row
    ? await ctx.repo.update(SETTINGS_TABLE, row.id, { value, version: nextVersion, status: 'applied', updatedBy: session.userId, pendingValue: null, pendingRequestedBy: null })
    : await ctx.repo.insert(SETTINGS_TABLE, {
        id: ctx.newId(),
        key,
        value,
        version: nextVersion,
        status: 'applied',
        updatedBy: session.userId,
        createdAt: ctx.now(),
      });
  await appendHistory(ctx, key, value, nextVersion, 'update', session.userId);
  await ctx.audit.record({
    action: 'system.setting.update',
    actorId: session.userId,
    targetType: 'setting',
    targetId: key,
    detail: { value, previous: row?.value ?? def.default, version: nextVersion },
  });
  return { key, value: applied?.value ?? value, version: nextVersion, status: 'applied' };
}

export async function approveSettingChange(ctx: FeatureContext, session: Session, key: string, input: any = {}) {
  const def = defOf(key);
  const row = await ctx.repo.findOne(SETTINGS_TABLE, { key });
  if (!row) throw notFound('Setting has not been configured yet');
  if (row.status !== 'pending_approval') throw conflict('There is no pending change awaiting approval');

  try {
    assertNotSelfApproval(session.userId, row.pendingRequestedBy, 'a configuration change');
  } catch {
    throw forbidden('Separation of duties: a configuration change needs a second administrator');
  }

  const version = row.pendingVersion ?? (row.version ?? 0) + 1;
  const applied = await ctx.repo.update(SETTINGS_TABLE, row.id, {
    value: row.pendingValue,
    version,
    status: 'applied',
    updatedBy: session.userId,
    approvedBy: session.userId,
    approvedAt: ctx.now(),
    pendingValue: null,
    pendingRequestedBy: null,
  });
  await appendHistory(ctx, key, row.pendingValue, version, 'approved', session.userId);
  await ctx.audit.record({
    action: 'system.setting.approve',
    actorId: session.userId,
    targetType: 'setting',
    targetId: key,
    detail: { value: row.pendingValue, version, requestedBy: row.pendingRequestedBy, highRisk: def.highRisk, note: input.note ?? null },
  });
  return { key, value: applied?.value ?? row.pendingValue, version, status: 'applied' };
}

export async function settingHistory(ctx: FeatureContext, key: string) {
  defOf(key);
  return ctx.repo.find(HISTORY, { key }, { orderBy: 'version', desc: true });
}

export async function rollbackSetting(ctx: FeatureContext, session: Session, key: string, input: any = {}) {
  const def = defOf(key);
  if (!def.rollbackSafe) throw conflict(`Setting ${key} does not support rollback; change it forward instead`);

  const row = await ctx.repo.findOne(SETTINGS_TABLE, { key });
  if (!row || row.status !== 'applied') throw conflict('Only an applied setting can be rolled back');

  const history = await ctx.repo.find(HISTORY, { key }, { orderBy: 'version' });
  const earlier = history.filter((h) => (h.version ?? 0) < (row.version ?? 0));
  const previous = earlier.length ? earlier[earlier.length - 1].value : def.default;
  const version = (row.version ?? 0) + 1;

  const updated = await ctx.repo.update(SETTINGS_TABLE, row.id, {
    value: previous,
    version,
    updatedBy: session.userId,
    rolledBackFrom: row.value,
  });
  await appendHistory(ctx, key, previous, version, 'rollback', session.userId);
  await ctx.audit.record({
    action: 'system.setting.rollback',
    actorId: session.userId,
    targetType: 'setting',
    targetId: key,
    detail: { from: row.value, to: previous, version, reason: input.reason ?? null },
  });
  return { key, value: updated?.value ?? previous, version, status: 'applied', rolledBackFrom: row.value };
}

/** Public operational status board: no secrets, no personal data. */
export async function platformStatus(ctx: FeatureContext) {
  const maintenance = await resolveSetting(ctx, 'platform.maintenanceMode');
  const registrationOpen = await resolveSetting(ctx, 'platform.registrationOpen');
  const releaseGateRequired = await resolveSetting(ctx, 'quality.releaseGateRequired');
  const integrations = await ctx.repo.find(INTEGRATIONS, {});
  const quota = integrations.map((r) => ({
    provider: r.provider,
    used: Number(r.usageCount ?? 0),
    limit: Number(r.freeQuotaLimit ?? 0),
    remaining: Math.max(0, Number(r.freeQuotaLimit ?? 0) - Number(r.usageCount ?? 0)),
    enabled: !!r.enabled,
    health: r.healthStatus ?? 'unknown',
  }));
  return {
    status: maintenance ? 'maintenance' : 'operational',
    maintenanceMode: !!maintenance,
    registrationOpen: !!registrationOpen,
    release: { version: '1.0.0', channel: 'stable', qualityGateRequired: !!releaseGateRequired },
    quota,
    quotaWarnings: quota.filter((q) => q.limit > 0 && q.used / q.limit >= 0.8).map((q) => q.provider),
    checkedAt: ctx.now(),
  };
}

/** Admin-only view of configuration history across keys. */
export async function configurationHistory(ctx: FeatureContext, session: Session, opts: { key?: string } = {}) {
  if (!hasPermission(session, 'system.configuration.manage') && !hasPermission(session, 'audit.log.read')) {
    throw forbidden('Requires permission: system.configuration.manage');
  }
  return ctx.repo.find(HISTORY, opts.key ? { key: opts.key } : {}, { orderBy: 'createdAt', desc: true });
}
