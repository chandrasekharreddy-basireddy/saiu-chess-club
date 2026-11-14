import type { FeatureContext } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, quotaExceeded } from '../../core/errors.js';

/**
 * Feature 07 — Chess Game Analysis & PGN Management
 *
 * Tables (created implicitly on first insert):
 *   analysis_games       imported PGN games owned by a user (headers, movetext, tags, visibility)
 *   analysis_reviews     analysis sessions; always labelled as analysis, never result adjudication
 *   analysis_notes       per-ply study notes on a game
 *   analysis_ai_credits  optional AI-explanation credit balance per user
 *
 * No external libraries: the PGN reader/writer below is implemented in-house. It validates
 * size, headers, tag values, movetext structure, SAN syntax (including promotion-rank legality)
 * and result consistency, and it never evaluates imported content as code.
 *
 * Analysis never mutates official match records or ratings — this module does not import
 * feature 01/06 tables at all, and every review row carries officialResultAffecting: false.
 */

export const GAMES = 'analysis_games';
export const REVIEWS = 'analysis_reviews';
export const NOTES = 'analysis_notes';
export const CREDITS = 'analysis_ai_credits';

export const MAX_PGN_BYTES = 64 * 1024;
export const DEFAULT_AI_CREDITS = 2;
export const VISIBILITIES = ['private', 'club', 'public'] as const;
export const MODES = ['manual', 'engine', 'guided', 'opening', 'comparison'] as const;

const RESULTS = ['1-0', '0-1', '1/2-1/2', '*'];
const REQUIRED_TAGS = ['White', 'Black', 'Result'];
const HEADER_RE = /^\[\s*([A-Za-z0-9_]+)\s+"([^"]*)"\s*\]$/;
const SAN_RE = /^(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?)[+#]?$/;

export interface PgnHeaders {
  [key: string]: string;
}

export interface ParsedPgn {
  headers: PgnHeaders;
  moves: string[];
  result: string;
  plyCount: number;
  fen: string | null;
}

/** Remove control characters (except newline) so imported text can be stored and echoed safely. */
export function sanitizePgn(text: string): string {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** Strip PGN comments {..}, variations (..) and ; line comments, rejecting unbalanced input. */
function stripNoise(src: string): string {
  let out = '';
  let brace = 0;
  let paren = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (brace > 0) {
      if (ch === '}') brace--;
      continue;
    }
    if (paren > 0) {
      if (ch === '(') paren++;
      else if (ch === ')') paren--;
      continue;
    }
    if (ch === '{') {
      brace++;
      continue;
    }
    if (ch === '(') {
      paren++;
      continue;
    }
    if (ch === ';') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    out += ch;
  }
  if (brace > 0) throw badRequest('PGN comment is not closed');
  if (paren > 0) throw badRequest('PGN variation is not closed');
  return out;
}

/**
 * Structural SAN legality:
 *   - token must match the SAN grammar (piece letter, disambiguation, capture, square, promotion)
 *   - a pawn move can never land on rank 1 or 8 without a promotion suffix
 *   - promotion suffix is only allowed on rank 1 or 8
 */
function assertSanToken(token: string, index: number) {
  if (!SAN_RE.test(token)) throw badRequest(`Illegal SAN move "${token}" at ply ${index + 1}`, { token, ply: index + 1 });
  const dest = token.replace(/[+#]$/, '');
  const promo = /=([QRBN])$/.exec(dest);
  const bare = dest.replace(/=[QRBN]$/, '');
  const square = bare.slice(-2);
  const rank = square[1];
  const isPieceMove = /^[KQRBN]/.test(bare);
  if (promo) {
    if (rank !== '1' && rank !== '8') throw badRequest(`Promotion must land on rank 1 or 8: "${token}"`, { token, ply: index + 1 });
  } else if (!isPieceMove && (rank === '1' || rank === '8')) {
    throw badRequest(`Pawn cannot reach rank ${rank} without promotion: "${token}"`, { token, ply: index + 1 });
  }
}

export function parsePgn(raw: string): ParsedPgn {
  if (typeof raw !== 'string') throw badRequest('pgn must be a string');
  if (!raw.trim()) throw badRequest('PGN is empty');
  if (raw.length > MAX_PGN_BYTES) throw badRequest(`PGN exceeds the maximum size of ${MAX_PGN_BYTES} bytes`);
  const text = sanitizePgn(raw);

  const headers: PgnHeaders = {};
  let movetext = '';
  let sawMovetext = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('[')) {
      if (sawMovetext) throw badRequest('PGN header tags must appear before the movetext');
      const m = HEADER_RE.exec(trimmed);
      if (!m) throw badRequest(`Malformed PGN header: ${trimmed.slice(0, 60)}`);
      headers[m[1]] = m[2];
      continue;
    }
    sawMovetext = true;
    movetext += ` ${trimmed}`;
  }

  const missing = REQUIRED_TAGS.filter((t) => headers[t] === undefined);
  if (missing.length) throw badRequest(`PGN is missing required tag(s): ${missing.join(', ')}`, { missing });

  if (!RESULTS.includes(headers.Result)) {
    throw badRequest(`PGN Result tag must be one of: ${RESULTS.join(', ')}`);
  }

  if (headers.FEN !== undefined) {
    const fields = headers.FEN.trim().split(/\s+/);
    if (fields.length < 6) throw badRequest('PGN FEN tag must contain at least 6 fields');
  }

  const tokens = stripNoise(movetext)
    .split(/\s+/)
    .map((t) => t.replace(/\$\d+/g, '').replace(/^\d+\.+/, '').trim())
    .filter((t) => t.length > 0);

  const moves: string[] = [];
  let result = '*';
  let resultAt = -1;

  tokens.forEach((token, i) => {
    if (RESULTS.includes(token)) {
      if (resultAt >= 0) throw badRequest('PGN contains more than one result token');
      result = token;
      resultAt = i;
      return;
    }
    assertSanToken(token, moves.length);
    moves.push(token);
  });

  if (resultAt >= 0 && resultAt !== tokens.length - 1) {
    throw badRequest('PGN result token must terminate the movetext');
  }
  if (!moves.length) throw badRequest('PGN contains no moves');

  if (headers.Result !== '*' && result !== '*' && headers.Result !== result) {
    throw badRequest(`Result tag "${headers.Result}" does not match movetext result "${result}"`);
  }

  return {
    headers,
    moves,
    result: result === '*' ? headers.Result : result,
    plyCount: moves.length,
    fen: headers.FEN ?? null,
  };
}

/** Rebuild a canonical PGN document from a stored game. */
export function serializePgn(game: any): string {
  const headers: PgnHeaders = game.headers || {};
  const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
  const keys = order.filter((k) => headers[k] !== undefined).concat(Object.keys(headers).filter((k) => !order.includes(k)));
  const lines = keys.map((k) => `[${k} "${String(headers[k]).replace(/"/g, "'")}"]`);
  const tokens: string[] = [];
  (game.moves || []).forEach((m: string, i: number) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(m);
  });
  tokens.push(game.result || '*');
  return `${lines.join('\n')}\n\n${tokens.join(' ')}\n`;
}

export interface ImportInput {
  pgn: string;
  filename?: string;
  visibility?: string;
  tags?: string[];
}

export function previewPgn(raw: string) {
  const parsed = parsePgn(raw);
  return {
    valid: true,
    headers: parsed.headers,
    moves: parsed.moves,
    plyCount: parsed.plyCount,
    result: parsed.result,
    fen: parsed.fen,
  };
}

export async function importGame(ctx: FeatureContext, actorId: string, input: ImportInput) {
  const parsed = parsePgn(input?.pgn);
  const visibility = input?.visibility ?? 'private';
  if (!VISIBILITIES.includes(visibility as any)) throw badRequest(`visibility must be one of: ${VISIBILITIES.join(', ')}`);
  const tags = Array.isArray(input?.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [];

  const game = await ctx.repo.insert(GAMES, {
    id: ctx.newId(),
    ownerId: actorId,
    source: 'import',
    filename: input?.filename ? String(input.filename).slice(0, 200) : null,
    headers: parsed.headers,
    white: parsed.headers.White,
    black: parsed.headers.Black,
    event: parsed.headers.Event ?? null,
    result: parsed.result,
    moves: parsed.moves,
    plyCount: parsed.plyCount,
    fen: parsed.fen,
    tags,
    visibility,
    createdAt: ctx.now(),
  });

  await ctx.audit.record({
    action: 'analysis.game.import',
    actorId,
    targetType: 'analysis_game',
    targetId: game.id,
    detail: { white: game.white, black: game.black, plyCount: game.plyCount, visibility },
  });
  return game;
}

export async function getGameRow(ctx: FeatureContext, gameId: string) {
  const game = await ctx.repo.get(GAMES, gameId);
  if (!game) throw notFound('Game not found');
  return game;
}

/** Access rule: owner always; public games to any session; club games to holders of analysis.read. */
export function assertCanRead(game: any, session: any) {
  if (!session) throw forbidden('Authentication required to read games');
  if (game.ownerId === session.userId) return;
  const perms: string[] = session.permissions || [];
  if (game.visibility === 'public') return;
  if (game.visibility === 'club' && (perms.includes('analysis.read') || perms.includes('*'))) return;
  throw forbidden('You are not permitted to access this game');
}

export async function getGame(ctx: FeatureContext, session: any, gameId: string) {
  const game = await getGameRow(ctx, gameId);
  assertCanRead(game, session);
  const notes = await ctx.repo.find(NOTES, { gameId }, { orderBy: 'createdAt' });
  return { ...game, notes };
}

export async function exportGame(ctx: FeatureContext, session: any, gameId: string) {
  const game = await getGameRow(ctx, gameId);
  assertCanRead(game, session);
  await ctx.audit.record({ action: 'analysis.game.export', actorId: session.userId, targetType: 'analysis_game', targetId: gameId });
  return { gameId, filename: `${(game.white || 'white').replace(/\s+/g, '_')}_vs_${(game.black || 'black').replace(/\s+/g, '_')}.pgn`, pgn: serializePgn(game) };
}

export async function listGames(ctx: FeatureContext, session: any, q: { q?: string; tag?: string } = {}) {
  const all = await ctx.repo.find(GAMES, {});
  const perms: string[] = session?.permissions || [];
  const readable = all.filter((g: any) => {
    if (!session) return false;
    if (g.ownerId === session.userId) return true;
    if (g.visibility === 'public') return true;
    return g.visibility === 'club' && (perms.includes('analysis.read') || perms.includes('*'));
  });
  const needle = (q.q || '').trim().toLowerCase();
  const filtered = readable.filter((g: any) => {
    if (q.tag && !(g.tags || []).includes(q.tag)) return false;
    if (!needle) return true;
    const hay = [g.white, g.black, g.event, g.result, (g.tags || []).join(' ')].join(' ').toLowerCase();
    return hay.includes(needle);
  });
  return filtered.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function updateGame(ctx: FeatureContext, session: any, gameId: string, input: { tags?: string[]; visibility?: string }) {
  const game = await getGameRow(ctx, gameId);
  if (game.ownerId !== session.userId && !(session.permissions || []).includes('*')) {
    throw forbidden('Only the game owner may change its tags or visibility');
  }
  const patch: Record<string, any> = {};
  if (input?.tags !== undefined) {
    if (!Array.isArray(input.tags)) throw badRequest('tags must be an array of strings');
    patch.tags = input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
  }
  if (input?.visibility !== undefined) {
    if (!VISIBILITIES.includes(input.visibility as any)) throw badRequest(`visibility must be one of: ${VISIBILITIES.join(', ')}`);
    patch.visibility = input.visibility;
  }
  const updated = await ctx.repo.update(GAMES, gameId, patch);
  await ctx.audit.record({ action: 'analysis.game.update', actorId: session.userId, targetType: 'analysis_game', targetId: gameId, detail: patch });
  return updated;
}

export async function removeGame(ctx: FeatureContext, session: any, gameId: string) {
  const game = await getGameRow(ctx, gameId);
  if (game.ownerId !== session.userId && !(session.permissions || []).includes('*')) {
    throw forbidden('Only the game owner may delete this game');
  }
  const gone = await ctx.repo.remove(GAMES, gameId);
  if (!gone) throw notFound('Game not found');
  await ctx.audit.record({ action: 'analysis.game.delete', actorId: session.userId, targetType: 'analysis_game', targetId: gameId });
  return { removed: true, gameId };
}

/** Deterministic, offline guided content — no AI required. */
export function guidedContent(game: any) {
  const opening = (game.headers && (game.headers.Opening || game.headers.ECO)) || 'unclassified opening';
  const themes: string[] = [];
  if (game.plyCount <= 20) themes.push('Short game: check opening principles and early tactics first.');
  else if (game.plyCount <= 60) themes.push('Middlegame focus: compare piece activity before the first trade.');
  else themes.push('Long game: review the endgame transition and pawn structure.');
  if (game.result === '1-0' || game.result === '0-1') themes.push('Decisive result: identify the single move where the evaluation turned.');
  else themes.push('Drawn game: note where a winning attempt was available and declined.');
  return {
    opening,
    summary: `Deterministic review of ${game.white || 'White'} vs ${game.black || 'Black'} (${game.result}), ${game.plyCount} plies, ${opening}.`,
    themes,
    candidatePlans: [
      'Improve the least active piece before starting a pawn break.',
      'Contest the only open file with the heavy pieces.',
      'Fix the pawn structure before trading into a minor-piece endgame.',
    ],
  };
}

async function spendAiCredit(ctx: FeatureContext, userId: string) {
  let row = await ctx.repo.findOne(CREDITS, { userId });
  if (!row) {
    row = await ctx.repo.insert(CREDITS, { id: ctx.newId(), userId, credits: DEFAULT_AI_CREDITS, createdAt: ctx.now() });
  }
  const left = Number(row.credits ?? 0);
  if (left <= 0) {
    throw quotaExceeded('AI explanation credits are exhausted; deterministic guided review remains available');
  }
  const updated = await ctx.repo.update(CREDITS, row.id, { credits: left - 1 });
  return Number((updated as any)?.credits ?? 0);
}

export interface ReviewInput {
  mode?: string;
  depth?: number;
  aiExplanation?: boolean;
}

export async function reviewGame(ctx: FeatureContext, session: any, gameId: string, input: ReviewInput) {
  const game = await getGameRow(ctx, gameId);
  assertCanRead(game, session);

  const mode = input?.mode ?? 'manual';
  if (!MODES.includes(mode as any)) throw badRequest(`mode must be one of: ${MODES.join(', ')}`);

  let depth: number | null = null;
  if (mode === 'engine') {
    depth = input?.depth === undefined ? 12 : Number(input.depth);
    if (!Number.isInteger(depth) || depth < 1 || depth > 30) {
      throw badRequest('depth must be an integer between 1 and 30 for engine-assisted review');
    }
  }

  const guided = guidedContent(game);
  let aiExplanation: string | null = null;
  let creditsRemaining: number | null = null;
  if (input?.aiExplanation) {
    creditsRemaining = await spendAiCredit(ctx, session.userId);
    aiExplanation = `AI commentary on ${guided.opening}: prioritise development and king safety before the first trade.`;
  }

  const review = await ctx.repo.insert(REVIEWS, {
    id: ctx.newId(),
    gameId,
    requestedBy: session.userId,
    mode,
    depth,
    engine: mode === 'engine' ? 'stockfish-optional' : null,
    enginePerformanceBounded: mode === 'engine',
    label: 'analysis',
    officialResultAffecting: false,
    summary: guided.summary,
    themes: guided.themes,
    candidatePlans: guided.candidatePlans,
    aiExplanation,
    aiCreditsRemaining: creditsRemaining,
    createdAt: ctx.now(),
  });

  await ctx.audit.record({
    action: 'analysis.review.create',
    actorId: session.userId,
    targetType: 'analysis_review',
    targetId: review.id,
    detail: { gameId, mode, depth, aiExplanation: !!aiExplanation },
  });

  return { review, creditsRemaining };
}

export async function listReviews(ctx: FeatureContext, session: any, gameId: string) {
  const game = await getGameRow(ctx, gameId);
  assertCanRead(game, session);
  return ctx.repo.find(REVIEWS, { gameId }, { orderBy: 'createdAt', desc: true });
}

export async function addNote(ctx: FeatureContext, session: any, gameId: string, input: { ply?: number; text?: string }) {
  const game = await getGameRow(ctx, gameId);
  assertCanRead(game, session);
  const text = String(input?.text ?? '').trim();
  if (!text) throw badRequest('Note text is required');
  if (text.length > 2000) throw badRequest('Note text must be 2000 characters or fewer');
  const ply = input?.ply === undefined ? game.plyCount : Number(input.ply);
  if (!Number.isInteger(ply) || ply < 0 || ply > Number(game.plyCount ?? 0)) {
    throw badRequest(`ply must be an integer between 0 and ${game.plyCount}`);
  }
  const note = await ctx.repo.insert(NOTES, {
    id: ctx.newId(),
    gameId,
    authorId: session.userId,
    ply,
    text,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'analysis.note.create', actorId: session.userId, targetType: 'analysis_note', targetId: note.id, detail: { gameId, ply } });
  return note;
}

/** Basic review navigation: position after `ply` moves, without any engine involvement. */
export async function positionAtPly(ctx: FeatureContext, session: any, gameId: string, plyParam: string) {
  const game = await getGameRow(ctx, gameId);
  assertCanRead(game, session);
  const ply = Number(plyParam);
  if (!Number.isInteger(ply) || ply < 0 || ply > Number(game.plyCount ?? 0)) {
    throw conflict(`ply must be an integer between 0 and ${game.plyCount}`);
  }
  const moves = game.moves || [];
  return {
    gameId,
    ply,
    startFen: game.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    played: moves.slice(0, ply),
    nextMove: moves[ply] ?? null,
    history: moves.slice(0, ply).map((m: string, i: number) => ({ ply: i + 1, san: m })),
    engineUsed: false,
  };
}
