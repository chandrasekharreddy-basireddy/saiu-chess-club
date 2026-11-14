/* SaiU Chess Club — single-page application.
   No framework, no build step: hash router + fetch. Served as static assets. */

const API = ''; // same-origin: the Worker serves /api/v1/* and these assets
const TOKEN_KEY = 'scc_token';
const state = { me: null, features: [] };

/* ---------------- tiny helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const money = (paise) => '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), 3200);
}

const token = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token()) headers.authorization = `Bearer ${token()}`;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Network unavailable');
  }
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok || (json && json.ok === false)) {
    const e = new Error(json?.error?.message || `Request failed (${res.status})`);
    e.status = res.status;
    e.code = json?.error?.code;
    throw e;
  }
  return json?.data;
}
/** tolerant read: a missing endpoint never breaks a page */
async function soft(path, fallback = null) {
  try { return await api(path); } catch { return fallback; }
}

/* ---------------- session ---------------- */
async function loadMe() {
  if (!token()) { state.me = null; return; }
  try { state.me = await api('/api/v1/me'); } catch { setToken(null); state.me = null; }
}
const can = (perm) => {
  const p = state.me?.permissions || [];
  return p.includes('*') || p.includes(perm);
};
const initials = (n) => (n || 'S').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

/* ---------------- navigation ---------------- */
const NAV = [
  { group: 'Club' },
  { href: '#/', label: 'Home', ico: '⌂' },
  { href: '#/tournaments', label: 'Tournaments', ico: '♜' },
  { href: '#/arena', label: 'Arena', ico: '⚔' },
  { href: '#/leaderboard', label: 'Leaderboard', ico: '★' },
  { href: '#/academy', label: 'Academy', ico: '❋' },
  { group: 'Community' },
  { href: '#/notices', label: 'Notice board', ico: '❐' },
  { href: '#/events', label: 'Events', ico: '◷' },
  { href: '#/community', label: 'Community', ico: '◍' },
  { href: '#/media', label: 'Gallery', ico: '▤' },
  { group: 'Operations' },
  { href: '#/dashboard', label: 'Dashboard', ico: '▦', auth: true },
  { href: '#/finance', label: 'Finance', ico: '₹', auth: true },
  { href: '#/members', label: 'Members', ico: '☰', auth: true },
];

function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = '';
  for (const item of NAV) {
    if (item.group) { nav.append(el('div', { class: 'nav-group' }, item.group)); continue; }
    if (item.auth && !state.me) continue;
    const active = location.hash === item.href || (item.href !== '#/' && location.hash.startsWith(item.href));
    nav.append(el('a', { class: 'nav-item' + (active ? ' active' : ''), href: item.href }, el('span', { class: 'nav-ico' }, item.ico), item.label));
  }
}

function renderTopbar() {
  const right = $('#topbarRight');
  right.innerHTML = '';
  if (state.me) {
    right.append(el('span', { class: 'pill gold' }, (state.me.roles?.[0] || 'member')));
    right.append(el('div', { class: 'avatar', title: state.me.name || state.me.id }, initials(state.me.name || 'SaiU')));
    right.append(el('button', { class: 'btn btn-sm btn-ghost', onclick: logout }, 'Sign out'));
  } else {
    right.append(el('a', { class: 'btn btn-sm', href: '#/login' }, 'Sign in'));
    right.append(el('a', { class: 'btn btn-sm btn-primary', href: '#/register' }, 'Join the club'));
  }
}

async function logout() {
  await soft('/api/v1/auth/logout', { method: 'POST' });
  setToken(null);
  state.me = null;
  renderTopbar(); renderNav();
  toast('Signed out');
  location.hash = '#/';
}

/* ---------------- reusable blocks ---------------- */
function statCard(k, l) { return el('div', { class: 'stat' }, el('div', { class: 'k' }, k), el('div', { class: 'l' }, l)); }

function emptyState(text, action) {
  return el('div', { class: 'empty' }, text, action ? el('div', { style: 'margin-top:12px' }, action) : null);
}

function statusPill(status) {
  const s = String(status || '').toLowerCase();
  const tone = /approv|confirm|complete|active|published|resolved|done|live|open/.test(s) ? 'green'
    : /pending|draft|proposed|waitlist|review|progress|scheduled/.test(s) ? 'gold'
    : /reject|cancel|suspend|disput|fail|overdue|closed/.test(s) ? 'red' : '';
  return el('span', { class: 'pill ' + tone }, status || 'unknown');
}

function loading(n = 3) {
  return el('div', { class: 'stack' }, ...Array.from({ length: n }, () => el('div', { class: 'skel' })));
}

/* ---------------- views ---------------- */
const views = {};

views['#/'] = async () => {
  const [tournaments, notices, top] = await Promise.all([
    soft('/api/v1/tournaments', []),
    soft('/api/v1/notices', []),
    soft('/api/v1/ratings/leaderboard?limit=5', []),
  ]);
  const list = Array.isArray(tournaments) ? tournaments : tournaments?.items || [];
  const noticeList = Array.isArray(notices) ? notices : notices?.items || [];
  const players = Array.isArray(top) ? top : top?.items || [];

  const board = el('div', { class: 'board' });
  for (let i = 0; i < 64; i++) {
    const dark = (Math.floor(i / 8) + i) % 2 === 0;
    const piece = { 1: '♜', 6: '♟', 57: '♙', 62: '♖' }[i];
    board.append(el('span', { class: (dark ? 'l' : '') + (piece ? ' p' : '') }, piece || ''));
  }

  const view = el('div', {},
    el('section', { class: 'hero' },
      el('div', {},
        el('div', { class: 'eyebrow' }, 'Sai University · Est. 2026'),
        el('h1', { html: 'The club that plays<br>every <em>move</em> in the open.' }),
        el('p', { class: 'lede' }, 'Tournaments, ratings, the arena, the academy and the whole operation of the SaiU Chess Club — on one zero-cost platform.'),
        el('div', { class: 'hero-actions' },
          el('a', { class: 'btn btn-primary', href: '#/tournaments' }, 'Browse tournaments'),
          el('a', { class: 'btn', href: '#/arena' }, 'Enter the arena'),
          el('a', { class: 'btn btn-ghost', href: '#/features' }, `${state.features.length || 50} features →`),
        ),
      ),
      board,
    ),
    el('section', { class: 'section' },
      el('div', { class: 'grid g4' },
        statCard(String(state.features.length || 50), 'Features live'),
        statCard(String(list.length), 'Tournaments'),
        statCard(String(players.length ? players.length : '—'), 'Ranked players'),
        statCard('₹0', 'Platform cost'),
      ),
    ),
    el('section', { class: 'section' },
      el('div', { class: 'section-head' }, el('div', {}, el('h2', {}, 'Upcoming tournaments'), el('div', { class: 'muted' }, 'Registration opens per event'))),
      list.length
        ? el('div', { class: 'grid g3' }, ...list.slice(0, 6).map((t) =>
            el('a', { class: 'card', href: `#/tournaments/${t.id}` },
              el('div', { class: 'between' }, el('h3', {}, t.name || 'Tournament'), statusPill(t.status)),
              el('div', { class: 'muted', style: 'font-size:13px;margin-top:6px' },
                `${t.format || 'swiss'} · ${t.rounds || '?'} rounds · ${fmtDate(t.startsAt)}`),
              el('div', { class: 'row', style: 'margin-top:12px' },
                el('span', { class: 'pill' }, `${t.confirmedCount ?? t.capacity ?? 0} players`),
                t.venue ? el('span', { class: 'pill' }, t.venue) : null),
            )))
        : emptyState('No tournaments yet. The first one is created by an organizer.', el('a', { class: 'btn btn-sm', href: '#/tournaments' }, 'Open tournaments')),
    ),
    el('section', { class: 'section' },
      el('div', { class: 'grid g2' },
        el('div', { class: 'card' },
          el('div', { class: 'between' }, el('h2', {}, 'Notice board'), el('a', { class: 'btn btn-sm btn-ghost', href: '#/notices' }, 'All')),
          el('div', { class: 'stack', style: 'margin-top:12px' },
            noticeList.length
              ? noticeList.slice(0, 4).map((n) => el('div', { class: 'card-flat' },
                  el('div', { style: 'font-size:14px' }, n.title || 'Notice'),
                  el('div', { class: 'dim', style: 'font-size:12px;margin-top:4px' }, fmtDate(n.publishedAt || n.createdAt))))
              : el('div', { class: 'dim' }, 'Nothing posted yet.')),
        ),
        el('div', { class: 'card' },
          el('div', { class: 'between' }, el('h2', {}, 'Top rated'), el('a', { class: 'btn btn-sm btn-ghost', href: '#/leaderboard' }, 'All')),
          el('div', { class: 'stack', style: 'margin-top:12px' },
            players.length
              ? players.slice(0, 5).map((p, i) => el('div', { class: 'between', style: 'padding:6px 0;border-bottom:1px solid var(--line-soft)' },
                  el('div', { class: 'row' }, el('span', { class: 'mono dim' }, String(i + 1).padStart(2, '0')), el('span', {}, p.name || p.playerName || p.playerId)),
                  el('span', { class: 'mono' }, String(p.rating ?? p.elo ?? '—'))))
              : el('div', { class: 'dim' }, 'No rated games yet.')),
        ),
      ),
    ),
  );
  return view;
};

views['#/tournaments'] = async () => {
  const data = await soft('/api/v1/tournaments', []);
  const list = Array.isArray(data) ? data : data?.items || [];
  const canCreate = can('tournament.create');

  const form = el('form', { class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const t = await api('/api/v1/tournaments', { method: 'POST', body: {
          name: f.get('name'), format: f.get('format'), rounds: Number(f.get('rounds')),
          capacity: Number(f.get('capacity')), startsAt: f.get('startsAt') ? new Date(String(f.get('startsAt'))).toISOString() : null,
          venue: f.get('venue') || null,
        } });
        toast('Tournament created');
        location.hash = `#/tournaments/${t.id}`;
      } catch (err) { toast(err.message, true); }
    } },
    el('h3', {}, 'Create a tournament'),
    el('div', { class: 'field' }, el('label', {}, 'Name'), el('input', { name: 'name', required: true, placeholder: 'SaiU Open 2026' })),
    el('div', { class: 'grid g2' },
      el('div', { class: 'field' }, el('label', {}, 'Format'),
        el('select', { name: 'format' }, ...['swiss', 'round_robin', 'knockout', 'arena'].map((f) => el('option', { value: f }, f)))),
      el('div', { class: 'field' }, el('label', {}, 'Rounds'), el('input', { name: 'rounds', type: 'number', min: '1', max: '20', value: '5' })),
    ),
    el('div', { class: 'grid g2' },
      el('div', { class: 'field' }, el('label', {}, 'Capacity'), el('input', { name: 'capacity', type: 'number', min: '2', value: '64' })),
      el('div', { class: 'field' }, el('label', {}, 'Starts'), el('input', { name: 'startsAt', type: 'datetime-local' })),
    ),
    el('div', { class: 'field' }, el('label', {}, 'Venue'), el('input', { name: 'venue', placeholder: 'Central Library Hall' })),
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Create tournament'),
  );

  return el('div', {},
    el('div', { class: 'section-head' },
      el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 01 · 02 · 03'), el('h1', {}, 'Tournaments'), el('p', { class: 'lede' }, 'Registration, attendance, formats and scheduling — with President and Administrator approval before a schedule goes live.')),
    ),
    el('div', { class: 'grid', style: 'grid-template-columns:1.6fr 1fr;align-items:start' },
      el('div', { class: 'stack' },
        list.length
          ? el('div', { class: 'card', style: 'padding:0;overflow:hidden' },
              el('table', { class: 'table' },
                el('thead', {}, el('tr', {}, ...['Tournament', 'Format', 'Starts', 'Players', 'Status', ''].map((h) => el('th', {}, h)))),
                el('tbody', {}, ...list.map((t) => el('tr', {},
                  el('td', {}, el('a', { href: `#/tournaments/${t.id}`, style: 'font-weight:500' }, t.name || '—')),
                  el('td', { class: 'dim' }, t.format || '—'),
                  el('td', { class: 'dim' }, fmtDate(t.startsAt)),
                  el('td', { class: 'num' }, String(t.confirmedCount ?? '—')),
                  el('td', {}, statusPill(t.status)),
                  el('td', {}, el('a', { class: 'btn btn-sm btn-ghost', href: `#/tournaments/${t.id}` }, 'Open')),
                )))))
          : emptyState('No tournaments yet.'),
        canCreate ? form : el('div', { class: 'card' }, el('div', { class: 'muted' }, 'Only organizers, Presidents and Administrators can create tournaments.')),
      ),
    ),
  );
};

views['#/tournaments/:id'] = async (id) => {
  const t = await soft(`/api/v1/tournaments/${id}`, null);
  if (!t) return emptyState('Tournament not found.');
  const regs = t.registrations || [];
  const mine = regs.find((r) => r.playerId === state.me?.id);

  const act = async (path, body, okMsg) => {
    try { await api(path, { method: 'POST', body }); toast(okMsg); route(); }
    catch (e) { toast(e.message, true); }
  };

  return el('div', {},
    el('a', { class: 'btn btn-sm btn-ghost', href: '#/tournaments' }, '← All tournaments'),
    el('div', { class: 'section-head', style: 'margin-top:16px' },
      el('div', {}, el('div', { class: 'eyebrow' }, t.format || 'swiss'), el('h1', {}, t.name), el('div', { class: 'row' }, statusPill(t.status), el('span', { class: 'pill' }, `${t.rounds} rounds`), el('span', { class: 'pill' }, `${t.confirmedCount ?? 0}/${t.capacity} players`), t.venue ? el('span', { class: 'pill' }, t.venue) : null)),
      el('div', { class: 'row' },
        state.me && !mine && t.status !== 'draft' ? el('button', { class: 'btn btn-primary', onclick: () => act(`/api/v1/tournaments/${id}/register`, {}, 'Registered') }, 'Register') : null,
        mine && mine.status !== 'withdrawn' ? el('button', { class: 'btn', onclick: () => act(`/api/v1/tournaments/${id}/withdraw`, {}, 'Withdrawn') }, `Withdraw (${mine.status})`) : null,
        can('tournament.manage') || can('tournament.create') ? el('button', { class: 'btn', onclick: () => act(`/api/v1/tournaments/${id}/registration/open`, {}, 'Registration open') }, 'Open registration') : null,
        can('tournament.schedule.propose') || can('tournament.manage') ? el('button', { class: 'btn', onclick: () => act(`/api/v1/tournaments/${id}/schedule/propose`, {}, 'Schedule proposed') }, 'Propose schedule') : null,
        can('tournament.schedule.approve_president') || can('*') ? el('button', { class: 'btn', onclick: () => act(`/api/v1/tournaments/${id}/schedule/approve`, {}, 'Schedule approved') }, 'Approve schedule') : null,
      ),
    ),
    el('div', { class: 'grid g2', style: 'align-items:start' },
      el('div', { class: 'card', style: 'padding:0;overflow:hidden' },
        el('div', { style: 'padding:14px 16px;border-bottom:1px solid var(--line)' }, el('h3', {}, 'Registrations')),
        regs.length ? el('table', { class: 'table' },
          el('thead', {}, el('tr', {}, ...['Player', 'Status', 'Registered'].map((h) => el('th', {}, h)))),
          el('tbody', {}, ...regs.map((r) => el('tr', {},
            el('td', {}, r.playerId === state.me?.id ? 'You' : r.playerId),
            el('td', {}, statusPill(r.status)),
            el('td', { class: 'dim' }, fmtDate(r.registeredAt)),
          )))) : el('div', { class: 'empty' }, 'No registrations yet.'),
      ),
      el('div', { class: 'stack' },
        el('div', { class: 'card' },
          el('h3', {}, 'Schedule'),
          el('div', { class: 'row', style: 'margin:8px 0' }, statusPill(t.scheduleStatus || 'none')),
          t.schedule?.length
            ? el('table', { class: 'table' }, el('tbody', {}, ...t.schedule.map((r) => el('tr', {}, el('td', {}, `Round ${r.round}`), el('td', { class: 'dim' }, fmtDateTime(r.startsAt))))))
            : el('div', { class: 'dim' }, 'Not scheduled yet.'),
        ),
        el('div', { class: 'card' }, el('h3', {}, 'Details'),
          el('div', { class: 'stack', style: 'margin-top:8px;font-size:13.5px' },
            el('div', { class: 'between' }, el('span', { class: 'dim' }, 'Format'), el('span', {}, t.format || '—')),
            el('div', { class: 'between' }, el('span', { class: 'dim' }, 'Capacity'), el('span', {}, t.capacity)),
            el('div', { class: 'between' }, el('span', { class: 'dim' }, 'Starts'), el('span', {}, fmtDateTime(t.startsAt))),
            el('div', { class: 'between' }, el('span', { class: 'dim' }, 'Created'), el('span', {}, fmtDate(t.createdAt))),
          )),
      ),
    ),
  );
};

views['#/leaderboard'] = async () => {
  const data = await soft('/api/v1/ratings/leaderboard?limit=50', []);
  const rows = Array.isArray(data) ? data : data?.items || [];
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 06 · 08'), el('h1', {}, 'Leaderboard'), el('p', { class: 'lede' }, 'Ratings follow the club Elo rules — K-factor by experience, a floor of 100 and a ceiling of 3000.'))),
    rows.length ? el('div', { class: 'card', style: 'padding:0;overflow:hidden' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, ...['#', 'Player', 'Rating', 'Games', 'W / D / L'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...rows.map((p, i) => el('tr', {},
          el('td', { class: 'mono dim' }, String(i + 1).padStart(2, '0')),
          el('td', {}, p.name || p.playerName || p.playerId || '—'),
          el('td', { class: 'num' }, String(p.rating ?? p.elo ?? '—')),
          el('td', { class: 'num' }, String(p.games ?? p.played ?? '—')),
          el('td', { class: 'mono dim' }, `${p.wins ?? 0} / ${p.draws ?? 0} / ${p.losses ?? 0}`),
        )))))
      : emptyState('No rated players yet. Ratings appear after the first confirmed results.'),
  );
};

views['#/arena'] = async () => {
  const data = await soft('/api/v1/arena', []);
  const rooms = Array.isArray(data) ? data : data?.items || [];
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 05'), el('h1', {}, 'Chess Arena'), el('p', { class: 'lede' }, 'Casual and rated games, arena tournaments and open challenges.'))),
    el('div', { class: 'grid g3' },
      ...(rooms.length ? rooms.slice(0, 9).map((r) => el('div', { class: 'card' },
        el('div', { class: 'between' }, el('h3', {}, r.name || r.mode || 'Room'), statusPill(r.status)),
        el('div', { class: 'muted', style: 'font-size:13px;margin-top:6px' }, `${r.mode || 'casual'} · ${r.timeControl || '10+0'}`),
      )) : [emptyState('No open rooms. Arena rooms appear when a game mode is started.')]),
    ),
  );
};

views['#/notices'] = async () => {
  const data = await soft('/api/v1/notices', []);
  const list = Array.isArray(data) ? data : data?.items || [];
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 18'), el('h1', {}, 'Notice board'), el('p', { class: 'lede' }, 'Official club announcements, targeted by audience and with expiry.'))),
    list.length ? el('div', { class: 'stack' }, ...list.map((n) => el('div', { class: 'card' },
      el('div', { class: 'between' }, el('h3', {}, n.title || 'Notice'), n.audience ? el('span', { class: 'pill' }, n.audience) : null),
      el('p', { class: 'muted', style: 'margin:8px 0 10px' }, n.body || n.content || ''),
      el('div', { class: 'dim', style: 'font-size:12px' }, fmtDate(n.publishedAt || n.createdAt)))))
      : emptyState('No notices published yet.'),
  );
};

views['#/events'] = async () => {
  const data = await soft('/api/v1/events', []);
  const list = Array.isArray(data) ? data : data?.items || [];
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 16 · 17'), el('h1', {}, 'Events & calendar'), el('p', { class: 'lede' }, 'Club activities with RSVP capacity, venue conflict checks and academic-year boundaries.'))),
    list.length ? el('div', { class: 'grid g3' }, ...list.map((e) => el('div', { class: 'card' },
      el('div', { class: 'between' }, el('h3', {}, e.title || e.name || 'Event'), statusPill(e.status)),
      el('div', { class: 'muted', style: 'font-size:13px;margin-top:6px' }, fmtDateTime(e.startsAt)),
      el('div', { class: 'row', style: 'margin-top:10px' }, e.venue ? el('span', { class: 'pill' }, e.venue) : null, e.capacity ? el('span', { class: 'pill' }, `${e.rsvpCount ?? 0}/${e.capacity}`) : null))))
      : emptyState('No events scheduled.'),
  );
};

views['#/academy'] = async () => {
  const data = await soft('/api/v1/academy/lessons', soft('/api/v1/academy', []));
  const list = Array.isArray(data) ? data : data?.items || [];
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 09 · 10'), el('h1', {}, 'Chess Academy'), el('p', { class: 'lede' }, 'Structured lessons and coached pathways — openings, tactics, endgames and analysis.'))),
    list.length ? el('div', { class: 'grid g3' }, ...list.map((l) => el('div', { class: 'card' },
      el('div', { class: 'between' }, el('h3', {}, l.title || 'Lesson'), statusPill(l.status || l.level)),
      el('div', { class: 'muted', style: 'font-size:13px;margin-top:6px' }, l.summary || l.description || ''))))
      : emptyState('The academy catalogue is empty. Coaches publish lessons here.'),
  );
};

views['#/community'] = async () => {
  const data = await soft('/api/v1/community/posts', soft('/api/v1/community', []));
  const list = Array.isArray(data) ? data : data?.items || [];
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 11 · 12'), el('h1', {}, 'Community'), el('p', { class: 'lede' }, 'Discussion for members and approved alumni, with moderation and reporting.'))),
    list.length ? el('div', { class: 'stack' }, ...list.map((p) => el('div', { class: 'card' },
      el('div', { class: 'between' }, el('div', {}, el('h3', {}, p.title || 'Post'), el('div', { class: 'dim', style: 'font-size:12px' }, fmtDateTime(p.createdAt))), statusPill(p.status || 'visible')),
      el('p', { class: 'muted', style: 'margin:8px 0 0' }, p.body || p.content || ''))))
      : emptyState('No posts yet.'),
  );
};

views['#/media'] = async () => {
  const data = await soft('/api/v1/media', []);
  const list = Array.isArray(data) ? data : data?.items || [];
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 28'), el('h1', {}, 'Gallery & archive'), el('p', { class: 'lede' }, 'Photographs, records and the club archive by year.'))),
    list.length ? el('div', { class: 'grid g3' }, ...list.map((m) => el('div', { class: 'card' },
      el('div', { style: 'aspect-ratio:16/10;border-radius:10px;background:linear-gradient(140deg,#1b2533,#121a26);display:grid;place-items:center;font-size:28px;color:var(--gold-soft)' }, '♟'),
      el('div', { style: 'margin-top:10px' }, el('div', {}, m.title || 'Untitled'), el('div', { class: 'dim', style: 'font-size:12px' }, m.year || fmtDate(m.createdAt))))))
      : emptyState('The archive is empty.'),
  );
};

views['#/finance'] = async () => {
  const [ledger, summary] = await Promise.all([soft('/api/v1/finance/entries', soft('/api/v1/finance', [])), soft('/api/v1/finance/summary', null)]);
  const list = Array.isArray(ledger) ? ledger : ledger?.items || [];
  const s = summary || {};
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 20'), el('h1', {}, 'Club finance'), el('p', { class: 'lede' }, 'A double-entry ledger with second-person approval and a balance that must reconcile.'))),
    el('div', { class: 'grid g3', style: 'margin-bottom:16px' },
      statCard(money(s.incomePaise ?? 0), 'Income'),
      statCard(money(s.expensePaise ?? 0), 'Expense'),
      statCard(money(s.balancePaise ?? 0), 'Balance')),
    list.length ? el('div', { class: 'card', style: 'padding:0;overflow:hidden' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, ...['Date', 'Description', 'Type', 'Amount', 'Status'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...list.map((e) => el('tr', {},
          el('td', { class: 'dim' }, fmtDate(e.createdAt)),
          el('td', {}, e.description || e.memo || '—'),
          el('td', {}, el('span', { class: 'pill ' + (e.type === 'income' ? 'green' : 'red') }, e.type || '—')),
          el('td', { class: 'num' }, money(e.amountPaise ?? e.amount)),
          el('td', {}, statusPill(e.status)),
        ))))) : emptyState('No ledger entries.'),
  );
};

views['#/members'] = async () => {
  const data = await soft('/api/v1/membership/applications', soft('/api/v1/membership', []));
  const list = Array.isArray(data) ? data : data?.items || [];
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 12 · 15'), el('h1', {}, 'Members & alumni'), el('p', { class: 'lede' }, 'Eligibility is checked against the approved university domain list; alumni need a second approver.'))),
    list.length ? el('div', { class: 'card', style: 'padding:0;overflow:hidden' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, ...['Applicant', 'Type', 'Status', 'Submitted'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...list.map((a) => el('tr', {},
          el('td', {}, a.applicantId || a.userId || '—'),
          el('td', { class: 'dim' }, a.type || 'student'),
          el('td', {}, statusPill(a.status)),
          el('td', { class: 'dim' }, fmtDate(a.createdAt)),
        ))))) : emptyState('No membership applications.'),
  );
};

views['#/dashboard'] = async () => {
  const [cmd, alerts, tasks] = await Promise.all([
    soft('/api/v1/command-centre', null),
    soft('/api/v1/alerts?status=open', []),
    soft('/api/v1/tasks?overdue=true', []),
  ]);
  const a = Array.isArray(alerts) ? alerts : alerts?.items || [];
  const t = Array.isArray(tasks) ? tasks : tasks?.items || [];
  const counts = cmd?.counts || cmd || {};
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Feature 45 · 49 · 50'), el('h1', {}, 'Command centre'), el('p', { class: 'lede' }, 'One snapshot of the club: participation, operations, risk and the academic year in view.'))),
    el('div', { class: 'grid g4' },
      statCard(String(counts.tournaments ?? counts.tournamentsCount ?? '—'), 'Tournaments'),
      statCard(String(counts.registrations ?? '—'), 'Registrations'),
      statCard(String(counts.members ?? counts.users ?? '—'), 'Members'),
      statCard(String(a.length), 'Open alerts')),
    el('div', { class: 'grid g2', style: 'margin-top:16px;align-items:start' },
      el('div', { class: 'card' }, el('h3', {}, 'Critical alerts'),
        a.length ? el('div', { class: 'stack', style: 'margin-top:10px' }, ...a.slice(0, 6).map((x) => el('div', { class: 'card-flat between' },
          el('div', {}, el('div', {}, x.title || x.message || 'Alert'), el('div', { class: 'dim', style: 'font-size:12px' }, `Level ${x.escalationLevel ?? 1}`)),
          el('span', { class: 'pill red' }, x.severity || 'high')))) : el('div', { class: 'dim', style: 'margin-top:8px' }, 'Nothing critical.')),
      el('div', { class: 'card' }, el('h3', {}, 'Overdue tasks'),
        t.length ? el('div', { class: 'stack', style: 'margin-top:10px' }, ...t.slice(0, 6).map((x) => el('div', { class: 'card-flat between' },
          el('div', {}, x.title || 'Task'), el('span', { class: 'pill gold' }, fmtDate(x.dueAt || x.dueDate))))) : el('div', { class: 'dim', style: 'margin-top:8px' }, 'Nothing overdue.')),
    ),
  );
};

views['#/features'] = async () => {
  const feats = state.features;
  return el('div', {},
    el('div', { class: 'section-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Scope'), el('h1', {}, 'The 50 features'), el('p', { class: 'lede' }, 'The fixed catalogue from the project documentation. Each row is a mounted API module; the badge shows its base path.'))),
    el('div', { class: 'stack' }, ...feats.map((f) => el('div', { class: 'feat live' },
      el('span', { class: 'n' }, String(f.id).padStart(2, '0')),
      el('div', {}, el('div', { class: 't' }, f.name), el('div', { class: 's' }, `/api/v1/${f.slug}`)),
      el('span', { class: 'pill green' }, 'live'),
    ))),
  );
};

views['#/login'] = async () => {
  return el('div', { class: 'auth-wrap' },
    el('form', { class: 'card auth-card stack', onsubmit: async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          const d = await api('/api/v1/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
          setToken(d.token);
          await boot();
          toast('Welcome back');
          location.hash = '#/';
        } catch (err) { toast(err.message, true); }
      } },
      el('h2', {}, 'Sign in'),
      el('p', { class: 'muted', style: 'margin:0 0 6px' }, 'Club accounts use the university email domain.'),
      el('div', { class: 'field' }, el('label', {}, 'Email'), el('input', { name: 'email', type: 'email', required: true, autocomplete: 'username' })),
      el('div', { class: 'field' }, el('label', {}, 'Password'), el('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in'),
      el('div', { class: 'hint' }, 'No account? ', el('a', { href: '#/register', style: 'color:var(--gold-soft)' }, 'Join the club')),
    ),
  );
};

views['#/register'] = async () => {
  return el('div', { class: 'auth-wrap' },
    el('form', { class: 'card auth-card stack', onsubmit: async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          await api('/api/v1/auth/register', { method: 'POST', body: { name: f.get('name'), email: f.get('email'), password: f.get('password') } });
          toast('Account created — sign in to continue');
          location.hash = '#/login';
        } catch (err) { toast(err.message, true); }
      } },
      el('h2', {}, 'Join the club'),
      el('p', { class: 'muted', style: 'margin:0 0 6px' }, 'Students and approved alumni. Accounts start pending verification.'),
      el('div', { class: 'field' }, el('label', {}, 'Full name'), el('input', { name: 'name', required: true })),
      el('div', { class: 'field' }, el('label', {}, 'University email'), el('input', { name: 'email', type: 'email', required: true })),
      el('div', { class: 'field' }, el('label', {}, 'Password'), el('input', { name: 'password', type: 'password', required: true, minlength: '10' }), el('div', { class: 'hint' }, 'At least 10 characters.')),
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Create account'),
    ),
  );
};

/* ---------------- router ---------------- */
function matchRoute(hash) {
  const clean = hash.split('?')[0];
  if (views[clean]) return [views[clean], []];
  const parts = clean.split('/').filter(Boolean); // ['tournaments','abc']
  for (const key of Object.keys(views)) {
    const kp = key.split('/').filter(Boolean);
    if (kp.length === parts.length && kp.every((seg, i) => seg.startsWith(':') || seg === parts[i])) {
      return [views[key], parts.map((p, i) => (kp[i].startsWith(':') ? p : null)).filter(Boolean)];
    }
  }
  return [null, []];
}

async function route() {
  const hash = location.hash || '#/';
  const view = $('#view');
  renderNav();
  const [fn, params] = matchRoute(hash);
  if (!fn) {
    view.innerHTML = '';
    view.append(emptyState('Page not found.', el('a', { class: 'btn btn-sm', href: '#/' }, 'Go home')));
    return;
  }
  view.innerHTML = '';
  view.append(loading());
  try {
    const node = await fn(...params);
    view.innerHTML = '';
    view.append(node);
    view.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  } catch (e) {
    view.innerHTML = '';
    view.append(emptyState(e.message || 'Something went wrong.'));
  }
  $('#sidebar')?.classList.remove('open');
}

/* ---------------- boot ---------------- */
async function boot() {
  await loadMe();
  state.features = (await soft('/api/v1/features', [])) || [];
  renderTopbar();
  renderNav();
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  await boot();
  route();
  $('#menuBtn')?.addEventListener('click', () => $('.sidebar')?.classList.toggle('open'));
  $('#globalSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#globalSearch')?.focus(); }
  });
});

export { api, soft, state };
