import type { FeatureContext } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 09 — Chess Academy
 *
 * Tables (created implicitly on first insert):
 *   academy_courses          learning paths / courses with level, prerequisites, author, version
 *   academy_lessons          ordered lessons inside a course (author, version, publication state)
 *   academy_enrollments      learner enrolment per course
 *   academy_progress         per-lesson completion (resumable, private to the learner + coach)
 *   academy_puzzle_attempts  puzzle attempts and topic progress
 *   academy_resources        recommended resources with recorded source/licence
 *   academy_coach_links      explicit coach -> learner links (coach sees assigned learners only)
 *
 * Content governance: draft -> review -> published -> archived, with author/reviewer/version
 * retained. Publishing requires the review permission and a reviewer who is not the author.
 * Learning works entirely without AI: content is stored, versioned and read offline.
 */

export const COURSES = 'academy_courses';
export const LESSONS = 'academy_lessons';
export const ENROLLMENTS = 'academy_enrollments';
export const PROGRESS = 'academy_progress';
export const ATTEMPTS = 'academy_puzzle_attempts';
export const RESOURCES = 'academy_resources';
export const COACH_LINKS = 'academy_coach_links';

export const LEVELS = ['beginner', 'intermediate', 'advanced'];
export const STATES = ['draft', 'review', 'published', 'archived'];

function sod(actorId: string, otherId: string | null | undefined, what: string) {
  try {
    assertNotSelfApproval(actorId, String(otherId ?? ''), what);
  } catch (e: any) {
    throw forbidden(e?.message || 'Separation of duties violation');
  }
}

export async function createCourse(ctx: FeatureContext, actorId: string, input: any) {
  const title = String(input?.title ?? '').trim();
  if (!title) throw badRequest('Course title is required');
  const level = String(input?.level ?? 'beginner');
  if (!LEVELS.includes(level)) throw badRequest(`level must be one of: ${LEVELS.join(', ')}`);
  const prerequisites = Array.isArray(input?.prerequisites) ? input.prerequisites.map((p: any) => String(p)) : [];

  const course = await ctx.repo.insert(COURSES, {
    id: ctx.newId(),
    title,
    summary: input?.summary ?? null,
    level,
    prerequisites,
    status: 'draft',
    version: 1,
    authorId: actorId,
    reviewerId: null,
    source: input?.source ?? null,
    licence: input?.licence ?? 'original',
    publishedAt: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'academy.course.create', actorId, targetType: 'academy_course', targetId: course.id, detail: { title, level } });
  return course;
}

export async function addLesson(ctx: FeatureContext, actorId: string, courseId: string, input: any) {
  const course = await ctx.repo.get(COURSES, courseId);
  if (!course) throw notFound('Course not found');
  if (course.status === 'archived') throw conflict('Archived courses cannot be edited');
  const title = String(input?.title ?? '').trim();
  if (!title) throw badRequest('Lesson title is required');
  const existing = await ctx.repo.find(LESSONS, { courseId });
  const order = input?.order === undefined ? existing.length + 1 : Number(input.order);
  if (!Number.isInteger(order) || order < 1) throw badRequest('order must be a positive integer');
  if (existing.some((l: any) => Number(l.order) === order)) throw conflict(`A lesson with order ${order} already exists in this course`);

  const lesson = await ctx.repo.insert(LESSONS, {
    id: ctx.newId(),
    courseId,
    title,
    order,
    content: input?.content ?? null,
    kind: input?.kind ?? 'lesson',
    status: 'draft',
    version: 1,
    authorId: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'academy.lesson.create', actorId, targetType: 'academy_lesson', targetId: lesson.id, detail: { courseId, order } });
  return lesson;
}

/** Publishing requires the review permission AND a reviewer who is not the author. */
export async function publishCourse(ctx: FeatureContext, actorId: string, courseId: string) {
  const course = await ctx.repo.get(COURSES, courseId);
  if (!course) throw notFound('Course not found');
  if (course.status === 'published') throw conflict('Course is already published');
  if (course.status === 'archived') throw conflict('Archived courses cannot be published');
  const lessons = await ctx.repo.find(LESSONS, { courseId });
  if (!lessons.length) throw conflict('A course needs at least one lesson before it can be published');
  sod(actorId, course.authorId, 'content you authored');

  const at = ctx.now();
  for (const l of lessons) await ctx.repo.update(LESSONS, l.id, { status: 'published', reviewerId: actorId, publishedAt: at });
  const updated = await ctx.repo.update(COURSES, courseId, {
    status: 'published',
    reviewerId: actorId,
    publishedAt: at,
    version: Number(course.version ?? 1) + 1,
  });
  await ctx.audit.record({ action: 'academy.course.publish', actorId, targetType: 'academy_course', targetId: courseId, detail: { authorId: course.authorId } });
  return updated;
}

function canAuthor(session: any) {
  const perms: string[] = session?.permissions || [];
  return perms.includes('academy.content.publish') || perms.includes('*');
}

export async function listCourses(ctx: FeatureContext, session: any, q: { level?: string; includeDrafts?: boolean } = {}) {
  const all = await ctx.repo.find(COURSES, {});
  const author = canAuthor(session);
  const visible = all.filter((c: any) => {
    if (q.includeDrafts && author) return true;
    if (c.status !== 'published') return false;
    if (q.level && c.level !== q.level) return false;
    return true;
  });
  return visible.sort((a: any, b: any) => String(a.title).localeCompare(String(b.title)));
}

export async function getCourse(ctx: FeatureContext, session: any, courseId: string) {
  const course = await ctx.repo.get(COURSES, courseId);
  if (!course) throw notFound('Course not found');
  const isAuthor = session && (course.authorId === session.userId || canAuthor(session));
  if (course.status !== 'published' && !isAuthor) throw notFound('Course not found');
  const lessons = (await ctx.repo.find(LESSONS, { courseId })).sort((a: any, b: any) => Number(a.order) - Number(b.order));
  return { ...course, lessons };
}

export async function completedCourse(ctx: FeatureContext, userId: string, courseId: string) {
  const lessons = await ctx.repo.find(LESSONS, { courseId });
  if (!lessons.length) return false;
  const progress = await ctx.repo.find(PROGRESS, { userId, courseId, status: 'completed' });
  const done = new Set(progress.map((p) => p.lessonId));
  return lessons.every((l) => done.has(l.id));
}

export async function enroll(ctx: FeatureContext, userId: string, courseId: string) {
  const course = await ctx.repo.get(COURSES, courseId);
  if (!course) throw notFound('Course not found');
  if (course.status !== 'published') throw conflict('Only published courses can be joined');

  const existing = await ctx.repo.findOne(ENROLLMENTS, { courseId, userId });
  if (existing && existing.status === 'active') throw conflict('Already enrolled in this course');

  const prerequisites: string[] = course.prerequisites || [];
  for (const prereqId of prerequisites) {
    const done = await completedCourse(ctx, userId, prereqId);
    if (!done) throw conflict('Prerequisite course has not been completed', { prerequisiteCourseId: prereqId });
  }

  const row = existing
    ? await ctx.repo.update(ENROLLMENTS, existing.id, { status: 'active', enrolledAt: ctx.now() })
    : await ctx.repo.insert(ENROLLMENTS, { id: ctx.newId(), courseId, userId, status: 'active', enrolledAt: ctx.now() });
  await ctx.audit.record({ action: 'academy.course.enroll', actorId: userId, targetType: 'academy_enrollment', targetId: (row as any).id, detail: { courseId } });
  return row;
}

/** Sequential gating: a lesson unlocks only when every earlier lesson is completed. */
export async function completeLesson(ctx: FeatureContext, userId: string, lessonId: string) {
  const lesson = await ctx.repo.get(LESSONS, lessonId);
  if (!lesson) throw notFound('Lesson not found');
  const courseId = lesson.courseId;

  const enrollment = await ctx.repo.findOne(ENROLLMENTS, { courseId, userId });
  if (!enrollment || enrollment.status !== 'active') throw conflict('Join the course before completing lessons');

  const lessons = (await ctx.repo.find(LESSONS, { courseId })).sort((a: any, b: any) => Number(a.order) - Number(b.order));
  const progress = await ctx.repo.find(PROGRESS, { userId, courseId, status: 'completed' });
  const done = new Set(progress.map((p) => p.lessonId));

  const earlier = lessons.filter((l: any) => Number(l.order) < Number(lesson.order));
  const blocked = earlier.filter((l: any) => !done.has(l.id));
  if (blocked.length) throw conflict('Complete earlier lessons first', { blockedLessonId: blocked[0].id });

  let row = await ctx.repo.findOne(PROGRESS, { lessonId, userId });
  if (row) {
    row = await ctx.repo.update(PROGRESS, row.id, { status: 'completed', completedAt: ctx.now() });
  } else {
    row = await ctx.repo.insert(PROGRESS, {
      id: ctx.newId(),
      courseId,
      lessonId,
      userId,
      status: 'completed',
      score: null,
      completedAt: ctx.now(),
    });
  }
  await ctx.audit.record({ action: 'academy.lesson.complete', actorId: userId, targetType: 'academy_progress', targetId: (row as any).id, detail: { courseId, lessonId } });

  const doneAfter = new Set([...done, lessonId]);
  const next = lessons.find((l: any) => !doneAfter.has(l.id)) || null;
  return {
    progress: row,
    courseProgress: { courseId, completed: doneAfter.size, total: lessons.length, nextLessonId: next ? next.id : null },
  };
}

export async function myProgress(ctx: FeatureContext, userId: string) {
  const rows = await ctx.repo.find(PROGRESS, { userId, status: 'completed' });
  const enrollments = await ctx.repo.find(ENROLLMENTS, { userId, status: 'active' });
  const courses = [];
  for (const e of enrollments) {
    const lessons = await ctx.repo.find(LESSONS, { courseId: e.courseId });
    const done = rows.filter((r) => r.courseId === e.courseId).map((r) => r.lessonId);
    const ordered = lessons.slice().sort((a: any, b: any) => Number(a.order) - Number(b.order));
    const next = ordered.find((l: any) => !done.includes(l.id)) || null;
    courses.push({ courseId: e.courseId, completed: done.length, total: lessons.length, nextLessonId: next ? next.id : null });
  }
  return { userId, completedLessons: rows.length, courses };
}

async function assertCanViewLearner(ctx: FeatureContext, session: any, learnerId: string) {
  if (session.userId === learnerId) return;
  if ((session.permissions || []).includes('*')) return;
  const link = await ctx.repo.findOne(COACH_LINKS, { coachId: session.userId, learnerId, status: 'active' });
  if (!link) throw forbidden('Learning progress is private; you may only view your own or an assigned learner');
}

/** Private by default: only the learner or an explicitly linked coach may read it. */
export async function learnerProgress(ctx: FeatureContext, session: any, learnerId: string) {
  await assertCanViewLearner(ctx, session, learnerId);
  return myProgress(ctx, learnerId);
}

export async function linkCoach(ctx: FeatureContext, actorId: string, coachId: string, input: any) {
  const learnerId = String(input?.learnerId ?? '');
  if (!learnerId) throw badRequest('learnerId is required');
  const existing = await ctx.repo.findOne(COACH_LINKS, { coachId, learnerId });
  if (existing && existing.status === 'active') throw conflict('Coach is already linked to this learner');
  const row = existing
    ? await ctx.repo.update(COACH_LINKS, existing.id, { status: 'active', createdBy: actorId })
    : await ctx.repo.insert(COACH_LINKS, { id: ctx.newId(), coachId, learnerId, status: 'active', createdBy: actorId, createdAt: ctx.now() });
  await ctx.audit.record({ action: 'academy.coach.link', actorId, targetType: 'academy_coach_link', targetId: (row as any).id, detail: { coachId, learnerId } });
  return row;
}

export async function recordPuzzleAttempt(ctx: FeatureContext, userId: string, puzzleId: string, input: any) {
  if (!puzzleId) throw badRequest('puzzleId is required');
  if (typeof input?.solved !== 'boolean') throw badRequest('solved must be a boolean');
  const attempt = await ctx.repo.insert(ATTEMPTS, {
    id: ctx.newId(),
    puzzleId: String(puzzleId),
    userId,
    topic: input?.topic ? String(input.topic) : 'tactics',
    solved: input.solved,
    at: ctx.now(),
  });
  const mine = await ctx.repo.find(ATTEMPTS, { userId });
  const topic = attempt.topic;
  const topicRows = mine.filter((a) => a.topic === topic);
  await ctx.audit.record({ action: 'academy.puzzle.attempt', actorId: userId, targetType: 'academy_puzzle_attempt', targetId: attempt.id, detail: { puzzleId, solved: input.solved } });
  return {
    attempt,
    topicProgress: {
      topic,
      attempts: topicRows.length,
      solved: topicRows.filter((a) => a.solved).length,
      accuracy: topicRows.length ? Math.round((topicRows.filter((a) => a.solved).length / topicRows.length) * 100) : 0,
    },
  };
}

export async function createResource(ctx: FeatureContext, actorId: string, input: any) {
  const title = String(input?.title ?? '').trim();
  if (!title) throw badRequest('Resource title is required');
  const licence = String(input?.licence ?? '').trim();
  if (!licence) throw badRequest('A source licence must be recorded for every external resource');
  const resource = await ctx.repo.insert(RESOURCES, {
    id: ctx.newId(),
    title,
    url: input?.url ?? null,
    licence,
    source: input?.source ?? null,
    status: 'published',
    authorId: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'academy.resource.create', actorId, targetType: 'academy_resource', targetId: resource.id, detail: { title, licence } });
  return resource;
}

export async function listResources(ctx: FeatureContext) {
  return ctx.repo.find(RESOURCES, { status: 'published' }, { orderBy: 'createdAt', desc: true });
}
