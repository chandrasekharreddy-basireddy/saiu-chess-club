import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 09 — Chess Academy', () => {
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

  async function publishedCourse(coachA: any, coachB: any, title: string, lessonTitles: string[], prerequisites: string[] = []) {
    const course = (await (await post('/api/v1/academy/courses', coachA.headers, { title, level: 'beginner', prerequisites })).json()).data;
    const lessons: any[] = [];
    for (const t of lessonTitles) {
      lessons.push((await (await post(`/api/v1/academy/courses/${course.id}/lessons`, coachA.headers, { title: t })).json()).data);
    }
    const pub = await post(`/api/v1/academy/courses/${course.id}/publish`, coachB.headers);
    expect(pub.status).toBe(200);
    return { course, lessons };
  }

  it('refuses course authoring to a plain member', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/academy/courses', member.headers, { title: 'Sneaky', level: 'beginner' });
    expect(res.status).toBe(403);
  });

  it('requires an independent reviewer to publish authored content', async () => {
    const coachA = await seedUser(ctx, { roles: ['coach'] });
    const coachB = await seedUser(ctx, { roles: ['coach'] });
    const course = (await (await post('/api/v1/academy/courses', coachA.headers, { title: 'Fundamentals', level: 'beginner' })).json()).data;
    await post(`/api/v1/academy/courses/${course.id}/lessons`, coachA.headers, { title: 'The board' });

    const selfPublish = await post(`/api/v1/academy/courses/${course.id}/publish`, coachA.headers);
    expect(selfPublish.status).toBe(403);

    const reviewed = await post(`/api/v1/academy/courses/${course.id}/publish`, coachB.headers);
    expect(reviewed.status).toBe(200);
    const body = (await reviewed.json()).data;
    expect(body.status).toBe('published');
    expect(body.version).toBe(2);
  });

  it('gates lessons so learners must progress in order and can resume', async () => {
    const coachA = await seedUser(ctx, { roles: ['coach'] });
    const coachB = await seedUser(ctx, { roles: ['coach'] });
    const learner = await seedUser(ctx, { roles: ['member'] });
    const { course, lessons } = await publishedCourse(coachA, coachB, 'Fundamentals', ['The board', 'Piece moves']);

    expect((await post(`/api/v1/academy/courses/${course.id}/enroll`, learner.headers)).status).toBe(201);
    expect((await post(`/api/v1/academy/lessons/${lessons[1].id}/complete`, learner.headers)).status).toBe(409);

    const first = await post(`/api/v1/academy/lessons/${lessons[0].id}/complete`, learner.headers);
    expect(first.status).toBe(200);
    expect((await first.json()).data.courseProgress.nextLessonId).toBe(lessons[1].id);

    expect((await post(`/api/v1/academy/lessons/${lessons[1].id}/complete`, learner.headers)).status).toBe(200);
    const mine = (await (await get('/api/v1/academy/me/progress', learner.headers)).json()).data;
    expect(mine.courses[0].completed).toBe(2);
    expect(mine.courses[0].nextLessonId).toBeNull();
  });

  it('enforces course prerequisites before enrolment', async () => {
    const coachA = await seedUser(ctx, { roles: ['coach'] });
    const coachB = await seedUser(ctx, { roles: ['coach'] });
    const learner = await seedUser(ctx, { roles: ['member'] });
    const beginner = await publishedCourse(coachA, coachB, 'Fundamentals', ['The board']);
    const advanced = await publishedCourse(coachA, coachB, 'Tactics', ['Pins', 'Forks'], [beginner.course.id]);

    expect((await post(`/api/v1/academy/courses/${advanced.course.id}/enroll`, learner.headers)).status).toBe(409);

    await post(`/api/v1/academy/courses/${beginner.course.id}/enroll`, learner.headers);
    await post(`/api/v1/academy/lessons/${beginner.lessons[0].id}/complete`, learner.headers);
    expect((await post(`/api/v1/academy/courses/${advanced.course.id}/enroll`, learner.headers)).status).toBe(201);
  });

  it('keeps learning progress private to the learner and an assigned coach', async () => {
    const coachA = await seedUser(ctx, { roles: ['coach'] });
    const coachB = await seedUser(ctx, { roles: ['coach'] });
    const learner = await seedUser(ctx, { roles: ['member'] });
    const stranger = await seedUser(ctx, { roles: ['member'] });
    const { course } = await publishedCourse(coachA, coachB, 'Endgames', ['King and pawn']);
    await post(`/api/v1/academy/courses/${course.id}/enroll`, learner.headers);

    expect((await get(`/api/v1/academy/learners/${learner.user.id}/progress`, stranger.headers)).status).toBe(403);

    await post(`/api/v1/academy/coaches/${coachA.user.id}/learners`, coachA.headers, { learnerId: learner.user.id });
    const asCoach = await get(`/api/v1/academy/learners/${learner.user.id}/progress`, coachA.headers);
    expect(asCoach.status).toBe(200);
    expect((await asCoach.json()).data.userId).toBe(learner.user.id);
  });

  it('hides unpublished courses from the public catalogue and records puzzle attempts', async () => {
    const coachA = await seedUser(ctx, { roles: ['coach'] });
    const coachB = await seedUser(ctx, { roles: ['coach'] });
    await publishedCourse(coachA, coachB, 'Openings', ['Principles']);
    await post('/api/v1/academy/courses', coachA.headers, { title: 'Secret draft', level: 'advanced' });

    const list = (await (await get('/api/v1/academy/courses')).json()).data;
    expect(list.map((c: any) => c.title)).toEqual(['Openings']);

    const learner = await seedUser(ctx, { roles: ['member'] });
    const attempt = await post('/api/v1/academy/puzzles/p-101/attempts', learner.headers, { solved: true, topic: 'pins' });
    expect(attempt.status).toBe(201);
    expect((await attempt.json()).data.topicProgress.accuracy).toBe(100);
  });
});
