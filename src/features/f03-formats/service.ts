/**
 * Feature 03 — Tournament Formats & Blocked Mode (slug: `formats`)
 *
 * Tables
 *   format_configs     validated tournament format configuration (one per tournament)
 *   format_pairings    generated pairings, one row per board per round
 *   format_signals     documented technical status signals from Browser Supervised / Kiosk mode
 *   format_spectators  spectator grants (read-only, delayed, revocable)
 *   format_resets      format-lock reset requests and their independent approval
 *
 * Deterministic rules
 *   Swiss      : pair by score desc then seed asc, bye to the lowest-seeded unpaired player
 *   Knockout   : ceil(log2(n)) rounds, consecutive seeds meet, odd seed count gets a bye
 *   Round Robin: polygon (circle) method, n-1 rounds for even n, n rounds for odd n
 *   Team       : round robin over team ids, each team fielding its member list
 *
 * A technical signal is NOT proof of cheating and never creates a penalty.
 */
import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors.js';
import { forbidden } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

export const CONFIGS = 'format_configs';
export const PAIRINGS = 'format_pairings';
export const SIGNALS = 'format_signals';
export const SPECTATORS = 'format_spectators';
export const RESETS = 'format_resets';

export const FORMATS = ['swiss', 'knockout', 'round_robin', 'team'] as const;
export type Format = (typeof FORMATS)[number];

export const NETWORK_MODES = ['online', 'local_network', 'offline'] as const;
export const BLOCKED_VARIANTS = ['browser_supervised', 'managed_kiosk'] as const;
export const SIGNAL_TYPES = ['focus_lost', 'fullscreen_exit', 'connection_lost', 'kiosk_tamper', 'other'] as const;

export const DEFAULT_TIE_BREAKERS = ['buchholz', 'sonneborn_berger', 'direct_encounter'];
export const DEFAULT_SPECTATOR_DELAY_SECONDS = 300;

/* ---------------------------------------------------------------- pure math */

/** Knockout rounds for n participants: ceil(log2(n)). */
export function knockoutRounds(n: number): number {
  if (n < 2) return 0;
  return Math.ceil(Math.log2(n));
}

/** Round-robin rounds: n-1 for an even count, n for an odd count. */
export function roundRobinRounds(n: number): number {
  if (n < 2) return 0;
  return n % 2 === 0 ? n - 1 : n;
}

const BYE = '__bye__';

/** Deterministic round-robin pairings (polygon method). `round` is 1-based. */
export function roundRobinPairings(ids: string[], round: number): Array<{ whiteId: string; blackId: string; bye: boolean }> {
  const list = ids.slice();
  if (list.length % 2 === 1) list.push(BYE);
  const n = list.length;
  const rounds = n - 1;
  if (round < 1 || round > rounds) throw badRequest(`round must be between 1 and ${rounds}`);
  const fixed = list[0];
  const rest = list.slice(1);
  const rotated = rest.map((_, i) => rest[(i + (round - 1)) % rest.length]);
  const positions = [fixed, ...rotated];
  const out: Array<{ whiteId: string; blackId: string; bye: boolean }> = [];
  for (let i = 0; i < n / 2; i++) {
    const a = positions[i];
    const b = positions[n - 1 - i];
    if (a === BYE || b === BYE) out.push({ whiteId: a === BYE ? b : a, blackId: BYE, bye: true });
    else out.push({ whiteId: a, blackId: b, bye: false });
  }
  return out;
}

/** Deterministic Swiss pairings: score desc, then seed asc; lowest unpaired player gets the bye. */
export function swissPairings(
  participantIds: string[],
  scores: Record<string, number> = {},
): Array<{ whiteId: string; blackId: string; bye: boolean }> {
  const seeded = participantIds.map((id, i) => ({ id, seed: i + 1, score: scores[id] ?? 0 }));
  seeded.sort((a, b) => (b.score - a.score) || (a.seed - b.seed));
  const out: Array<{ whiteId: string; blackId: string; bye: boolean }> = [];
  for (let i = 0; i + 1 < seeded.length; i += 2) {
    out.push({ whiteId: seeded[i].id, blackId: seeded[i + 1].id, bye: false });
  }
  if (seeded.length % 2 === 1) {
    const last = seeded[seeded.length - 1];
    out.push({ whiteId: last.id, blackId: BYE, bye: true });
  }
  return out;
}

/** Deterministic knockout pairings: consecutive seeds, odd count gives the last seed a bye. */
export function knockoutPairings(participantIds: string[], round: number): Array<{ whiteId: string; blackId: string; bye: boolean }> {
  const total = knockoutRounds(participantIds.length);
  if (round < 1 || round > total) throw badRequest(`round must be between 1 and ${total}`);
  const out: Array<{ whiteId: string; blackId: string; bye: boolean }> = [];
  if (round > 1) {
    // later rounds are produced from the previous round's winners; the caller supplies them as participantIds
    for (let i = 0; i + 1 < participantIds.length; i += 2) out.push({ whiteId: participantIds[i], blackId: participantIds[i + 1], bye: false });
    if (participantIds.length % 2 === 1) out.push({ whiteId: participantIds[participantIds.length - 1], blackId: BYE, bye: true });
    return out;
  }
  for (let i = 0; i + 1 < participantIds.length; i += 2) out.push({ whiteId: participantIds[i], blackId: participantIds[i + 1], bye: false });
  if (participantIds.length % 2 === 1) out.push({ whiteId: participantIds[participantIds.length - 1], blackId: BYE, bye: true });
  return out;
}

export function validateTimeControl(tc: any) {
  if (!tc || typeof tc !== 'object') throw badRequest('timeControl { initial, increment } is required');
  const initial = Number(tc.initial);
  const increment = Number(tc.increment ?? 0);
  if (!Number.isFinite(initial) || initial < 30) throw badRequest('timeControl.initial must be at least 30 seconds');
  if (!Number.isFinite(increment) || increment < 0 || increment > 60) throw badRequest('timeControl.increment must be between 0 and 60 seconds');
  const category = initial < 180 ? 'bullet' : initial < 600 ? 'blitz' : initial < 1800 ? 'rapid' : 'classical';
  return { initial, increment, category };
}

/* ------------------------------------------------------------------- config */

export interface FormatConfigInput {
  tournamentId?: string;
  format?: string;
  rounds?: number;
  participantIds?: string[];
  teams?: Array<{ id?: string; name?: string; members?: string[] }>;
  tieBreakers?: string[];
  timeControl?: { initial?: number; increment?: number };
  networkMode?: string;
  blockedMode?: { enabled?: boolean; variant?: string; deviceAdminConfigured?: boolean };
  spectators?: { enabled?: boolean; approvalRequired?: boolean; delaySeconds?: number };
}

/** Validates the configuration. Nothing else may open registration before this passes. */
export function validateConfig(input: FormatConfigInput) {
  if (!input?.tournamentId) throw badRequest('tournamentId is required');
  const format = input.format;
  if (!(FORMATS as readonly string[]).includes(format as string)) {
    throw badRequest(`format must be one of: ${FORMATS.join(', ')}`);
  }
  const participants = Array.isArray(input.participantIds) ? input.participantIds : [];
  if (participants.length < 2) throw badRequest('At least two participants are required');
  if (new Set(participants).size !== participants.length) throw badRequest('participantIds must be unique');

  const networkMode = input.networkMode || 'online';
  if (!(NETWORK_MODES as readonly string[]).includes(networkMode)) {
    throw badRequest(`networkMode must be one of: ${NETWORK_MODES.join(', ')}`);
  }
  if (networkMode === 'offline') {
    throw unprocessable(
      'Offline mode is not supported: conflict resolution, secure device identity, event ordering and synchronisation have not passed consistency tests',
    );
  }

  const timeControl = validateTimeControl(input.timeControl || { initial: 600, increment: 0 });

  let blockedMode: Row = { enabled: false, variant: null, enforcedBy: null };
  if (input.blockedMode?.enabled) {
    const variant = input.blockedMode.variant || 'browser_supervised';
    if (!(BLOCKED_VARIANTS as readonly string[]).includes(variant)) {
      throw badRequest(`blockedMode.variant must be one of: ${BLOCKED_VARIANTS.join(', ')}`);
    }
    if (variant === 'managed_kiosk') {
      if (input.blockedMode.deviceAdminConfigured !== true) {
        throw unprocessable(
          'Managed kiosk mode must be configured by an authorised institution/device administrator; the website cannot enforce device lockdown',
        );
      }
      blockedMode = { enabled: true, variant, enforcedBy: 'institution_device_administrator' };
    } else {
      blockedMode = { enabled: true, variant, enforcedBy: 'browser_supervision_only', notice: 'Browser supervision signals focus changes; it is not device lockdown.' };
    }
  }

  const spectators = {
    enabled: input.spectators?.enabled ?? true,
    approvalRequired: input.spectators?.approvalRequired ?? true,
    delaySeconds: input.spectators?.delaySeconds ?? DEFAULT_SPECTATOR_DELAY_SECONDS,
    readOnly: true,
  };

  let rounds: number;
  let teams: Row[] = [];
  if (format === 'team') {
    const raw = input.teams || [];
    if (raw.length < 2) throw badRequest('Team tournaments require at least two teams');
    const seen = new Set<string>();
    teams = raw.map((t, i) => {
      const members = Array.isArray(t.members) ? t.members : [];
      if (members.length < 2) throw badRequest(`Team ${t.name || i + 1} must field at least two members`);
      for (const m of members) {
        if (seen.has(m)) throw badRequest(`Player ${m} appears in more than one team`);
        seen.add(m);
      }
      return { id: t.id || `team_${i + 1}`, name: t.name || `Team ${i + 1}`, members };
    });
    rounds = roundRobinRounds(teams.length);
    if (input.rounds != null && input.rounds !== rounds) throw badRequest(`Team format requires exactly ${rounds} rounds`);
  } else if (format === 'knockout') {
    rounds = knockoutRounds(participants.length);
    if (input.rounds != null && input.rounds !== rounds) throw badRequest(`Knockout format requires exactly ${rounds} rounds for ${participants.length} participants`);
  } else if (format === 'round_robin') {
    rounds = roundRobinRounds(participants.length);
    if (input.rounds != null && input.rounds !== rounds) throw badRequest(`Round robin format requires exactly ${rounds} rounds for ${participants.length} participants`);
  } else {
    rounds = input.rounds ?? 5;
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 15) throw badRequest('rounds must be an integer between 1 and 15');
  }

  const tieBreakers = format === 'swiss' ? (input.tieBreakers?.length ? input.tieBreakers : DEFAULT_TIE_BREAKERS) : (input.tieBreakers || []);
  if (format === 'swiss' && !tieBreakers.length) throw badRequest('Swiss tournaments require at least one tie-breaker');

  return {
    format: format as Format,
    rounds,
    participantIds: participants,
    teams,
    tieBreakers,
    timeControl,
    networkMode,
    blockedMode,
    spectators,
  };
}

export async function createConfig(ctx: FeatureContext, actorId: string, input: FormatConfigInput) {
  const v = validateConfig(input);
  const existing = await ctx.repo.findOne(CONFIGS, { tournamentId: input.tournamentId });
  if (existing) throw conflict('A format configuration already exists for this tournament');
  const config = await ctx.repo.insert(CONFIGS, {
    id: ctx.newId(),
    tournamentId: input.tournamentId,
    ...v,
    status: 'validated',
    locked: false,
    lockedAt: null,
    firstOfficialMatchId: null,
    validatedAt: ctx.now(),
    createdBy: actorId,
  });
  await ctx.audit.record({ action: 'formats.config.create', actorId, targetType: 'format_config', targetId: config.id, detail: { format: v.format, rounds: v.rounds } });
  return config;
}

export async function getConfig(ctx: FeatureContext, id: string) {
  const c = await ctx.repo.get(CONFIGS, id);
  if (!c) throw notFound('Format configuration not found');
  const pairings = await ctx.repo.find(PAIRINGS, { configId: id }, { orderBy: 'board' });
  return { ...c, pairings };
}

/** Re-validation gate: registration may only open when this returns ok. */
export async function revalidateConfig(ctx: FeatureContext, actorId: string, id: string) {
  const c = await ctx.repo.get(CONFIGS, id);
  if (!c) throw notFound('Format configuration not found');
  const issues: string[] = [];
  if (!(FORMATS as readonly string[]).includes(c.format)) issues.push('unknown format');
  if (!c.participantIds || c.participantIds.length < 2) issues.push('fewer than two participants');
  if (c.networkMode === 'offline') issues.push('offline mode is not supported');
  if (!c.timeControl?.initial) issues.push('time control missing');
  if (issues.length) {
    await ctx.repo.update(CONFIGS, id, { status: 'invalid' });
    throw unprocessable(`Format configuration is invalid: ${issues.join('; ')}`, { issues });
  }
  const updated = await ctx.repo.update(CONFIGS, id, { status: 'validated', validatedAt: ctx.now() });
  await ctx.audit.record({ action: 'formats.config.validate', actorId, targetType: 'format_config', targetId: id });
  return updated;
}

/* ----------------------------------------------------------------- pairings */

export async function generatePairings(
  ctx: FeatureContext,
  actorId: string,
  configId: string,
  round: number,
  opts: { scores?: Record<string, number>; winners?: string[]; regenerate?: boolean } = {},
) {
  const config = await ctx.repo.get(CONFIGS, configId);
  if (!config) throw notFound('Format configuration not found');
  if (!Number.isInteger(round) || round < 1 || round > config.rounds) {
    throw badRequest(`round must be between 1 and ${config.rounds}`);
  }
  const existing = await ctx.repo.find(PAIRINGS, { configId, round });
  if (existing.length && !opts.regenerate) throw conflict('Pairings for this round have already been generated');
  if (existing.length && opts.regenerate && config.locked) {
    throw conflict('Format is locked: pairings cannot be regenerated after the first official match started');
  }
  for (const row of existing) await ctx.repo.remove(PAIRINGS, row.id);

  let pairs: Array<{ whiteId: string; blackId: string; bye: boolean }>;
  if (config.format === 'swiss') {
    pairs = swissPairings(config.participantIds, opts.scores || {});
  } else if (config.format === 'round_robin') {
    pairs = roundRobinPairings(config.participantIds, round);
  } else if (config.format === 'team') {
    pairs = roundRobinPairings(config.teams.map((t: Row) => t.id), round);
  } else {
    const field = round === 1 ? config.participantIds : (opts.winners || []);
    if (round > 1 && field.length < 2) throw conflict('Previous round winners are required to generate this knockout round');
    pairs = knockoutPairings(field, round);
  }

  const rows: Row[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const row = await ctx.repo.insert(PAIRINGS, {
      id: ctx.newId(),
      configId,
      tournamentId: config.tournamentId,
      round,
      board: i + 1,
      whiteId: p.whiteId,
      blackId: p.bye ? null : p.blackId,
      bye: p.bye,
      result: null,
      resultSource: null,
    });
    rows.push(row);
  }
  await ctx.audit.record({
    action: 'formats.pairings.generate',
    actorId,
    targetType: 'format_config',
    targetId: configId,
    detail: { round, boards: rows.length },
  });
  return { round, format: config.format, pairings: rows, bye: rows.find((r) => r.bye) || null };
}

export async function recordPairingResult(
  ctx: FeatureContext,
  actorId: string,
  configId: string,
  pairingId: string,
  input: { result?: 'white' | 'black' | 'draw' | 'bye'; reason?: string },
) {
  const config = await ctx.repo.get(CONFIGS, configId);
  if (!config) throw notFound('Format configuration not found');
  const pairing = await ctx.repo.get(PAIRINGS, pairingId);
  if (!pairing || pairing.configId !== configId) throw notFound('Pairing not found');
  if (pairing.result) throw conflict('This pairing already has a result');
  const result = input?.result;
  if (!['white', 'black', 'draw', 'bye'].includes(result as string)) throw badRequest('result must be white, black, draw or bye');
  if (result === 'bye' && !pairing.bye) throw badRequest('Only a bye board can be recorded as a bye');
  const updated = await ctx.repo.update(PAIRINGS, pairingId, { result, resultSource: 'organizer', recordedBy: actorId, recordedAt: ctx.now(), reason: input?.reason || null });
  await ctx.audit.record({ action: 'formats.pairing.result', actorId, targetType: 'pairing', targetId: pairingId, detail: { result } });
  return updated;
}

/** Standings for the format's tie-breakers: deterministic 1 / 0.5 / 0 scoring. */
export async function standings(ctx: FeatureContext, configId: string) {
  const config = await ctx.repo.get(CONFIGS, configId);
  if (!config) throw notFound('Format configuration not found');
  const pairings = await ctx.repo.find(PAIRINGS, { configId });
  const table: Record<string, { playerId: string; score: number; played: number; byes: number }> = {};
  const touch = (id: string) => (table[id] = table[id] || { playerId: id, score: 0, played: 0, byes: 0 });
  for (const p of config.participantIds) touch(p);
  for (const p of pairings) {
    if (p.bye) {
      const t = touch(p.whiteId);
      t.byes += 1;
      t.score += 1;
      continue;
    }
    if (!p.result) continue;
    const w = touch(p.whiteId);
    const b = touch(p.blackId);
    w.played += 1;
    b.played += 1;
    if (p.result === 'white') w.score += 1;
    else if (p.result === 'black') b.score += 1;
    else {
      w.score += 0.5;
      b.score += 0.5;
    }
  }
  const rows = Object.values(table).sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
  return { configId, tieBreakers: config.tieBreakers, rows: rows.map((r, i) => ({ ...r, rank: i + 1 })) };
}

/* ------------------------------------------------------- lock / reset / mode */

/** The format locks as soon as the first official match starts. */
export async function startOfficialMatch(ctx: FeatureContext, actorId: string, configId: string, input: { matchId?: string } = {}) {
  const config = await ctx.repo.get(CONFIGS, configId);
  if (!config) throw notFound('Format configuration not found');
  if (config.locked) throw conflict('Format is locked after the first official match; an authorised reset is required');
  if (config.status !== 'validated') throw conflict('Format configuration must be validated before official play');
  if (!config.blockedMode?.enabled) throw conflict('Official supervised matches require Blocked Mode to be enabled');
  if (!input?.matchId) throw badRequest('matchId is required');
  const updated = await ctx.repo.update(CONFIGS, configId, { locked: true, lockedAt: ctx.now(), firstOfficialMatchId: input.matchId, status: 'locked' });
  await ctx.audit.record({ action: 'formats.lock', actorId, targetType: 'format_config', targetId: configId, detail: { matchId: input.matchId } });
  return updated;
}

export async function requestReset(ctx: FeatureContext, actorId: string, configId: string, input: { reason?: string }) {
  const config = await ctx.repo.get(CONFIGS, configId);
  if (!config) throw notFound('Format configuration not found');
  if (!config.locked) throw conflict('The format is not locked');
  if (!input?.reason?.trim()) throw badRequest('A reason is required to request a format reset');
  const pending = await ctx.repo.findOne(RESETS, { configId, status: 'pending' });
  if (pending) throw conflict('A format reset request is already pending approval');
  const reset = await ctx.repo.insert(RESETS, {
    id: ctx.newId(),
    configId,
    tournamentId: config.tournamentId,
    reason: input.reason.trim(),
    requestedBy: actorId,
    requestedAt: ctx.now(),
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    note: null,
  });
  await ctx.audit.record({ action: 'formats.reset.request', actorId, targetType: 'format_config', targetId: configId, detail: { resetId: reset.id } });
  return reset;
}

export async function approveReset(ctx: FeatureContext, actorId: string, configId: string, resetId: string, input: { note?: string } = {}) {
  const config = await ctx.repo.get(CONFIGS, configId);
  if (!config) throw notFound('Format configuration not found');
  const reset = await ctx.repo.get(RESETS, resetId);
  if (!reset || reset.configId !== configId) throw notFound('Reset request not found');
  if (reset.status !== 'pending') throw conflict('This reset request is no longer pending');
  try {
    assertNotSelfApproval(actorId, reset.requestedBy, 'a format reset you requested');
  } catch (e: any) {
    throw forbidden(e?.message || 'Separation of duties: the requester cannot approve their own reset');
  }
  await ctx.repo.update(RESETS, resetId, { status: 'approved', approvedBy: actorId, approvedAt: ctx.now(), note: input?.note?.trim() || null });
  const updated = await ctx.repo.update(CONFIGS, configId, { locked: false, lockedAt: null, firstOfficialMatchId: null, status: 'validated', resetAt: ctx.now() });
  await ctx.audit.record({ action: 'formats.reset.approve', actorId, targetType: 'format_config', targetId: configId, detail: { resetId, requestedBy: reset.requestedBy } });
  return { config: updated, reset: await ctx.repo.get(RESETS, resetId) };
}

/* --------------------------------------------------- technical status signals */

/** A signal is documented telemetry for the organizer — never an automatic penalty. */
export async function recordSignal(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  input: { type?: string; detail?: any; configId?: string },
) {
  if (!matchId) throw badRequest('matchId is required');
  const type = input?.type;
  if (!(SIGNAL_TYPES as readonly string[]).includes(type as string)) {
    throw badRequest(`type must be one of: ${SIGNAL_TYPES.join(', ')}`);
  }
  const signal = await ctx.repo.insert(SIGNALS, {
    id: ctx.newId(),
    matchId,
    configId: input?.configId || null,
    type,
    detail: input?.detail ?? null,
    severity: 'info',
    status: 'open',
    organizerAlerted: true,
    isProofOfCheating: false,
    automaticPenalty: false,
    penaltyId: null,
    recordedBy: actorId,
    at: ctx.now(),
  });
  await ctx.audit.record({ action: 'formats.signal.record', actorId, targetType: 'match', targetId: matchId, detail: { type, signalId: signal.id } });
  return signal;
}

export async function decideSignal(ctx: FeatureContext, actorId: string, signalId: string, input: { decision?: 'continue' | 'investigate' | 'pause'; reason?: string }) {
  const signal = await ctx.repo.get(SIGNALS, signalId);
  if (!signal) throw notFound('Signal not found');
  if (signal.status === 'reviewed') throw conflict('This signal has already been reviewed');
  const decision = input?.decision;
  if (!['continue', 'investigate', 'pause'].includes(decision as string)) throw badRequest('decision must be continue, investigate or pause');
  if (!input?.reason?.trim()) throw badRequest('A reason is required to record the organizer decision');
  const updated = await ctx.repo.update(SIGNALS, signalId, {
    status: 'reviewed',
    decision,
    decisionReason: input.reason.trim(),
    decidedBy: actorId,
    decidedAt: ctx.now(),
    automaticPenalty: false,
  });
  await ctx.audit.record({ action: 'formats.signal.decide', actorId, targetType: 'signal', targetId: signalId, detail: { decision } });
  return updated;
}

export async function listSignals(ctx: FeatureContext, filter: { matchId?: string; configId?: string; status?: string } = {}) {
  const f: Row = {};
  if (filter.matchId) f.matchId = filter.matchId;
  if (filter.configId) f.configId = filter.configId;
  if (filter.status) f.status = filter.status;
  return ctx.repo.find(SIGNALS, f, { orderBy: 'createdAt', desc: true });
}

/* ---------------------------------------------------------------- spectators */

export async function requestSpectator(
  ctx: FeatureContext,
  actorId: string,
  matchId: string,
  input: { spectatorId?: string; configId?: string },
) {
  if (!matchId) throw badRequest('matchId is required');
  if (!input?.spectatorId) throw badRequest('spectatorId is required');
  const config = input.configId ? await ctx.repo.get(CONFIGS, input.configId) : null;
  if (config && config.spectators?.enabled === false) throw conflict('Spectators are disabled for this tournament');
  const approvalRequired = config ? config.spectators?.approvalRequired !== false : true;
  const existing = await ctx.repo.findOne(SPECTATORS, { matchId, spectatorId: input.spectatorId });
  if (existing && existing.status !== 'revoked') throw conflict('A spectator grant already exists for this user');
  const row = existing
    ? await ctx.repo.update(SPECTATORS, existing.id, { status: approvalRequired ? 'pending' : 'approved', requestedBy: actorId, configId: input.configId || null })
    : await ctx.repo.insert(SPECTATORS, {
        id: ctx.newId(),
        matchId,
        configId: input.configId || null,
        spectatorId: input.spectatorId,
        requestedBy: actorId,
        status: approvalRequired ? 'pending' : 'approved',
        readOnly: true,
        delaySeconds: config?.spectators?.delaySeconds ?? DEFAULT_SPECTATOR_DELAY_SECONDS,
        approvedBy: null,
        approvedAt: null,
      });
  await ctx.audit.record({ action: 'formats.spectator.request', actorId, targetType: 'match', targetId: matchId, detail: { spectatorId: input.spectatorId } });
  return row;
}

export async function approveSpectator(ctx: FeatureContext, actorId: string, spectatorGrantId: string) {
  const grant = await ctx.repo.get(SPECTATORS, spectatorGrantId);
  if (!grant) throw notFound('Spectator grant not found');
  if (grant.status !== 'pending') throw conflict(`Spectator grant is ${grant.status}`);
  const updated = await ctx.repo.update(SPECTATORS, spectatorGrantId, { status: 'approved', approvedBy: actorId, approvedAt: ctx.now(), readOnly: true });
  await ctx.audit.record({ action: 'formats.spectator.approve', actorId, targetType: 'spectator_grant', targetId: spectatorGrantId });
  return updated;
}

export async function revokeSpectator(ctx: FeatureContext, actorId: string, spectatorGrantId: string, input: { reason?: string } = {}) {
  const grant = await ctx.repo.get(SPECTATORS, spectatorGrantId);
  if (!grant) throw notFound('Spectator grant not found');
  if (grant.status === 'revoked') throw conflict('Spectator access is already revoked');
  const updated = await ctx.repo.update(SPECTATORS, spectatorGrantId, { status: 'revoked', revokedBy: actorId, revokedAt: ctx.now(), revokeReason: input?.reason?.trim() || null });
  await ctx.audit.record({ action: 'formats.spectator.revoke', actorId, targetType: 'spectator_grant', targetId: spectatorGrantId });
  return updated;
}

export async function listSpectators(ctx: FeatureContext, matchId: string) {
  return ctx.repo.find(SPECTATORS, { matchId }, { orderBy: 'createdAt' });
}
