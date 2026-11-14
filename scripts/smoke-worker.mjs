/** Exercises the *built* Worker bundle the way the edge will: fetch in, Response out. */
import worker from '../dist/worker.js';

const ASSETS = {
  async fetch(req) {
    const url = new URL(req.url);
    return new Response(`asset:${url.pathname}`, { status: url.pathname === '/' ? 200 : 404 });
  },
};
const env = { ASSETS };

const call = async (path, init) => {
  const res = await worker.fetch(new Request('https://club.example' + path, init), env);
  const text = await res.text();
  return { status: res.status, body: text };
};

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const health = await call('/health');
check('health 200', health.status === 200, health.body.slice(0, 120));

const feats = await call('/api/v1/features');
const parsed = JSON.parse(feats.body);
check('features lists exactly 50', parsed.data?.length === 50, `got ${parsed.data?.length}`);
check('every feature has a slug + base path', parsed.data.every((f) => f.slug && f.base === `/api/v1/${f.slug}`));

const page = await call('/');
check('static asset fallback served', page.body === 'asset:/', page.body);

const reg = await call('/api/v1/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'smoke@saiuniversity.edu.in', password: 'correct-horse-battery', name: 'Smoke Test' }),
});
check('register 201', reg.status === 201, reg.body.slice(0, 160));

const login = await call('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'smoke@saiuniversity.edu.in', password: 'correct-horse-battery' }),
});
const token = JSON.parse(login.body).data?.token;
check('login issues a session token', !!token, login.body.slice(0, 160));

const me = await call('/api/v1/me', { headers: { authorization: `Bearer ${token}` } });
check('a new account is held in pending state', me.status === 403 && JSON.parse(me.body).error.message.includes('pending'), me.body.slice(0, 160));

const denied = await call('/api/v1/tournaments', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: 'Denied' }),
});
check('pending account cannot create a tournament (403)', denied.status === 403, denied.body.slice(0, 160));

const missing = await call('/api/v1/nope');
check('unknown route returns the error envelope', missing.status === 404 && JSON.parse(missing.body).ok === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
