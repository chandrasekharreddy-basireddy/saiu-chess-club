import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { hasPermission } from '../../core/permissions.js';

/**
 * Feature 35 — Live Match Commentary.
 *
 * Tables (created implicitly by the first insert):
 *   commentary_entries      durable, ordered text updates for a match (seq is monotonic)
 *   commentary_assignments  which users may commentate a given match
 *   commentary_edits        correction history — every edit keeps the previous text
 *   commentary_settings     per-match spectator delay configuration
 *
 * Rules enforced here:
 *  - only authorized commentators (holders of `commentary.publish` or an explicit
 *    match assignment) may post, edit or delete;
 *  - entries are persisted and strictly ordered by a monotonic per-match sequence;
 *  - the spectator feed is delayed server-side (configured per match, default 60s) —
 *    the delay is applied here, never by the client;
 *  - corrections append to the edit history, deletions are soft so the archive stays
 *    auditable;
 *  - commentary is text only — there is no video/streaming capability;
 *  - entries must not carry hidden pairings or private player data.
 */

export const ENTRY = 'commentary_entries';
export const ASSIGNMENT = 'commentary_assignments';
export const EDIT = 'commentary_edits';
export const SETTINGS = 'commentary_settings';

export const KINDS = ['note', 'highlight', 'annotation', 'correction'];
export const DEFAULT_DELAY_SECONDS = 60;
const FORBIDDEN_FIELDS = ['hiddenPairing', 'hiddenPairings', 'privateData', 'playerContact', 'playerEmail'];

function isModerator(session: any): boolean {
  return hasPermission(session, 'community.moderate') || hasPermission(session, 'tournament.manage');
}

async function assignmentFor(ctx: FeatureContext, matchId: string, userId: string) {
  return ctx.repo.findOne(ASSIGNMENT, { matchId, userId, status: 'active' });
}

export async function isCommentator(ctx: FeatureContext, session: any, matchId: string): Promise<boolean> {
  if (!session) return false;
  if (hasPermission(session, 'commentary.publish')) return true;
  const assigned = await assignmentFor(ctx, matchId, session.userId);
  return !!assigned;
}

export async function assignCommentator(ctx: FeatureContext, actorId: string, matchId: string, input: any = {}) {
  const userId = (input.userId || '').toString();
  if (!userId) throw badRequest('userId is required');
  const user = await ctx.repo.get('users', userId);
  if (!user) throw notFound('User not found');
  const displayName = (input.displayName || user.name || '').toString().trim();
  if (!displayName) throw badRequest('displayName is required');

  const existing = await ctx.repo.findOne(ASSIGNMENT, { matchId, userId });
  if (existing && existing.status === 'active') throw conflict('This user is already assigned to commentate this match');

  const row = existing
    ? await ctx.repo.update(ASSIGNMENT, existing.id, { status: 'active', displayName, assignedBy: actorId })
    : await ctx.repo.insert(ASSIGNMENT, {
        id: ctx.newId(),
        matchId,
        userId,
        displayName,
        assignedBy: actorId,
        status: 'active',
        createdAt: ctx.now(),
      });
  await ctx.audit.record({
    action: 'commentary.commentator.assign',
    actorId,
    targetType: 'match',
    targetId: matchId,
    detail: { userId, displayName },
  });
  return row;
}

async function displayNameFor(ctx: FeatureContext, session: any, matchId: string, provided?: string): Promise<string> {
  if (provided && provided.toString().trim()) return provided.toString().trim().slice(0, 80);
  const assigned = await assignmentFor(ctx, matchId, session.userId);
  if (assigned?.displayName) return assigned.displayName;
  const user = await ctx.repo.get('users', session.userId);
  return (user?.name || 'Commentator').toString().slice(0, 80);
}

export async function postEntry(ctx: FeatureContext, session: any, matchId: string, input: any = {}) {
  if (!session) throw forbidden('Sign in as an authorized commentator to post');
  if (!(await isCommentator(ctx, session, matchId))) {
    throw forbidden('Only assigned commentators can post commentary for this match');
  }
  for (const field of FORBIDDEN_FIELDS) {
    if (input[field] !== undefined) {
      throw badRequest('Commentary must not expose hidden pairings or private player data');
    }
  }

  const text = (input.text || '').toString().trim();
  if (!text) throw badRequest('Commentary text is required');
  if (text.length > 2000) throw badRequest('Commentary text must be 2000 characters or fewer');

  const kind = (input.kind || 'note').toString().toLowerCase();
  if (!KINDS.includes(kind)) throw badRequest(`kind must be one of ${KINDS.join(', ')}`);

  let moveNumber: number | null = null;
  if (input.moveNumber !== undefined && input.moveNumber !== null) {
    const n = Number(input.moveNumber);
    if (!Number.isInteger(n) || n < 1) throw badRequest('moveNumber must be a positive integer');
    moveNumber = n;
  }

  const existing = await ctx.repo.find(ENTRY, { matchId }, { orderBy: 'seq' });
  const nextSeq = existing.reduce((max: number, e: Row) => Math.max(max, Number(e.seq) || 0), 0) + 1;

  const entry = await ctx.repo.insert(ENTRY, {
    id: ctx.newId(),
    matchId,
    seq: nextSeq,
    text,
    kind,
    moveNumber,
    authorId: session.userId,
    authorDisplayName: await displayNameFor(ctx, session, matchId, input.displayName),
    revision: 1,
    status: 'published',
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'commentary.entry.create',
    actorId: session.userId,
    targetType: 'match',
    targetId: matchId,
    detail: { entryId: entry.id, seq: nextSeq },
  });
  return entry;
}

export async function getDelaySeconds(ctx: FeatureContext, matchId: string): Promise<number> {
  const settings = await ctx.repo.findOne(SETTINGS, { matchId });
  if (!settings) return DEFAULT_DELAY_SECONDS;
  const n = Number(settings.delaySeconds);
  return Number.isFinite(n) ? n : DEFAULT_DELAY_SECONDS;
}

export async function setSettings(ctx: FeatureContext, actorId: string, matchId: string, input: any = {}) {
  const raw = input.delaySeconds;
  const delaySeconds = Number(raw);
  if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 3600) {
    throw badRequest('delaySeconds must be an integer between 0 and 3600');
  }
  const existing = await ctx.repo.findOne(SETTINGS, { matchId });
  const row = existing
    ? await ctx.repo.update(SETTINGS, existing.id, { delaySeconds, updatedBy: actorId })
    : await ctx.repo.insert(SETTINGS, { id: ctx.newId(), matchId, delaySeconds, updatedBy: actorId, createdAt: ctx.now() });
  await ctx.audit.record({
    action: 'commentary.settings.update',
    actorId,
    targetType: 'match',
    targetId: matchId,
    detail: { delaySeconds },
  });
  return row;
}

/** Feed for a match. Non-commentators get the delayed (spectator) view. */
export async function listEntries(ctx: FeatureContext, session: any, matchId: string) {
  const all = await ctx.repo.find(ENTRY, { matchId }, { orderBy: 'seq' });
  const live = all.filter((e) => e.status !== 'deleted');

  const privileged = await isCommentator(ctx, session, matchId);
  if (privileged) {
    return { matchId, delayed: false, delaySeconds: 0, items: live };
  }

  const delaySeconds = await getDelaySeconds(ctx, matchId);
  const cutoff = new Date(ctx.now()).getTime() - delaySeconds * 1000;
  const items = live.filter((e) => new Date(e.createdAt).getTime() <= cutoff);
  return { matchId, delayed: true, delaySeconds, items };
}

export async function archive(ctx: FeatureContext, matchId: string) {
  const all = await ctx.repo.find(ENTRY, { matchId }, { orderBy: 'seq' });
  const items = all.filter((e) => e.status !== 'deleted');
  const edits = await ctx.repo.count(EDIT, { matchId });
  return { matchId, total: items.length, corrections: edits, items };
}

export async function editEntry(ctx: FeatureContext, session: any, entryId: string, input: any = {}) {
  if (!session) throw forbidden('Sign in to edit commentary');
  const entry = await ctx.repo.get(ENTRY, entryId);
  if (!entry) throw notFound('Commentary entry not found');
  if (entry.status === 'deleted') throw conflict('Deleted commentary cannot be edited');

  const allowed = entry.authorId === session.userId || isModerator(session) || hasPermission(session, 'commentary.publish');
  if (!allowed) throw forbidden('Only the author or a moderator can correct this entry');

  const text = (input.text || '').toString().trim();
  if (!text) throw badRequest('Corrected commentary text is required');
  if (text === entry.text) throw conflict('The corrected text is identical to the current text');

  await ctx.repo.insert(EDIT, {
    id: ctx.newId(),
    entryId,
    matchId: entry.matchId,
    revision: entry.revision ?? 1,
    previousText: entry.text,
    newText: text,
    editedBy: session.userId,
    editedAt: ctx.now(),
  });

  const updated = await ctx.repo.update(ENTRY, entryId, {
    text,
    revision: (entry.revision ?? 1) + 1,
    editedAt: ctx.now(),
    editedBy: session.userId,
  });
  await ctx.audit.record({
    action: 'commentary.entry.edit',
    actorId: session.userId,
    targetType: 'match',
    targetId: entry.matchId,
    detail: { entryId, revision: updated?.revision },
  });
  return updated;
}

export async function getEditHistory(ctx: FeatureContext, entryId: string) {
  const entry = await ctx.repo.get(ENTRY, entryId);
  if (!entry) throw notFound('Commentary entry not found');
  const edits = await ctx.repo.find(EDIT, { entryId }, { orderBy: 'revision' });
  return { entryId, currentText: entry.text, revision: entry.revision ?? 1, edits };
}

/** Moderator delete — soft, so the archive and audit trail stay intact. */
export async function deleteEntry(ctx: FeatureContext, session: any, entryId: string) {
  if (!session) throw forbidden('Sign in to moderate commentary');
  const entry = await ctx.repo.get(ENTRY, entryId);
  if (!entry) throw notFound('Commentary entry not found');
  if (entry.status === 'deleted') throw conflict('This commentary entry is already deleted');

  const allowed = isModerator(session) || entry.authorId === session.userId;
  if (!allowed) throw forbidden('Only a moderator or the author can delete this entry');

  const updated = await ctx.repo.update(ENTRY, entryId, {
    status: 'deleted',
    deletedAt: ctx.now(),
    deletedBy: session.userId,
  });
  await ctx.audit.record({
    action: 'commentary.entry.delete',
    actorId: session.userId,
    targetType: 'match',
    targetId: entry.matchId,
    detail: { entryId, seq: entry.seq },
  });
  return updated;
}
