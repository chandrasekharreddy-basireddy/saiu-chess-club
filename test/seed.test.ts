import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/core/app.js';
import { makeCtx } from '../src/core/testing.js';
import { seedDemo } from '../src/seed.js';

describe('Demo seed + platform wiring', () => {
  it('seeds a working club and serves it over HTTP', async () => {
    const { ctx } = makeCtx();
    const seed = await seedDemo(ctx);
    expect(seed.seeded).toBe(true);
    expect(seed.tournaments).toHaveLength(3);

    const app = buildApp(ctx);
    const list = await (await app.request('/api/v1/tournaments')).json();
    expect(list.data.length).toBe(3);

    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'president@saiuniversity.edu.in', password: seed.password }),
    });
    expect(login.status).toBe(200);
    const token = (await login.json()).data.token;

    const me = await (await app.request('/api/v1/me', { headers: { authorization: `Bearer ${token}` } })).json();
    expect(me.data.roles).toContain('president');
    expect(me.data.permissions).toContain('tournament.schedule.approve_president');
  });

  it('seeds only once', async () => {
    const { ctx } = makeCtx();
    await seedDemo(ctx);
    const second = await seedDemo(ctx);
    expect(second.seeded).toBe(false);
  });
});
