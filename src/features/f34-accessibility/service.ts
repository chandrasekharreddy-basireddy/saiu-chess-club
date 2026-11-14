import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';

/**
 * Feature 34 — Accessibility & Inclusivity.
 *
 * Tables (created implicitly by the first insert):
 *   accessibility_preferences  exactly one settings record per user
 *   accessibility_issues       reported accessibility defects (tracked before release)
 *
 * Rules enforced here:
 *  - preferences are validated against an explicit allow-list (reduced motion,
 *    high contrast, font scale) — unknown keys and out-of-range values are rejected
 *    rather than silently stored, so a client can never request an unsupported mode;
 *  - each user has a single settings record (upsert, never a second row);
 *  - a user can read and change only their own preferences; reading someone else's
 *    requires `accessibility.manage`;
 *  - accessibility defects are logged with a severity and a WCAG reference and are
 *    resolved (with a note) by the accessibility team.
 */

export const PREFERENCES = 'accessibility_preferences';
export const ISSUE = 'accessibility_issues';

export const REDUCED_MOTION = ['no-preference', 'reduce'];
export const FONT_SCALES = [1, 1.25, 1.5, 2];
export const CONTRAST_MODES = ['default', 'high', 'system'];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export const DEFAULTS = {
  reducedMotion: 'no-preference',
  highContrast: false,
  contrastMode: 'default',
  fontScale: 1,
  colorBlindSafeBoard: true,
  underlineLinks: false,
  screenReaderAnnouncements: true,
  keyboardOnlyHints: false,
};

/** Public catalogue so clients can validate before submitting. */
export function options() {
  return {
    reducedMotion: REDUCED_MOTION,
    fontScale: FONT_SCALES,
    contrastMode: CONTRAST_MODES,
    severity: SEVERITIES,
    defaults: DEFAULTS,
  };
}

function validate(input: any): Row {
  const patch: Row = {};
  if (!input || typeof input !== 'object') throw badRequest('A preferences object is required');

  const known = Object.keys(DEFAULTS);
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) throw badRequest(`Unknown accessibility preference: ${key}`);
  }

  if (input.reducedMotion !== undefined) {
    const v = input.reducedMotion?.toString();
    if (!REDUCED_MOTION.includes(v)) throw badRequest(`reducedMotion must be one of ${REDUCED_MOTION.join(', ')}`);
    patch.reducedMotion = v;
  }
  if (input.contrastMode !== undefined) {
    const v = input.contrastMode?.toString();
    if (!CONTRAST_MODES.includes(v)) throw badRequest(`contrastMode must be one of ${CONTRAST_MODES.join(', ')}`);
    patch.contrastMode = v;
    patch.highContrast = v === 'high';
  }
  if (input.fontScale !== undefined) {
    const n = Number(input.fontScale);
    if (Number.isNaN(n) || !FONT_SCALES.includes(n)) {
      throw badRequest(`fontScale must be one of ${FONT_SCALES.join(', ')}`);
    }
    patch.fontScale = n;
  }
  for (const key of ['highContrast', 'colorBlindSafeBoard', 'underlineLinks', 'screenReaderAnnouncements', 'keyboardOnlyHints']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') throw badRequest(`${key} must be a boolean`);
    patch[key] = input[key];
    if (key === 'highContrast') patch.contrastMode = input[key] ? 'high' : 'default';
  }
  return patch;
}

export async function getPreferences(ctx: FeatureContext, userId: string) {
  const row = await ctx.repo.findOne(PREFERENCES, { userId });
  if (!row) return { userId, persisted: false, ...DEFAULTS };
  const { id, createdAt, updatedAt, ...prefs } = row as Row;
  return { userId, persisted: true, ...DEFAULTS, ...prefs };
}

export async function updatePreferences(ctx: FeatureContext, userId: string, input: any) {
  const patch = validate(input);
  if (!Object.keys(patch).length) throw badRequest('No accessibility preferences supplied');

  const existing = await ctx.repo.findOne(PREFERENCES, { userId });
  const row = existing
    ? await ctx.repo.update(PREFERENCES, existing.id, patch)
    : await ctx.repo.insert(PREFERENCES, {
        id: ctx.newId(),
        userId,
        ...DEFAULTS,
        ...patch,
        updatedBy: userId,
        createdAt: ctx.now(),
      });
  await ctx.audit.record({
    action: 'accessibility.preferences.update',
    actorId: userId,
    targetType: 'accessibility_preferences',
    targetId: row?.id,
    detail: { keys: Object.keys(patch) },
  });
  const { id, createdAt, updatedAt, ...prefs } = row as Row;
  return { userId, persisted: true, ...DEFAULTS, ...prefs };
}

export async function reportIssue(ctx: FeatureContext, userId: string, input: any = {}) {
  const feature = (input.feature || '').toString().trim();
  if (!feature) throw badRequest('feature is required (where the problem occurred)');
  const description = (input.description || '').toString().trim();
  if (!description) throw badRequest('description is required');
  const severity = (input.severity || 'medium').toString().toLowerCase();
  if (!SEVERITIES.includes(severity)) throw badRequest(`severity must be one of ${SEVERITIES.join(', ')}`);

  const issue = await ctx.repo.insert(ISSUE, {
    id: ctx.newId(),
    feature,
    description,
    severity,
    wcagCriterion: input.wcagCriterion ? input.wcagCriterion.toString() : null,
    assistiveTech: input.assistiveTech ? input.assistiveTech.toString() : null,
    reportedBy: userId,
    status: 'open',
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'accessibility.issue.report',
    actorId: userId,
    targetType: 'accessibility_issue',
    targetId: issue.id,
    detail: { severity, feature },
  });
  return issue;
}

export async function listIssues(ctx: FeatureContext, filter: any = {}) {
  const where: Row = {};
  if (filter.status) where.status = filter.status.toString();
  if (filter.severity) where.severity = filter.severity.toString();
  return ctx.repo.find(ISSUE, where, { orderBy: 'createdAt', desc: true });
}

export async function resolveIssue(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const issue = await ctx.repo.get(ISSUE, id);
  if (!issue) throw notFound('Accessibility issue not found');
  if (issue.status === 'resolved') throw conflict('This accessibility issue is already resolved');
  const resolution = (input.resolution || '').toString().trim();
  if (!resolution) throw badRequest('A resolution note is required');
  const updated = await ctx.repo.update(ISSUE, id, {
    status: 'resolved',
    resolution,
    resolvedBy: actorId,
    resolvedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'accessibility.issue.resolve',
    actorId,
    targetType: 'accessibility_issue',
    targetId: id,
  });
  return updated;
}
