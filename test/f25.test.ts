import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 25 — Inter-University Competition & Federation Management', () => {
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

  const newFederation = async (pres: any) =>
    (
      await (
        await post('/api/v1/interuniversity/federations', pres.headers, {
          name: 'Maharashtra University Chess Association',
          contactName: 'Secretary',
          contactEmail: 'secretary@muca.example',
        })
      ).json()
    ).data;

  const newCompetition = async (pres: any, federationId: string) =>
    (
      await (
        await post('/api/v1/interuniversity/competitions', pres.headers, {
          name: 'West Zone Inter-University 2026',
          federationId,
          startsAt: '2026-04-10T00:00:00.000Z',
          endsAt: '2026-04-12T00:00:00.000Z',
          eligibility: 'Full-time students with a SaiU rating',
          selectionCriteria: 'Top 5 by club rating plus 1 coach nomination',
        })
      ).json()
    ).data;

  it('records a federation without claiming an unverified affiliation', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const res = await post('/api/v1/interuniversity/federations', pres.headers, {
      name: 'Maharashtra University Chess Association',
    });
    expect(res.status).toBe(201);
    const federation = (await res.json()).data;
    expect(federation.verified).toBe(false);

    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await post('/api/v1/interuniversity/federations', member.headers, { name: 'Fake' })).status).toBe(403);

    const fed = await newFederation(pres);
    const comp = await newCompetition(pres, fed.id);
    const before = (await (await get(`/api/v1/interuniversity/competitions/${comp.id}/affiliation`)).json()).data;
    expect(before.federationVerified).toBe(false);
    expect(before.affiliationClaimed).toBe(false);

    await post(`/api/v1/interuniversity/federations/${fed.id}/verify`, pres.headers);
    const after = (await (await get(`/api/v1/interuniversity/competitions/${comp.id}/affiliation`)).json()).data;
    expect(after.federationVerified).toBe(true);
    expect(after.affiliationClaimed).toBe(true);
  });

  it('requires documented selection criteria and interuniversity.manage', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const fed = await newFederation(pres);

    const member = await seedUser(ctx, { roles: ['member'] });
    const denied = await post('/api/v1/interuniversity/competitions', member.headers, {
      name: 'Rogue Cup',
      federationId: fed.id,
      selectionCriteria: 'n/a',
    });
    expect(denied.status).toBe(403);

    const missing = await post('/api/v1/interuniversity/competitions', pres.headers, {
      name: 'No criteria cup',
      federationId: fed.id,
    });
    expect(missing.status).toBe(400);

    const good = await newCompetition(pres, fed.id);
    expect(good.federationId).toBe(fed.id);
    expect(good.selectionCriteria).toContain('Top 5');
    expect(good.paymentProcessed).toBe(false);
  });

  it('creates fixtures carrying the federation id and a valid home/away flag', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const fed = await newFederation(pres);
    const comp = await newCompetition(pres, fed.id);

    const bad = await post(`/api/v1/interuniversity/competitions/${comp.id}/fixtures`, pres.headers, {
      opponentUniversity: 'Pune University',
      homeAway: 'sideways',
      round: 1,
    });
    expect(bad.status).toBe(400);

    const res = await post(`/api/v1/interuniversity/competitions/${comp.id}/fixtures`, pres.headers, {
      opponentUniversity: 'Pune University',
      homeAway: 'home',
      round: 1,
      scheduledAt: '2026-04-10T05:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const fixture = (await res.json()).data;
    expect(fixture.federationId).toBe(fed.id);
    expect(fixture.homeAway).toBe('home');
    expect(fixture.resultStatus).toBe('pending');
    expect(fixture.result).toBe(null);
  });

  it('proposes a result from the scoreline and confirms it by a second official', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const pres2 = await seedUser(ctx, { roles: ['president'] });
    const fed = await newFederation(pres);
    const comp = await newCompetition(pres, fed.id);
    const fixture = (
      await (await post(`/api/v1/interuniversity/competitions/${comp.id}/fixtures`, pres.headers, {
        opponentUniversity: 'Pune University',
        homeAway: 'away',
        round: 2,
      })).json()
    ).data;

    const contradictory = await post(`/api/v1/interuniversity/fixtures/${fixture.id}/result`, pres.headers, {
      ourScore: 1,
      opponentScore: 2,
      result: 'win',
    });
    expect(contradictory.status).toBe(400);

    const proposed = await post(`/api/v1/interuniversity/fixtures/${fixture.id}/result`, pres.headers, {
      ourScore: 3,
      opponentScore: 1,
    });
    expect(proposed.status).toBe(200);
    const proposedBody = (await proposed.json()).data;
    expect(proposedBody.result).toBe('win');
    expect(proposedBody.resultStatus).toBe('proposed');

    const self = await post(`/api/v1/interuniversity/fixtures/${fixture.id}/result/confirm`, pres.headers);
    expect(self.status).toBe(403);

    const confirmed = await post(`/api/v1/interuniversity/fixtures/${fixture.id}/result/confirm`, pres2.headers);
    expect(confirmed.status).toBe(200);
    const confirmedBody = (await confirmed.json()).data;
    expect(confirmedBody.resultStatus).toBe('confirmed');
    expect(confirmedBody.confirmedBy).toBe(pres2.user.id);

    const again = await post(`/api/v1/interuniversity/fixtures/${fixture.id}/result`, pres.headers, {
      ourScore: 0,
      opponentScore: 0,
    });
    expect(again.status).toBe(409);

    const detail = (await (await get(`/api/v1/interuniversity/competitions/${comp.id}`)).json()).data;
    expect(detail.record.wins).toBe(1);
    expect(detail.record.played).toBe(1);
  });

  it('audits team approval, keeps criteria public and restricts documents', async () => {
    const pres = await seedUser(ctx, { roles: ['president'] });
    const pres2 = await seedUser(ctx, { roles: ['president'] });
    const fed = await newFederation(pres);
    const comp = await newCompetition(pres, fed.id);

    const team = await post(`/api/v1/interuniversity/competitions/${comp.id}/team`, pres.headers, {
      playerIds: ['u_a', 'u_b', 'u_c'],
    });
    expect(team.status).toBe(201);
    const teamBody = (await team.json()).data;
    expect(teamBody.status).toBe('proposed');
    expect(teamBody.criteria).toContain('Top 5');

    const self = await post(`/api/v1/interuniversity/teams/${teamBody.id}/approve`, pres.headers);
    expect(self.status).toBe(403);

    const approved = await post(`/api/v1/interuniversity/teams/${teamBody.id}/approve`, pres2.headers);
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe('approved');

    const criteria = (await (await get(`/api/v1/interuniversity/competitions/${comp.id}/criteria`)).json()).data;
    expect(criteria.selectionCriteria).toContain('Top 5');
    expect(criteria.approvedTeam.status).toBe('approved');

    const doc = await post(`/api/v1/interuniversity/competitions/${comp.id}/documents`, pres.headers, {
      title: 'Federation entry form',
      kind: 'entry',
    });
    expect(doc.status).toBe(201);

    const member = await seedUser(ctx, { roles: ['member'] });
    expect((await get(`/api/v1/interuniversity/competitions/${comp.id}/documents`, member.headers)).status).toBe(403);
    const official = (await (await get(`/api/v1/interuniversity/competitions/${comp.id}/documents`, pres.headers)).json()).data;
    expect(official.length).toBe(1);
  });
});
