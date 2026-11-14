import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 24 — Sponsorship, Partnerships & University Relations', () => {
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
  const get = (path: string, headers: any = {}) => app.request(path, { headers });

  const newPartner = async (pres: any, over: any = {}) =>
    (
      await (
        await post('/api/v1/sponsorships/partners', pres.headers, {
          name: 'Deccan Chess Academy',
          type: 'sponsor',
          contactName: 'R. Iyer',
          contactEmail: 'partnerships@deccanchess.example',
          confidentialTerms: 'Logo on all event banners',
          ...over,
        })
      ).json()
    ).data;

  const moveTo = async (pres: any, id: string, stages: string[]) => {
    for (const stage of stages) await post(`/api/v1/sponsorships/partners/${id}/stage`, pres.headers, { stage });
  };

  it('registers a prospect and hides the pipeline from ordinary members', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const res = await post('/api/v1/sponsorships/partners', pres.headers, {
      name: 'Deccan Chess Academy',
      contactEmail: 'partnerships@deccanchess.example',
    });
    expect(res.status).toBe(201);
    const partner = (await res.json()).data;
    expect(partner.stage).toBe('prospect');
    expect(partner.recognitionApproved).toBe(false);

    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await post('/api/v1/sponsorships/partners', member.headers, { name: 'X' })).status).toBe(403);
    expect((await get(`/api/v1/sponsorships/partners/${partner.id}`, member.headers)).status).toBe(403);
  });

  it('enforces the pipeline stage machine', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const partner = await newPartner(pres);

    const skip = await post(`/api/v1/sponsorships/partners/${partner.id}/stage`, pres.headers, { stage: 'agreement' });
    expect(skip.status).toBe(409);

    await moveTo(pres, partner.id, ['contacted', 'proposal', 'review']);
    const detail = (await (await get(`/api/v1/sponsorships/partners/${partner.id}`, pres.headers)).json()).data;
    expect(detail.stage).toBe('review');
    expect(detail.stageHistory.length).toBe(4);
  });

  it('records an agreement and requires independent approval', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const pres2 = await seedUser(ctx, { roles: ['president'] });
    const partner = await newPartner(pres);

    const created = await post(`/api/v1/sponsorships/partners/${partner.id}/agreements`, pres.headers, {
      title: 'Title sponsorship 2026-27',
      committedAmount: 500000,
      startsAt: '2026-04-01T00:00:00.000Z',
      endsAt: '2027-03-31T00:00:00.000Z',
    });
    expect(created.status).toBe(201);
    const agreement = (await created.json()).data;
    expect(agreement.status).toBe('pending_approval');
    expect(agreement.committedAmount).toBe(500000);

    const self = await post(`/api/v1/sponsorships/agreements/${agreement.id}/approve`, pres.headers);
    expect(self.status).toBe(403);

    const approved = await post(`/api/v1/sponsorships/agreements/${agreement.id}/approve`, pres2.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('active');
  });

  it('requires every deliverable to have an owner and a due date', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const pres2 = await seedUser(ctx, { roles: ['president'] });
    const partner = await newPartner(pres);
    const agreement = (
      await (await post(`/api/v1/sponsorships/partners/${partner.id}/agreements`, pres.headers, {
        title: 'Kit sponsor',
        committedAmount: 100000,
      })).json()
    ).data;

    const noOwner = await post(`/api/v1/sponsorships/agreements/${agreement.id}/deliverables`, pres.headers, {
      title: 'Banner placement',
      dueAt: '2026-05-01T00:00:00.000Z',
    });
    expect(noOwner.status).toBe(400);

    const good = await post(`/api/v1/sponsorships/agreements/${agreement.id}/deliverables`, pres.headers, {
      title: 'Banner placement',
      ownerId: pres2.user.id,
      dueAt: '2026-05-01T00:00:00.000Z',
    });
    expect(good.status).toBe(201);
    const deliverable = (await good.json()).data;
    expect(deliverable.status).toBe('pending');
    expect(deliverable.ownerId).toBe(pres2.user.id);

    const done = await post(`/api/v1/sponsorships/deliverables/${deliverable.id}/complete`, pres2.headers);
    expect(done.status).toBe(200);
    expect((await done.json()).data.status).toBe('completed');
  });

  it('reconciles committed and received amounts', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const pres2 = await seedUser(ctx, { roles: ['president'] });
    const partner = await newPartner(pres);
    const agreement = (
      await (await post(`/api/v1/sponsorships/partners/${partner.id}/agreements`, pres.headers, {
        title: 'Title sponsorship',
        committedAmount: 500000,
      })).json()
    ).data;
    await post(`/api/v1/sponsorships/agreements/${agreement.id}/approve`, pres2.headers);

    await post(`/api/v1/sponsorships/partners/${partner.id}/contributions`, pres.headers, {
      amount: 200000,
      agreementId: agreement.id,
      financeReference: 'FIN-2026-0042',
    });
    await post(`/api/v1/sponsorships/partners/${partner.id}/contributions`, pres.headers, {
      amount: 150000,
      agreementId: agreement.id,
      financeReference: 'FIN-2026-0051',
    });

    const first = (await (await get(`/api/v1/sponsorships/partners/${partner.id}/finance`, pres.headers)).json()).data;
    expect(first.committed).toBe(500000);
    expect(first.received).toBe(350000);
    expect(first.outstanding).toBe(150000);
    expect(first.overCommitted).toBe(false);

    await post(`/api/v1/sponsorships/partners/${partner.id}/contributions`, pres.headers, { amount: 200000 });
    const second = (await (await get(`/api/v1/sponsorships/partners/${partner.id}/finance`, pres.headers)).json()).data;
    expect(second.received).toBe(550000);
    expect(second.outstanding).toBe(0);
    expect(second.overCommitted).toBe(true);

    const negative = await post(`/api/v1/sponsorships/partners/${partner.id}/contributions`, pres.headers, { amount: -5 });
    expect(negative.status).toBe(400);
  });

  it('publishes sponsor recognition only after an independent approval', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const pres2 = await seedUser(ctx, { roles: ['president'] });
    const partner = await newPartner(pres);

    expect((await (await get('/api/v1/sponsorships/recognition')).json()).data.length).toBe(0);

    await post(`/api/v1/sponsorships/partners/${partner.id}/recognition/request`, pres.headers, { logoApproved: true });
    const self = await post(`/api/v1/sponsorships/partners/${partner.id}/recognition/approve`, pres.headers);
    expect(self.status).toBe(403);
    expect((await (await get('/api/v1/sponsorships/recognition')).json()).data.length).toBe(0);

    const approved = await post(`/api/v1/sponsorships/partners/${partner.id}/recognition/approve`, pres2.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.recognitionPublished).toBe(true);

    const feed = (await (await get('/api/v1/sponsorships/recognition')).json()).data;
    expect(feed.length).toBe(1);
    expect(feed[0].name).toBe('Deccan Chess Academy');
    expect(feed[0].contactEmail).toBeUndefined();
    expect(feed[0].confidentialTerms).toBeUndefined();
  });
});
