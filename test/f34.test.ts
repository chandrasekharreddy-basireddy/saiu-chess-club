import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 34 — Accessibility & Inclusivity', () => {
  let app: any, ctx: any, repo: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    repo = h.repo;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const put = (path: string, headers: any, json?: any) =>
    app.request(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  it('returns the documented defaults for a user who has never set preferences', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await get('/api/v1/accessibility/preferences', member.headers);
    expect(res.status).toBe(200);
    const prefs = (await res.json()).data;
    expect(prefs.persisted).toBe(false);
    expect(prefs.reducedMotion).toBe('no-preference');
    expect(prefs.highContrast).toBe(false);
    expect(prefs.fontScale).toBe(1);
  });

  it('validates preferences against the allowed values', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await put('/api/v1/accessibility/preferences', member.headers, { reducedMotion: 'slow' })).status).toBe(400);
    expect((await put('/api/v1/accessibility/preferences', member.headers, { fontScale: 3 })).status).toBe(400);
    expect((await put('/api/v1/accessibility/preferences', member.headers, { highContrast: 'yes' })).status).toBe(400);
    expect((await put('/api/v1/accessibility/preferences', member.headers, { dancing: true })).status).toBe(400);
  });

  it('keeps exactly one settings record per user across updates', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const first = await put('/api/v1/accessibility/preferences', member.headers, {
      reducedMotion: 'reduce',
      highContrast: true,
      fontScale: 1.5,
    });
    expect(first.status).toBe(200);
    const saved = (await first.json()).data;
    expect(saved.reducedMotion).toBe('reduce');
    expect(saved.highContrast).toBe(true);
    expect(saved.fontScale).toBe(1.5);

    const second = await put('/api/v1/accessibility/preferences', member.headers, { fontScale: 2 });
    expect(second.status).toBe(200);
    const merged = (await second.json()).data;
    expect(merged.fontScale).toBe(2);
    expect(merged.reducedMotion).toBe('reduce');

    expect(await repo.count('accessibility_preferences', { userId: member.user.id })).toBe(1);
    const reread = (await (await get('/api/v1/accessibility/preferences', member.headers)).json()).data;
    expect(reread.persisted).toBe(true);
    expect(reread.fontScale).toBe(2);
  });

  it('stores preferences per user, not globally', async () => {
    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    await put('/api/v1/accessibility/preferences', a.headers, { fontScale: 1.25, reducedMotion: 'reduce' });

    const other = (await (await get('/api/v1/accessibility/preferences', b.headers)).json()).data;
    expect(other.persisted).toBe(false);
    expect(other.fontScale).toBe(1);
    expect(other.reducedMotion).toBe('no-preference');
  });

  it('lets only the accessibility team read another account’s preferences', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const peer = await seedUser(ctx, { roles: ['member'] });
    await put('/api/v1/accessibility/preferences', peer.headers, { highContrast: true });

    expect((await get(`/api/v1/accessibility/preferences/${peer.user.id}`, member.headers)).status).toBe(403);

    const officer = await seedUser(ctx, { roles: ['member'], permissions: ['accessibility.manage'] });
    const res = await get(`/api/v1/accessibility/preferences/${peer.user.id}`, officer.headers);
    expect(res.status).toBe(200);
    expect((await res.json()).data.highContrast).toBe(true);
  });

  it('records an accessibility defect with severity and a WCAG reference', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/accessibility/issues', member.headers, {
      feature: 'live-arena',
      description: 'Move list cannot be reached with the Tab key',
      severity: 'high',
      wcagCriterion: '2.1.1 Keyboard',
      assistiveTech: 'NVDA 2025.1',
    });
    expect(res.status).toBe(201);
    const issue = (await res.json()).data;
    expect(issue.status).toBe('open');
    expect(issue.severity).toBe('high');
    expect(issue.wcagCriterion).toBe('2.1.1 Keyboard');
    expect(issue.reportedBy).toBe(member.user.id);

    expect((await post('/api/v1/accessibility/issues', member.headers, { feature: 'arena', description: 'x', severity: 'blocker' })).status).toBe(400);
  });

  it('restricts the defect backlog to the accessibility team', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    await post('/api/v1/accessibility/issues', member.headers, { feature: 'forms', description: 'Error text is colour-only', severity: 'medium' });

    expect((await get('/api/v1/accessibility/issues', member.headers)).status).toBe(403);

    const officer = await seedUser(ctx, { roles: ['member'], permissions: ['accessibility.manage'] });
    const list = await get('/api/v1/accessibility/issues', officer.headers);
    expect(list.status).toBe(200);
    expect((await list.json()).data.length).toBe(1);
  });

  it('resolves a defect once and refuses a second resolution', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const officer = await seedUser(ctx, { roles: ['member'], permissions: ['accessibility.manage'] });
    const issue = (await (
      await post('/api/v1/accessibility/issues', member.headers, { feature: 'dialog', description: 'Focus escapes the modal', severity: 'high' })
    ).json()).data;

    expect((await post(`/api/v1/accessibility/issues/${issue.id}/resolve`, officer.headers, {})).status).toBe(400);
    const resolved = await post(`/api/v1/accessibility/issues/${issue.id}/resolve`, officer.headers, {
      resolution: 'Trap focus inside the dialog and restore it on close',
    });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data.status).toBe('resolved');

    const again = await post(`/api/v1/accessibility/issues/${issue.id}/resolve`, officer.headers, { resolution: 'done' });
    expect(again.status).toBe(409);
  });

  it('publishes the supported accessibility modes publicly', async () => {
    const res = await get('/api/v1/accessibility/options');
    expect(res.status).toBe(200);
    const opts = (await res.json()).data;
    expect(opts.reducedMotion).toEqual(['no-preference', 'reduce']);
    expect(opts.fontScale).toEqual([1, 1.25, 1.5, 2]);
  });
});
