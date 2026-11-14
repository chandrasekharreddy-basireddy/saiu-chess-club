import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx, seedUser } from '../src/core/testing.js';

describe('Feature 31 — Surveys, Polls & Community Decision-Making Centre', () => {
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

  const closeDate = '2026-02-01T18:00:00.000Z';

  async function publishedPoll(organizer: any, extra: any = {}) {
    const res = await post('/api/v1/surveys', organizer.headers, {
      title: 'Blitz night format',
      type: 'poll',
      purpose: 'Choose the format for the next club blitz night',
      audience: 'members',
      closesAt: closeDate,
      options: ['5+0 arena', '3+2 swiss'],
      ...extra,
    });
    const poll = (await res.json()).data;
    const pub = await post(`/api/v1/surveys/${poll.id}/publish`, organizer.headers);
    return { poll, publishStatus: pub.status };
  }

  it('creates a poll as draft, publishes it, and accepts one vote per member', async () => {
    const committee = await seedUser(ctx, { roles: ['committee'] });
    const { poll, publishStatus } = await publishedPoll(committee);
    expect(poll.status).toBe('draft');
    expect(publishStatus).toBe(200);

    const member = await seedUser(ctx, { roles: ['member'] });
    const vote = await post(`/api/v1/surveys/${poll.id}/responses`, member.headers, { optionIds: ['opt_1'] });
    expect(vote.status).toBe(201);
    expect((await vote.json()).data.optionIds).toEqual(['opt_1']);

    const detail = await (await get(`/api/v1/surveys/${poll.id}`)).json();
    expect(detail.data.status).toBe('published');
    expect(detail.data.responseCount).toBe(1);
  });

  it('rejects poll creation for a plain member (403)', async () => {
    const member = await seedUser(ctx, { roles: ['member'] });
    const res = await post('/api/v1/surveys', member.headers, { title: 'Nope', options: ['a', 'b'] });
    expect(res.status).toBe(403);
  });

  it('enforces one response per account', async () => {
    const committee = await seedUser(ctx, { roles: ['committee'] });
    const { poll } = await publishedPoll(committee);
    const member = await seedUser(ctx, { roles: ['member'] });

    expect((await post(`/api/v1/surveys/${poll.id}/responses`, member.headers, { optionIds: ['opt_1'] })).status).toBe(201);
    const dup = await post(`/api/v1/surveys/${poll.id}/responses`, member.headers, { optionIds: ['opt_2'] });
    expect(dup.status).toBe(409);
    expect(await repo.count('survey_responses', { pollId: poll.id })).toBe(1);
  });

  it('distinguishes single-choice from multi-choice validation', async () => {
    const committee = await seedUser(ctx, { roles: ['committee'] });
    const single = await publishedPoll(committee);
    const member = await seedUser(ctx, { roles: ['member'] });
    const tooMany = await post(`/api/v1/surveys/${single.poll.id}/responses`, member.headers, { optionIds: ['opt_1', 'opt_2'] });
    expect(tooMany.status).toBe(400);

    const multi = await publishedPoll(committee, { title: 'Multi choice', selection: 'multi', maxSelections: 2, options: ['a', 'b', 'c'] });
    const other = await seedUser(ctx, { roles: ['member'] });
    const two = await post(`/api/v1/surveys/${multi.poll.id}/responses`, other.headers, { optionIds: ['opt_1', 'opt_3'] });
    expect(two.status).toBe(201);
    const three = await post(`/api/v1/surveys/${multi.poll.id}/responses`, member.headers, { optionIds: ['opt_1', 'opt_2', 'opt_3'] });
    expect(three.status).toBe(400);
  });

  it('stores no user id on an anonymous response yet still blocks a second vote', async () => {
    const committee = await seedUser(ctx, { roles: ['committee'] });
    const { poll } = await publishedPoll(committee, { title: 'Anonymous poll', anonymous: true });
    const member = await seedUser(ctx, { roles: ['member'] });

    const res = await post(`/api/v1/surveys/${poll.id}/responses`, member.headers, { optionIds: ['opt_2'] });
    expect(res.status).toBe(201);
    const body = (await res.json()).data;
    expect(body.userId).toBeNull();
    expect(body.anonymous).toBe(true);

    const stored = await repo.find('survey_responses', { pollId: poll.id });
    expect(stored.length).toBe(1);
    expect(stored[0].userId).toBeNull();
    expect(JSON.stringify(stored[0])).not.toContain(member.user.id);

    const ledger = await repo.find('survey_vote_ledger', { pollId: poll.id });
    expect(JSON.stringify(ledger)).not.toContain(member.user.id);

    const dup = await post(`/api/v1/surveys/${poll.id}/responses`, member.headers, { optionIds: ['opt_1'] });
    expect(dup.status).toBe(409);
  });

  it('closes a poll and tallies results with percentages', async () => {
    const committee = await seedUser(ctx, { roles: ['committee'] });
    const { poll } = await publishedPoll(committee, { resultVisibility: 'public' });
    const voters = [
      await seedUser(ctx, { roles: ['member'] }),
      await seedUser(ctx, { roles: ['member'] }),
      await seedUser(ctx, { roles: ['member'] }),
      await seedUser(ctx, { roles: ['member'] }),
    ];
    for (const v of voters.slice(0, 3)) await post(`/api/v1/surveys/${poll.id}/responses`, v.headers, { optionIds: ['opt_1'] });
    await post(`/api/v1/surveys/${poll.id}/responses`, voters[3].headers, { optionIds: ['opt_2'] });

    const closed = await post(`/api/v1/surveys/${poll.id}/close`, committee.headers);
    expect(closed.status).toBe(200);
    const body = (await closed.json()).data;
    expect(body.status).toBe('closed');
    expect(body.totalResponses).toBe(4);

    const results = (await (await get(`/api/v1/surveys/${poll.id}/results`)).json()).data;
    const first = results.results.find((r: any) => r.optionId === 'opt_1');
    const second = results.results.find((r: any) => r.optionId === 'opt_2');
    expect(first.votes).toBe(3);
    expect(first.percentage).toBe(75);
    expect(second.percentage).toBe(25);

    const again = await post(`/api/v1/surveys/${poll.id}/close`, committee.headers);
    expect(again.status).toBe(409);
  });

  it('keeps results hidden from members until published', async () => {
    const committee = await seedUser(ctx, { roles: ['committee'] });
    const { poll } = await publishedPoll(committee, { resultVisibility: 'managers_only' });
    const member = await seedUser(ctx, { roles: ['member'] });
    await post(`/api/v1/surveys/${poll.id}/responses`, member.headers, { optionIds: ['opt_1'] });

    expect((await get(`/api/v1/surveys/${poll.id}/results`, member.headers)).status).toBe(403);
    await post(`/api/v1/surveys/${poll.id}/close`, committee.headers);
    expect((await get(`/api/v1/surveys/${poll.id}/results`, member.headers)).status).toBe(403);
    expect((await get(`/api/v1/surveys/${poll.id}/results`, committee.headers)).status).toBe(200);
  });

  it('excludes official election use and tracks a follow-up action', async () => {
    const committee = await seedUser(ctx, { roles: ['committee'] });
    const election = await post('/api/v1/surveys', committee.headers, {
      title: 'President election',
      type: 'election',
      options: ['a', 'b'],
    });
    expect(election.status).toBe(422);

    const { poll } = await publishedPoll(committee);
    const action = await post(`/api/v1/surveys/${poll.id}/actions`, committee.headers, { title: 'Book the hall for blitz night' });
    expect(action.status).toBe(201);
    const actionId = (await action.json()).data.id;
    const done = await post(`/api/v1/surveys/${poll.id}/actions/${actionId}/complete`, committee.headers, { outcome: 'Hall booked' });
    expect(done.status).toBe(200);
    expect((await done.json()).data.status).toBe('done');
  });
});
