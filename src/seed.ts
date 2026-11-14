/**
 * Demo seed for local development (SEED_DEMO=1 npm run dev).
 * Never runs in production unless explicitly enabled.
 */
import type { FeatureContext, Role } from './core/types.js';
import { hashPassword } from './core/auth.js';
import { permissionsFor } from './core/permissions.js';
import { createTournament, openRegistration, register, proposeSchedule } from './features/f01-tournament-registration/service.js';

const PASSWORD = 'saiu-chess-2026';

async function makeUser(ctx: FeatureContext, name: string, email: string, roles: Role[]) {
  const id = ctx.newId();
  await ctx.repo.insert('users', {
    id,
    name,
    email,
    roles,
    permissions: permissionsFor(roles),
    state: 'active',
    emailVerified: true,
    passwordHash: await hashPassword(PASSWORD),
    createdAt: ctx.now(),
  });
  return id;
}

export async function seedDemo(ctx: FeatureContext) {
  const existing = await ctx.repo.count('users');
  if (existing > 0) return { seeded: false };

  const president = await makeUser(ctx, 'Ananya Rao', 'president@saiuniversity.edu.in', ['president']);
  const organizer = await makeUser(ctx, 'Vikram Iyer', 'organizer@saiuniversity.edu.in', ['organizer']);
  await makeUser(ctx, 'Admin', 'admin@saiuniversity.edu.in', ['administrator']);
  const players = [];
  for (const [name, email] of [
    ['Rahul Menon', 'rahul@saiuniversity.edu.in'],
    ['Sneha Kulkarni', 'sneha@saiuniversity.edu.in'],
    ['Arjun Nair', 'arjun@saiuniversity.edu.in'],
    ['Divya Sharma', 'divya@saiuniversity.edu.in'],
  ] as const) {
    players.push(await makeUser(ctx, name, email, ['member']));
  }

  const t1 = await createTournament(ctx, organizer, {
    name: 'SaiU Open 2026',
    format: 'swiss',
    rounds: 6,
    capacity: 64,
    startsAt: '2026-12-05T04:30:00.000Z',
    venue: 'Central Library Hall',
  });
  await openRegistration(ctx, organizer, t1.id);
  for (const p of players) await register(ctx, p, t1.id);

  const t2 = await createTournament(ctx, organizer, {
    name: 'Freshers Blitz Night',
    format: 'arena',
    rounds: 9,
    capacity: 32,
    startsAt: '2026-11-22T13:00:00.000Z',
    venue: 'Student Centre',
  });
  await openRegistration(ctx, organizer, t2.id);
  for (const p of players.slice(0, 3)) await register(ctx, p, t2.id);

  const t3 = await createTournament(ctx, organizer, {
    name: 'Inter-Department Cup',
    format: 'round_robin',
    rounds: 5,
    capacity: 20,
    startsAt: '2027-01-18T04:30:00.000Z',
    venue: 'Auditorium Annexe',
  });
  await openRegistration(ctx, organizer, t3.id);
  for (const p of players) await register(ctx, p, t3.id);
  await proposeSchedule(ctx, organizer, t3.id);

  return { seeded: true, president, organizer, tournaments: [t1.id, t2.id, t3.id], password: PASSWORD };
}
