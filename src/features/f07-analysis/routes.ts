import type { FeatureContext, FeatureHono } from '../../core/types.js';
import { ok, created, page } from '../../core/http.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as svc from './service.js';

export function mount(app: FeatureHono, ctx: FeatureContext) {
  // PGN validation preview — parse only, nothing is persisted.
  app.post('/games/preview', requireAuth(), requirePermission('analysis.read', 'analysis.run'), async (c) => {
    const b = (c.get('parsedBody') as any) || {};
    return ok(c, svc.previewPgn(b.pgn));
  });

  app.post('/games', requireAuth(), requirePermission('analysis.run'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.importGame(ctx, s.userId, c.get('parsedBody') as any));
  });

  app.get('/games', requireAuth(), requirePermission('analysis.read', 'analysis.run'), async (c) => {
    const s = c.get('session') as any;
    const items = await svc.listGames(ctx, s, { q: c.req.query('q'), tag: c.req.query('tag') });
    const limit = Number(c.req.query('limit') || 50);
    const offset = Number(c.req.query('offset') || 0);
    return ok(c, page(items.slice(offset, offset + limit), items.length, limit, offset));
  });

  app.get('/games/:id', requireAuth(), requirePermission('analysis.read', 'analysis.run'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.getGame(ctx, s, c.req.param('id')));
  });

  app.get('/games/:id/pgn', requireAuth(), requirePermission('analysis.read', 'analysis.run'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.exportGame(ctx, s, c.req.param('id')));
  });

  app.get('/games/:id/reviews', requireAuth(), requirePermission('analysis.read', 'analysis.run'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.listReviews(ctx, s, c.req.param('id')));
  });

  app.get('/games/:id/position/:ply', requireAuth(), requirePermission('analysis.read', 'analysis.run'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.positionAtPly(ctx, s, c.req.param('id'), c.req.param('ply')));
  });

  app.patch('/games/:id', requireAuth(), requirePermission('analysis.run'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.updateGame(ctx, s, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.delete('/games/:id', requireAuth(), requirePermission('analysis.run'), async (c) => {
    const s = c.get('session') as any;
    return ok(c, await svc.removeGame(ctx, s, c.req.param('id')));
  });

  app.post('/games/:id/review', requireAuth(), requirePermission('analysis.run'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.reviewGame(ctx, s, c.req.param('id'), c.get('parsedBody') as any));
  });

  app.post('/games/:id/notes', requireAuth(), requirePermission('analysis.run'), async (c) => {
    const s = c.get('session') as any;
    return created(c, await svc.addNote(ctx, s, c.req.param('id'), c.get('parsedBody') as any));
  });
}
