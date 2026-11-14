import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, notFound, forbidden } from '../../core/errors.js';

export const TABLE = 'tournaments';
export const REG = 'tournament_registrations';

export interface TournamentInput {
  name: string;
  format?: string;
  rounds?: number;
  startsAt?: string;
  capacity?: number;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  venue?: string;
}

export async function createTournament(ctx: FeatureContext, actorId: string, input: TournamentInput) {
  if (!input?.name?.trim()) throw badRequest('Tournament name is required');
  if (input.rounds != null && (input.rounds < 1 || input.rounds > 20)) throw badRequest('rounds must be between 1 and 20');
  if (input.capacity != null && input.capacity < 2) throw badRequest('capacity must be at least 2');
  const t = await ctx.repo.insert(TABLE, {
    id: ctx.newId(),
    name: input.name.trim(),
    format: input.format || 'swiss',
    rounds: input.rounds ?? 5,
    startsAt: input.startsAt ?? null,
    capacity: input.capacity ?? 64,
    registrationOpensAt: input.registrationOpensAt ?? null,
    registrationClosesAt: input.registrationClosesAt ?? null,
    venue: input.venue ?? null,
    status: 'draft',
    scheduleStatus: 'none',
    scheduleProposedBy: null,
    scheduleApprovedBy: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'tournament.create', actorId, targetType: 'tournament', targetId: t.id, detail: { name: t.name } });
  return t;
}

export async function openRegistration(ctx: FeatureContext, actorId: string, id: string) {
  const t = await ctx.repo.get(TABLE, id);
  if (!t) throw notFound('Tournament not found');
  if (t.status === 'cancelled' || t.status === 'completed') throw conflict(`Cannot open registration for a ${t.status} tournament`);
  const next = await ctx.repo.update(TABLE, id, { status: 'registration_open' });
  await ctx.audit.record({ action: 'tournament.registration.open', actorId, targetType: 'tournament', targetId: id });
  return next;
}

export async function register(ctx: FeatureContext, userId: string, id: string, opts: { playerId?: string; manual?: boolean } = {}) {
  const t = await ctx.repo.get(TABLE, id);
  if (!t) throw notFound('Tournament not found');
  if (t.status === 'draft') throw conflict('Registration is not open yet');
  if (t.status === 'cancelled') throw conflict('Tournament is cancelled');

  const playerId = opts.playerId || userId;
  if (!opts.manual) {
    const now = new Date(ctx.now()).getTime();
    if (t.registrationOpensAt && now < new Date(t.registrationOpensAt).getTime()) throw conflict('Registration has not opened yet');
    if (t.registrationClosesAt && now > new Date(t.registrationClosesAt).getTime()) throw conflict('Registration has closed');
  }

  const existing = await ctx.repo.findOne(REG, { tournamentId: id, playerId });
  if (existing && existing.status !== 'withdrawn' && existing.status !== 'rejected') {
    throw conflict('Player is already registered for this tournament');
  }

  const confirmed = await ctx.repo.count(REG, { tournamentId: id, status: 'confirmed' });
  const status = confirmed >= (t.capacity ?? 64) ? 'waitlisted' : 'confirmed';
  const row = existing
    ? await ctx.repo.update(REG, existing.id, { status, waitlistPosition: status === 'waitlisted' ? confirmed + 1 : null, registeredAt: ctx.now() })
    : await ctx.repo.insert(REG, {
        id: ctx.newId(),
        tournamentId: id,
        playerId,
        status,
        waitlistPosition: status === 'waitlisted' ? confirmed + 1 : null,
        addedManually: !!opts.manual,
        registeredBy: userId,
        registeredAt: ctx.now(),
      });
  await ctx.audit.record({ action: 'tournament.registration.create', actorId: userId, targetType: 'registration', targetId: row.id, detail: { tournamentId: id, playerId, status } });
  return row;
}

export async function withdraw(ctx: FeatureContext, actorId: string, id: string, playerId: string) {
  const reg = await ctx.repo.findOne(REG, { tournamentId: id, playerId });
  if (!reg) throw notFound('Registration not found');
  if (reg.status === 'withdrawn') throw conflict('Already withdrawn');
  const updated = await ctx.repo.update(REG, reg.id, { status: 'withdrawn', withdrawnAt: ctx.now() });
  // promote the first waitlisted player
  const wait = await ctx.repo.find(REG, { tournamentId: id, status: 'waitlisted' }, { orderBy: 'waitlistPosition' });
  if (wait.length) await ctx.repo.update(REG, wait[0].id, { status: 'confirmed', waitlistPosition: null });
  await ctx.audit.record({ action: 'tournament.registration.withdraw', actorId, targetType: 'registration', targetId: reg.id });
  return updated;
}

export async function proposeSchedule(ctx: FeatureContext, actorId: string, id: string, rounds?: Array<{ round: number; startsAt: string }>) {
  const t = await ctx.repo.get(TABLE, id);
  if (!t) throw notFound('Tournament not found');
  const count = await ctx.repo.count(REG, { tournamentId: id, status: 'confirmed' });
  if (count < 2) throw conflict('At least two confirmed players are required before scheduling');
  const plan = rounds?.length
    ? rounds
    : Array.from({ length: t.rounds ?? 5 }, (_, i) => ({
        round: i + 1,
        startsAt: new Date(new Date(t.startsAt || ctx.now()).getTime() + i * 24 * 3600 * 1000).toISOString(),
      }));
  const updated = await ctx.repo.update(TABLE, id, {
    schedule: plan,
    scheduleStatus: 'proposed',
    scheduleProposedBy: actorId,
    scheduleProposedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'tournament.schedule.propose', actorId, targetType: 'tournament', targetId: id });
  return updated;
}

export async function approveSchedule(ctx: FeatureContext, actorId: string, id: string, authority: 'president' | 'admin') {
  const t = await ctx.repo.get(TABLE, id);
  if (!t) throw notFound('Tournament not found');
  if (t.scheduleStatus !== 'proposed') throw conflict('There is no proposed schedule awaiting approval');
  if (t.scheduleProposedBy && t.scheduleProposedBy === actorId) {
    throw forbidden('Separation of duties: the proposer cannot approve their own schedule');
  }
  const updated = await ctx.repo.update(TABLE, id, {
    scheduleStatus: 'approved',
    scheduleApprovedBy: actorId,
    scheduleApprovedAs: authority,
    scheduleApprovedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'tournament.schedule.approve', actorId, targetType: 'tournament', targetId: id, detail: { authority } });
  return updated;
}

export async function listTournaments(ctx: FeatureContext, filter: { status?: string } = {}) {
  return ctx.repo.find(TABLE, filter.status ? { status: filter.status } : {}, { orderBy: 'createdAt', desc: true });
}

export async function getTournament(ctx: FeatureContext, id: string) {
  const t = await ctx.repo.get(TABLE, id);
  if (!t) throw notFound('Tournament not found');
  const registrations = await ctx.repo.find(REG, { tournamentId: id }, { orderBy: 'registeredAt' });
  return { ...t, registrations, confirmedCount: registrations.filter((r: Row) => r.status === 'confirmed').length };
}
