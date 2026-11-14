import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  app.get('/courses', async (c) => {
    const s = c.get('session') as any;
    return ok(
      c,
      await svc.listCourses(ctx, s, {
        level: c.req.query('level'),
        includeDrafts: c.req.query('includeDrafts') === '1',
      }),
    );
  });

  app.post('/courses', requireAuth(), requirePermission('academy.content.publish'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createCourse(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/me/progress', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.myProgress(ctx, s.userId));
  });

  app.get('/resources', async (c) => ok(c, await svc.listResources(ctx)));

  app.post('/resources', requireAuth(), requirePermission('academy.content.publish'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.createResource(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/courses/:id', async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getCourse(ctx, s, c.req.param('id')));
  });

  app.post('/courses/:id/lessons', requireAuth(), requirePermission('academy.content.publish'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addLesson(ctx, s.userId, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/courses/:id/publish', requireAuth(), requirePermission('academy.content.publish'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.publishCourse(ctx, s.userId, c.req.param('id')));
  });

  app.post('/courses/:id/enroll', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.enroll(ctx, s.userId, c.req.param('id')));
  });

  app.post('/lessons/:lessonId/complete', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.completeLesson(ctx, s.userId, c.req.param('lessonId')));
  });

  app.get('/learners/:userId/progress', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.learnerProgress(ctx, s, c.req.param('userId')));
  });

  app.post('/coaches/:coachId/learners', requireAuth(), requirePermission('academy.content.publish'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.linkCoach(ctx, s.userId, c.req.param('coachId'), c.get('parsedBody') as any));
  });

  app.post('/puzzles/:puzzleId/attempts', requireAuth(), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.recordPuzzleAttempt(ctx, s.userId, c.req.param('puzzleId'), c.get('parsedBody') as any));
  });
}
