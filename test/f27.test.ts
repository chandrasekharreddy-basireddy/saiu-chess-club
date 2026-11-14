import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 27 — Marketing, PR & Digital Outreach', () => {
  let app: any, ctx: any;

  beforeEach(() => {
    const h = makeCtx();
    ctx = h.ctx;
    app = buildApp(ctx);
  });

  const post = (path: string, headers: any, json?: any) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json ? JSON.stringify(json) : undefined });
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const officer = (email?: string) => seedUser(ctx, { roles: ['committee'], permissions: ['marketing.manage'], email });

  async function approvedCampaign(author: any, approver: any, extra: any = {}) {
    const created = await (await post('/api/v1/marketing/campaigns', author.headers, {
      title: 'Freshers chess drive', channel: 'instagram', scheduledAt: '2026-02-01T10:00:00.000Z', content: 'Join the club!', ...extra,
    })).json();
    const id = created.data.id;
    await post(`/api/v1/marketing/campaigns/${id}/submit`, author.headers);
    await post(`/api/v1/marketing/campaigns/${id}/approve`, approver.headers);
    return id;
  }

  it('creates a campaign record with channel and scheduled date', async () => {
    const m = await officer();
    const res = await post('/api/v1/marketing/campaigns', m.headers, {
      title: 'Freshers chess drive', channel: 'instagram', scheduledAt: '2026-02-01T10:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('draft');
    expect(body.data.channel).toBe('instagram');
    expect(body.data.scheduledAt).toBe('2026-02-01T10:00:00.000Z');
    expect(body.data.audience).toBe('public_social');
  });

  it('rejects campaign creation by a plain member', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/marketing/campaigns', member.headers, { title: 'x', channel: 'x', scheduledAt: '2026-02-01T10:00:00.000Z' });
    expect(res.status).toBe(403);
    expect((await get('/api/v1/marketing/campaigns', member.headers)).status).toBe(403);
  });

  it('validates the channel and the scheduled date', async () => {
    const m = await officer();
    expect((await post('/api/v1/marketing/campaigns', m.headers, { title: 'x', channel: 'tiktok', scheduledAt: '2026-02-01T10:00:00.000Z' })).status).toBe(400);
    expect((await post('/api/v1/marketing/campaigns', m.headers, { title: 'x', channel: 'instagram', scheduledAt: 'not-a-date' })).status).toBe(400);
    expect((await post('/api/v1/marketing/campaigns', m.headers, { title: 'x', channel: 'instagram' })).status).toBe(400);
  });

  it('blocks publishing before approval and enforces separation of duties', async () => {
    const author = await officer();
    const approver = await officer();
    const created = await (await post('/api/v1/marketing/campaigns', author.headers, {
      title: 'Open day post', channel: 'linkedin', scheduledAt: '2026-03-05T09:00:00.000Z',
    })).json();
    const id = created.data.id;

    // publishing a draft is a state violation
    expect((await post(`/api/v1/marketing/campaigns/${id}/publish`, author.headers, { externalUrl: 'https://example.org/p/1' })).status).toBe(409);
    await post(`/api/v1/marketing/campaigns/${id}/submit`, author.headers);

    // the author cannot approve their own campaign
    expect((await post(`/api/v1/marketing/campaigns/${id}/approve`, author.headers)).status).toBe(403);
    expect((await post(`/api/v1/marketing/campaigns/${id}/approve`, approver.headers)).status).toBe(200);

    // an approved campaign still needs a recorded publication URL
    expect((await post(`/api/v1/marketing/campaigns/${id}/publish`, approver.headers, {})).status).toBe(400);
    const published = await post(`/api/v1/marketing/campaigns/${id}/publish`, approver.headers, { externalUrl: 'https://example.org/p/1' });
    expect(published.status).toBe(200);
    const body = await published.json();
    expect(body.data.status).toBe('published');
    expect(body.data.externalUrl).toBe('https://example.org/p/1');
  });

  it('requires recorded consent for identifiable people before publishing', async () => {
    const author = await officer();
    const approver = await officer();
    const id = await approvedCampaign(author, approver, { identifiablePeople: true, consentGranted: false });
    const res = await post(`/api/v1/marketing/campaigns/${id}/publish`, approver.headers, { externalUrl: 'https://example.org/p/2' });
    expect(res.status).toBe(422);

    const ok2 = await approvedCampaign(author, approver, { identifiablePeople: true, consentGranted: true });
    const res2 = await post(`/api/v1/marketing/campaigns/${ok2}/publish`, approver.headers, { externalUrl: 'https://example.org/p/3' });
    expect(res2.status).toBe(200);
  });

  it('lists the campaign calendar window and records engagement metrics', async () => {
    const m = await officer();
    const other = await officer();
    const early = await (await post('/api/v1/marketing/campaigns', m.headers, {
      title: 'February post', channel: 'website', scheduledAt: '2026-02-10T10:00:00.000Z',
    })).json();
    await post('/api/v1/marketing/campaigns', m.headers, { title: 'April post', channel: 'press', scheduledAt: '2026-04-10T10:00:00.000Z' });

    const cal = await (await get('/api/v1/marketing/calendar?from=2026-02-01T00:00:00.000Z&to=2026-02-28T23:59:59.000Z', m.headers)).json();
    expect(cal.data.length).toBe(1);
    expect(cal.data[0].title).toBe('February post');

    const id = await approvedCampaign(m, other, { title: 'Metrics post' });
    await post(`/api/v1/marketing/campaigns/${id}/publish`, other.headers, { externalUrl: 'https://example.org/p/9' });
    const metrics = await post(`/api/v1/marketing/campaigns/${id}/metrics`, other.headers, { impressions: 1000, engagements: 125, clicks: 40 });
    expect(metrics.status).toBe(200);
    const mbody = await metrics.json();
    expect(mbody.data.metrics.engagementRate).toBe(0.125);
    expect(mbody.data.id).toBe(id);
    expect(early.data.id).toBeTruthy();
  });
});
