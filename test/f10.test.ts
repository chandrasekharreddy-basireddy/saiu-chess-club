import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 10 — Chess Coaching & Mentorship', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any = {}, json?: any) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  async function setup() {
    const coach1 = await seedUser(ctx, { roles: ['coach'] });
    const coach2 = await seedUser(ctx, { roles: ['coach'] });
    const student = await seedUser(ctx, { roles: ['member'] });
    const other = await seedUser(ctx, { roles: ['member'] });

    const offering = (
      await (
        await post('/api/v1/coaching/offerings', coach1.headers, {
          title: 'Rapid improvement clinic',
          type: 'one_to_one',
          venueType: 'online',
          meetingLink: 'https://meet.example.org/saiu-coach-1',
        })
      ).json()
    ).data;
    await post('/api/v1/coaching/assignments', coach1.headers, { coachId: coach1.user.id, studentId: student.user.id });
    return { coach1, coach2, student, other, offering };
  }

  it('creates a coaching offering for a coach and refuses a plain member', async () => {
    const coach = await seedUser(ctx, { roles: ['coach'] });
    const res = await post('/api/v1/coaching/offerings', coach.headers, { title: 'Endgame lab', type: 'group', capacity: 6 });
    expect(res.status).toBe(201);
    expect((await res.json()).data.capacity).toBe(6);

    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await post('/api/v1/coaching/offerings', member.headers, { title: 'Nope' })).status).toBe(403);
  });

  it('never exposes meeting links in the public catalogue', async () => {
    const { offering } = await setup();
    const list = (await (await get('/api/v1/coaching/offerings')).json()).data;
    const row = list.find((o: any) => o.id === offering.id);
    expect(row.meetingLink).toBeUndefined();
    expect(row.meetingAvailable).toBe(true);
  });

  it('lets the assigned coach confirm a booking and only that coach', async () => {
    const { coach1, coach2, student, offering } = await setup();
    const booking = await post('/api/v1/coaching/sessions', student.headers, {
      offeringId: offering.id,
      startsAt: '2026-02-10T10:00:00.000Z',
      endsAt: '2026-02-10T11:00:00.000Z',
    });
    expect(booking.status).toBe(201);
    const sessionId = (await booking.json()).data.id;

    expect((await post(`/api/v1/coaching/sessions/${sessionId}/confirm`, coach2.headers)).status).toBe(403);

    const confirmed = await post(`/api/v1/coaching/sessions/${sessionId}/confirm`, coach1.headers);
    expect(confirmed.status).toBe(200);
    const body = (await confirmed.json()).data;
    expect(body.session.status).toBe('confirmed');
    expect(body.calendar.sessionId).toBe(sessionId);
    expect(body.notification.status).toBe('queued');
  });

  it('rejects a booking that overlaps the coach existing session', async () => {
    const { coach1, student, other, offering } = await setup();
    await post('/api/v1/coaching/assignments', coach1.headers, { coachId: coach1.user.id, studentId: other.user.id });
    await post('/api/v1/coaching/sessions', student.headers, {
      offeringId: offering.id,
      startsAt: '2026-02-11T10:00:00.000Z',
      endsAt: '2026-02-11T11:00:00.000Z',
    });
    const clash = await post('/api/v1/coaching/sessions', other.headers, {
      offeringId: offering.id,
      startsAt: '2026-02-11T10:30:00.000Z',
      endsAt: '2026-02-11T11:30:00.000Z',
    });
    expect(clash.status).toBe(409);
  });

  it('requires explicit note visibility and hides private notes from the student', async () => {
    const { coach1, student, other, offering } = await setup();
    const sessionId = (
      await (
        await post('/api/v1/coaching/sessions', student.headers, {
          offeringId: offering.id,
          startsAt: '2026-02-12T09:00:00.000Z',
          endsAt: '2026-02-12T10:00:00.000Z',
        })
      ).json()
    ).data.id;
    await post(`/api/v1/coaching/sessions/${sessionId}/confirm`, coach1.headers);

    expect((await post(`/api/v1/coaching/sessions/${sessionId}/notes`, coach1.headers, { text: 'No visibility given' })).status).toBe(400);
    expect(
      (await post(`/api/v1/coaching/sessions/${sessionId}/notes`, coach1.headers, { text: 'Work on rook endings', visibility: 'private' })).status,
    ).toBe(201);

    const asStudent = (await (await get(`/api/v1/coaching/sessions/${sessionId}`, student.headers)).json()).data;
    expect(asStudent.notes).toHaveLength(0);
    expect((await get(`/api/v1/coaching/sessions/${sessionId}`, other.headers)).status).toBe(403);
  });

  it('records completion once and keeps coach scope limited to assigned learners', async () => {
    const { coach1, coach2, student, offering } = await setup();
    const sessionId = (
      await (
        await post('/api/v1/coaching/sessions', student.headers, {
          offeringId: offering.id,
          startsAt: '2026-02-13T09:00:00.000Z',
          endsAt: '2026-02-13T10:00:00.000Z',
        })
      ).json()
    ).data.id;
    await post(`/api/v1/coaching/sessions/${sessionId}/confirm`, coach1.headers);

    expect((await post(`/api/v1/coaching/sessions/${sessionId}/complete`, coach1.headers)).status).toBe(200);
    expect((await post(`/api/v1/coaching/sessions/${sessionId}/complete`, coach1.headers)).status).toBe(409);

    const mine = (await (await get(`/api/v1/coaching/coach/${coach1.user.id}/students`, coach1.headers)).json()).data;
    expect(mine).toHaveLength(1);
    expect((await get(`/api/v1/coaching/coach/${coach1.user.id}/students`, coach2.headers)).status).toBe(403);
  });
});
