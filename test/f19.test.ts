import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 19 — Executive Committee, Elections & Leadership Transition', () => {
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

  /** president creates, administrator authorises, two members are approved candidates, voting opens. */
  const electionInVoting = async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const created = await (await post('/api/v1/governance/elections', president.headers, { title: 'AGM 2026' })).json();
    await post(`/api/v1/governance/elections/${created.data.id}/authorize`, admin.headers, { authorizationRef: 'DoS/2026/11' });

    const a = await seedUser(ctx, { roles: ['member'] });
    const b = await seedUser(ctx, { roles: ['member'] });
    const nomA = await (await post(`/api/v1/governance/elections/${created.data.id}/nominations`, a.headers, { position: 'president' })).json();
    const nomB = await (await post(`/api/v1/governance/elections/${created.data.id}/nominations`, b.headers, { position: 'president' })).json();
    await post(`/api/v1/governance/elections/${created.data.id}/nominations/${nomA.data.id}/review`, admin.headers, { decision: 'approve' });
    await post(`/api/v1/governance/elections/${created.data.id}/nominations/${nomB.data.id}/review`, admin.headers, { decision: 'approve' });
    return { president, admin, election: created.data, a, b, nomA: nomA.data, nomB: nomB.data };
  };

  it('creates an election in nominations and refuses to open voting before authorisation', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const res = await post('/api/v1/governance/elections', president.headers, { title: 'AGM 2026' });
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    expect(created.status).toBe('nominations');

    const opened = await post(`/api/v1/governance/elections/${created.id}/open`, president.headers);
    expect(opened.status).toBe(409);
  });

  it('blocks members from configuring elections and blocks self-authorisation', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const denied = await post('/api/v1/governance/elections', member.headers, { title: 'Rogue poll' });
    expect(denied.status).toBe(403);

    const president = await seedUser(ctx, { roles: ['president'] });
    const created = await (await post('/api/v1/governance/elections', president.headers, { title: 'AGM 2026' })).json();
    const selfAuthorise = await post(`/api/v1/governance/elections/${created.data.id}/authorize`, president.headers, {});
    expect(selfAuthorise.status).toBe(403);
  });

  it('refuses to open voting with no eligible candidate, then opens it once candidates exist', async () => {
    const president = await seedUser(ctx, { roles: ['president'] });
    const admin = await seedUser(ctx, { roles: ['administrator'] });
    const created = await (await post('/api/v1/governance/elections', president.headers, { title: 'AGM 2026' })).json();
    await post(`/api/v1/governance/elections/${created.data.id}/authorize`, admin.headers, {});

    const noCandidates = await post(`/api/v1/governance/elections/${created.data.id}/open`, president.headers);
    expect(noCandidates.status).toBe(409);

    const a = await seedUser(ctx, { roles: ['member'] });
    const nomA = await (await post(`/api/v1/governance/elections/${created.data.id}/nominations`, a.headers, { position: 'president' })).json();
    await post(`/api/v1/governance/elections/${created.data.id}/nominations/${nomA.data.id}/review`, admin.headers, { decision: 'approve' });

    const opened = await post(`/api/v1/governance/elections/${created.data.id}/open`, president.headers);
    expect(opened.status).toBe(200);
    expect((await opened.json()).data.status).toBe('voting');
  });

  it('enforces one person one vote and blocks a self-cast ballot', async () => {
    const { president, election, a, b, nomA, nomB } = await electionInVoting();
    await post(`/api/v1/governance/elections/${election.id}/open`, president.headers);

    const selfVote = await post(`/api/v1/governance/elections/${election.id}/vote`, a.headers, { candidateId: nomA.id });
    expect(selfVote.status).toBe(403);

    const first = await post(`/api/v1/governance/elections/${election.id}/vote`, a.headers, { candidateId: nomB.id });
    expect(first.status).toBe(201);

    const second = await post(`/api/v1/governance/elections/${election.id}/vote`, a.headers, { candidateId: nomB.id });
    expect(second.status).toBe(409);
  });

  it('closes the election, withholds uncertified results and certifies them by a second official', async () => {
    const { president, admin, election, a, b, nomA, nomB } = await electionInVoting();
    await post(`/api/v1/governance/elections/${election.id}/open`, president.headers);
    await post(`/api/v1/governance/elections/${election.id}/vote`, a.headers, { candidateId: nomB.id });
    await post(`/api/v1/governance/elections/${election.id}/vote`, b.headers, { candidateId: nomA.id });

    const closed = await post(`/api/v1/governance/elections/${election.id}/close`, admin.headers);
    expect(closed.status).toBe(200);
    expect((await closed.json()).data.tally.totalVotes).toBe(2);

    const uncertified = await get(`/api/v1/governance/elections/${election.id}/results`, admin.headers);
    expect(uncertified.status).toBe(409);

    const certified = await post(`/api/v1/governance/elections/${election.id}/certify`, admin.headers, { notes: 'verified' });
    expect(certified.status).toBe(200);

    const results = await (await get(`/api/v1/governance/elections/${election.id}/results`, admin.headers)).json();
    expect(results.data.certified).toBe(true);
    expect(results.data.results.totalVotes).toBe(2);
  });

  it('tracks the committee directory and handover tasks', async () => {
    const { president, election } = await electionInVoting();
    const term = await post('/api/v1/governance/committee', president.headers, {
      position: 'president',
      userId: 'u_outgoing',
      startsAt: '2025-07-01T00:00:00.000Z',
      endsAt: '2026-06-30T00:00:00.000Z',
    });
    expect(term.status).toBe(201);

    const created = await post(`/api/v1/governance/elections/${election.id}/handover`, president.headers, {
      tasks: [{ title: 'Hand over trophy cabinet keys', asset: 'trophy_cabinet' }],
    });
    expect(created.status).toBe(201);
    const task = (await created.json()).data[0];

    const done = await post(`/api/v1/governance/handover/${task.id}/complete`, president.headers);
    expect((await done.json()).data.status).toBe('done');

    const list = await (await get(`/api/v1/governance/elections/${election.id}/handover`, president.headers)).json();
    expect(list.data.done).toBe(1);
    expect(list.data.assets).toContain('trophy_cabinet');
  });
});
