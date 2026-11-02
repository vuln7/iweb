const $ = s => document.querySelector(s);
const PAGE = 30;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!document.startViewTransition) document.documentElement.classList.add('no-vt');

const VIEWS = [
  { id: 'all', label: 'For you', icon: 'home' },
  { id: 'watch', label: 'Watch', icon: 'watch' },
  { id: 'read', label: 'Read', icon: 'read' },
  { id: 'saved', label: 'Saved', icon: 'bookmark' },
];

const state = {
  meta: [],
  metaById: {},
  profile: null,
  accounts: [],
  feed: null,
  saved: [],
  tab: 'all',
  only: null,   // source id filter
  query: '',
  list: [],
  shown: 0,
  loading: false,
};

// ---------- tiny DOM helpers (all remote text goes through textContent) ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false && kid !== '') el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  watch: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor"/>',
  read: '<path d="M6 4h9l3 3v13H6z"/><path d="M9 11h6M9 14.5h6M9 8h3"/>',
  bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
  sliders: '<path d="M5 7h9M18 7h1M5 17h3M12 17h7"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5V9H15"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  less: '<path d="M3 3l18 18M10.6 5.1C11 5 11.5 5 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3.2 4.3M6.6 6.6C4.3 8 2.7 10.2 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  play: '<path d="M7 4.8v14.4L19 12z" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M8 16 16 8M9 8h7v7"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  layers: '<path d="m12 4 8 4.5-8 4.5-8-4.5z"/><path d="m4 12.5 8 4.5 8-4.5"/>',
  muted: '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  sound: '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  comment: '<path d="M20 12a8 8 0 0 1-11.8 7L4 20l1-4.1A8 8 0 1 1 20 12z"/>',
  up: '<path d="m6 14.5 6-6 6 6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
};
function icon(name) {
  const span = document.createElement('span');
  span.style.display = 'contents';
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = n => compact.format(n);
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function timeAgo(ms) {
  const s = Math.max(1, (Date.now() - ms) / 1000);
  if (s < 60) return 'now';
  for (const [u, n] of [['y', 31536000], ['w', 604800], ['d', 86400], ['h', 3600], ['m', 60]]) if (s >= n) return `${Math.floor(s / n)}${u}`;
  return 'now';
}
const clip = (s = '', n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isHttp = u => typeof u === 'string' && /^https?:\/\//i.test(u);
const ext = (href, props, ...kids) => h('a', { href: isHttp(href) ? href : '#', target: '_blank', rel: 'noopener noreferrer', ...props }, ...kids);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// localStorage can throw (private mode, blocked storage); everything works without it.
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const lastVisit = Number(store.get('iweb.lastVisit')) || 0;
store.set('iweb.lastVisit', String(Date.now()));

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.replaceChildren(h('span', {}, msg));
  if (action) el.append(h('button', { type: 'button', onclick: () => { el.classList.remove('show'); action.run(); } }, action.label));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
}

const send = (it, action) => api('/api/feedback', { method: 'POST', body: { id: it.id, action } }).catch(e => toast(e.message));
const metaOf = it => state.metaById[it.source] || { label: it.source, color: '#949494' };

// ---------- data ----------
async function loadFeed(refresh = false) {
  state.loading = true;
  $('#refresh').classList.add('spin');
  $('#grid').setAttribute('aria-busy', 'true');
  if (!state.feed) renderSkeleton();
  try {
    state.feed = await api(`/api/feed${refresh ? '?refresh=1' : ''}`);
    cards.clear();
    await refreshAccounts().catch(() => {});
  } catch (e) {
    toast(`Couldn’t load your feed: ${e.message}`);
  } finally {
    state.loading = false;
    $('#refresh').classList.remove('spin');
    $('#grid').setAttribute('aria-busy', 'false');
  }
  renderChrome();
  if (state.tab !== 'saved') {
    refreshView();
    grid.querySelectorAll('.card').forEach(arrive);
  }
}

async function loadSaved() {
  try {
    state.saved = (await api('/api/saved')).items;
  } catch (e) {
    toast(`Couldn’t load saved posts: ${e.message}`);
  }
}

async function refreshAccounts() {
  state.accounts = (await api('/api/accounts')).accounts;
}

// ---------- chrome: views, sources, title row ----------
function renderChrome() {
  renderViews();
  renderSources();
  renderTitle();
  renderNotice();
  renderSideFoot();
}

function renderViews() {
  const make = (cls, v) => h('button', {
    type: 'button',
    class: cls,
    'aria-current': state.tab === v.id ? 'page' : null,
    onclick: () => setTab(v.id),
  }, icon(v.icon), h('span', {}, v.label));
  $('#views').replaceChildren(...VIEWS.map(v => make('nav-item', v)));
  $('#tabbar').replaceChildren(...VIEWS.map(v => make('tab', v)));
}

function sourceRows() {
  const statuses = Object.fromEntries((state.feed?.sources || []).map(s => [s.id, s]));
  const items = state.feed?.items || [];
  return state.meta.flatMap(c => {
    const s = statuses[c.id];
    if (!s || s.status === 'off') return [];
    const count = items.filter(i => i.source === c.id).length;
    const needs = s.status === 'setup' || (s.status === 'error' && !count);
    return [{ c, s, count, needs }];
  });
}

function onSource(row) {
  if (row.needs) return openSettings(state.accounts.some(a => a.id === row.c.id && !a.connected) ? 'accounts' : row.c.id);
  setOnly(state.only === row.c.id ? null : row.c.id);
}

function renderSources() {
  const rows = sourceRows();
  const total = state.feed?.items.length || 0;
  $('#sources').replaceChildren(
    h('button', { type: 'button', class: 'nav-item', 'aria-pressed': String(!state.only), onclick: () => setOnly(null) },
      h('span', { class: 'dot', style: '--src:#fff' }), h('span', {}, 'All sources'), h('span', { class: 'count num' }, total || '—')),
    ...rows.map(r => h('button', {
      type: 'button',
      class: `nav-item${r.needs ? ' dim' : ''}`,
      style: `--src:${r.c.color}`,
      'aria-pressed': String(state.only === r.c.id),
      title: r.s.errors?.join('\n') || '',
      onclick: () => onSource(r),
    }, h('span', { class: 'dot' }), h('span', {}, r.c.label), r.needs ? h('span', { class: 'flag' }, r.s.status === 'setup' ? 'Set up' : 'Error') : h('span', { class: 'count num' }, r.count))),
  );
  $('#chips').replaceChildren(
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!state.only), onclick: () => setOnly(null) }, 'All', h('span', { class: 'count num' }, total)),
    ...rows.map(r => h('button', { type: 'button', class: 'chip', style: `--src:${r.c.color}`, 'aria-pressed': String(state.only === r.c.id), onclick: () => onSource(r) },
      h('span', { class: 'dot' }), r.c.label, h('span', { class: r.needs ? 'count' : 'count num' }, r.needs ? 'Set up' : r.count))),
  );
}

function renderTitle() {
  const view = VIEWS.find(v => v.id === state.tab);
  const source = state.only && state.metaById[state.only]?.label;
  $('#title').textContent = source && state.tab === 'all' ? source : source ? `${view.label} · ${source}` : view.label;

  const f = state.feed;
  const finding = $('#finding');
  if (!f) {
    finding.textContent = state.loading ? 'Gathering everything you follow…' : '';
    $('#stamp').textContent = '';
    return;
  }
  $('#stamp').textContent = `Updated ${clock(f.generatedAt)}`;
  if (state.tab === 'saved') {
    finding.textContent = `${state.saved.length} saved ${state.saved.length === 1 ? 'post' : 'posts'}. Saving teaches your feed what to show more of.`;
    return;
  }
  const items = f.items;
  const live = f.sources.filter(s => s.count > 0).length;
  const fresh = lastVisit ? items.filter(i => i.createdAt > lastVisit).length : 0;
  const matched = items.filter(i => i.why?.some(w => w.startsWith('Matches'))).length;
  const parts = [];
  if (fresh) parts.push(h('span', {}, h('b', {}, `${fresh} new`), ` since ${clock(lastVisit)}`));
  else parts.push(h('span', {}, `${items.length} posts from ${live} ${live === 1 ? 'source' : 'sources'}`));
  if (matched) parts.push(h('span', {}, ` · ${matched} match your interests`));
  finding.replaceChildren(...parts);
}

function renderNotice() {
  const slot = $('#notice');
  const open = state.accounts.filter(a => !a.connected);
  if (state.tab !== 'all' || store.get('iweb.notice.dismissed') || !open.length || state.accounts.some(a => a.connected)) return slot.replaceChildren();
  const el = h('section', { class: 'notice', 'aria-label': 'Connect accounts' },
    h('div', { class: 'notice-text' },
      h('strong', {}, 'Bring in what you already follow'),
      h('span', {}, `Sign in with ${open.map(a => a.label).join(' or ')} and your subscriptions join this board.`)),
    h('div', { class: 'notice-actions' },
      h('button', { type: 'button', class: 'pill small', onclick: () => openSettings('accounts') }, 'Connect accounts'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss', onclick: () => { store.set('iweb.notice.dismissed', '1'); el.remove(); } }, icon('close'))));
  slot.replaceChildren(el);
}

function renderSideFoot() {
  const connected = state.accounts.filter(a => a.connected);
  $('#side-foot').replaceChildren(
    h('button', { type: 'button', class: 'nav-item', onclick: () => openSettings() }, icon('sliders'), h('span', {}, 'Tune feed')),
    h('button', { type: 'button', class: 'nav-item me', onclick: () => openSettings('accounts') },
      connected.length
        ? h('span', { class: 'avatar-stack' }, connected.map(a => h('span', { style: `--src:${state.metaById[a.id]?.color || '#888'}` }, a.label[0])))
        : icon('layers'),
      h('span', {}, h('strong', {}, connected.length ? `${connected.length} ${connected.length === 1 ? 'account' : 'accounts'} connected` : 'No accounts connected'), connected.map(a => a.name).filter(Boolean).join(', ') || 'Connect YouTube or Reddit')),
  );
}

// ---------- views ----------
function visibleItems() {
  let list = state.tab === 'saved' ? state.saved : state.feed?.items || [];
  list = list.filter(i => !i.hidden);
  if (state.tab === 'watch') list = list.filter(i => i.media && i.media.type !== 'image');
  if (state.tab === 'read') list = list.filter(i => !i.media || i.media.type === 'image');
  if (state.only) list = list.filter(i => i.source === state.only);
  const q = state.query.trim().toLowerCase();
  if (q) {
    list = list.filter(i => [i.title, i.text, i.author, i.authorHandle, i.community, i.domain, metaOf(i).label].join(' ').toLowerCase().includes(q));
  }
  return list;
}

function toBoardTop() {
  const y = $('.title-row').getBoundingClientRect().top + scrollY - 80;
  if (scrollY > y) scrollTo({ top: Math.max(0, y) });
}

async function setTab(id) {
  if (state.tab === id) return toBoardTop();
  state.tab = id;
  if (id === 'saved') await loadSaved();
  renderViews();
  renderTitle();
  renderNotice();
  toBoardTop();
  flip(refreshView);
}

function setOnly(id) {
  state.only = id;
  renderSources();
  renderTitle();
  toBoardTop();
  flip(refreshView);
}

// ---------- the board: masonry by shortest column ----------
// For you, unfiltered, reads in chapters: the top of the feed, one per interest or followed feed,
// then everything else. Every other view is a single chapter with no heading.
const grid = $('#grid');
const cards = new Map(); // item id → element, kept across layouts so cards can glide to new places
const opened = new Set(); // chapters the reader expanded; they stay open across relayouts
let boards = []; // { id, title, reason, items, shown, paged, capped, top, cols, more }
const TOP = 4;

function colCount() {
  const w = grid.clientWidth;
  return w >= 1380 ? 5 : w >= 1060 ? 4 : w >= 700 ? 3 : 2;
}

const topicTitle = t => (t.length <= 2 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1));
const feedTitle = reason => (reason === 'You’re subscribed' ? 'Your YouTube subscriptions' : reason.replace(/^From your /, 'Your '));

function chapterize(list) {
  if (state.tab !== 'all' || state.only || state.query.trim() || list.length <= TOP * 4) {
    return [{ id: 'all', items: list, paged: true }];
  }
  const order = new Map(list.map((it, i) => [it.id, i]));
  const groups = new Map();
  const rest = [];
  for (const it of list.slice(TOP)) {
    const reason = it.why?.find(w => w.startsWith('Matches “')) || it.fromAccount;
    if (!reason) { rest.push(it); continue; }
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(it);
  }
  const chapters = [{ id: 'top', title: 'Top picks', items: list.slice(0, TOP), top: true }];
  for (const [reason, items] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    if (items.length < 3) { rest.push(...items); continue; }
    const topic = reason.startsWith('Matches “');
    chapters.push({ id: reason, reason, items, capped: true, title: topic ? topicTitle(reason.slice(9, -1)) : feedTitle(reason) });
  }
  rest.sort((a, b) => order.get(a.id) - order.get(b.id));
  if (rest.length) chapters.push({ id: 'rest', title: 'Everything else', items: rest, paged: true });
  return chapters;
}

// Two rows of a chapter, unless the reader opened it or only a couple more would be left behind.
function capOf(b, n) {
  if (b.paged) return Math.min(state.shown, b.items.length);
  if (!b.capped || opened.has(b.id)) return b.items.length;
  const cap = Math.max(4, n * 2);
  return b.items.length <= cap + 2 ? b.items.length : cap;
}

function cardFor(it) {
  let el = cards.get(it.id);
  if (!el) {
    el = card(it);
    cards.set(it.id, el);
  }
  return el;
}

function place(b, el) {
  let best = b.cols[0];
  for (const c of b.cols) if (c.offsetHeight < best.offsetHeight - 2) best = c;
  best.append(el);
}

function fill(b, upto, animate) {
  for (const it of b.items.slice(b.shown, upto)) {
    const el = cardFor(it);
    el.classList.toggle('said', !!b.reason && it.why?.[0] === b.reason); // the heading already says why
    place(b, el);
    if (animate) arrive(el);
  }
  b.shown = Math.max(b.shown, upto);
  if (b.more) renderMore(b);
}

function chapterHead(b, i) {
  const fresh = lastVisit ? b.items.filter(it => it.createdAt > lastVisit).length : 0;
  return h('header', { class: 'chapter-head' },
    h('h2', { id: `chapter-${i}` }, b.title),
    !b.top && h('span', { class: 'chapter-meta' },
      h('span', { class: 'num' }, b.items.length), b.items.length === 1 ? ' post' : ' posts',
      fresh > 0 && [' · ', h('span', { class: 'num' }, fresh), ' new']));
}

// The top of the feed reads like a front page: one lead story with a picture, the rest as lines beside it.
function lead(b) {
  const first = b.items.find(it => it.media && isHttp(it.media.thumb)) || b.items[0];
  const main = cardFor(first);
  main.classList.remove('said');
  b.shown = b.items.length;
  return h('div', { class: 'lead' },
    h('div', { class: 'lead-main' }, main),
    h('div', { class: 'lead-rows' }, b.items.filter(it => it !== first).map(row)));
}

function row(it) {
  const meta = metaOf(it);
  const name = displayName(it, meta);
  const pic = it.media && isHttp(it.media.thumb) && h('div', { class: 'row-thumb' }, h('img', {
    src: it.media.thumb, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
    onload: e => e.target.parentNode.classList.add('loaded'),
    onerror: e => e.target.parentNode.remove(),
  }));
  return h('article', { class: `row${it.liked ? ' saved' : ''}`, style: `--src:${meta.color}`, 'data-id': it.id },
    h('button', { type: 'button', class: 'hit', 'aria-label': `Open: ${it.title || clip(it.text) || name}`, onclick: () => openPlate(it) }),
    h('div', { class: 'row-body' },
      h('div', { class: 'who' },
        avatar(it, meta),
        h('span', { class: 'name' }, name),
        h('span', { class: 'via' }, `· ${meta.label}`),
        h('time', { datetime: new Date(it.createdAt).toISOString(), title: new Date(it.createdAt).toLocaleString() }, timeAgo(it.createdAt))),
      h('h3', { class: 'title' }, it.title || clip(it.text, 160)),
      it.why?.length > 0 && h('p', { class: 'why' }, it.why[0])),
    pic);
}

function renderMore(b) {
  const left = b.items.length - b.shown;
  b.more.replaceChildren(!b.paged && left > 0 ? h('button', {
    type: 'button',
    class: 'pill small',
    'aria-label': `Show ${left} more in ${b.title}`,
    onclick: () => { opened.add(b.id); flip(() => fill(b, b.items.length)); },
  }, `Show ${left} more`) : '');
}

function layout() {
  grid.style.minHeight = `${grid.offsetHeight}px`; // keep the page tall mid-rebuild so the scroll position holds
  const n = colCount();
  boards = chapterize(state.list);
  grid.replaceChildren(...boards.map((b, i) => {
    if (b.top) return h('section', { class: 'chapter is-top', 'aria-labelledby': `chapter-${i}` }, chapterHead(b, i), lead(b));
    b.cols = Array.from({ length: n }, () => h('div', { class: 'col' }));
    b.shown = 0;
    const masonry = h('div', { class: 'masonry' }, ...b.cols);
    if (!b.title) return h('section', { class: 'chapter', 'aria-labelledby': 'chapter-0' }, h('h2', { id: 'chapter-0', class: 'sr-only' }, 'Posts'), masonry);
    b.more = h('div', { class: 'chapter-more' });
    return h('section', { class: 'chapter', 'aria-labelledby': `chapter-${i}` }, chapterHead(b, i), masonry, b.more);
  }));
  for (const b of boards) if (!b.top) fill(b, capOf(b, n));
  grid.style.minHeight = '';
}

function refreshView() {
  state.list = visibleItems();
  state.shown = Math.min(PAGE, state.list.length);
  draw();
}

function relayout() {
  state.list = visibleItems();
  state.shown = Math.min(Math.max(state.shown, PAGE), state.list.length);
  draw();
}

function draw() {
  const reels = state.tab === 'watch';
  document.body.classList.toggle('reels-mode', reels);
  if (reels) {
    boards = [];
    grid.replaceChildren();
    state.shown = state.list.length;
    renderReels();
    $('#end').textContent = '';
    return;
  }
  stopReels();
  if (!state.list.length) {
    boards = [];
    grid.replaceChildren(emptyState());
  } else {
    layout();
  }
  renderEnd();
}

const pagedBoard = () => boards.find(b => b.paged);

function appendPage() {
  const b = pagedBoard();
  if (!b || b.shown >= b.items.length) return;
  state.shown = Math.min(b.shown + PAGE, b.items.length);
  fill(b, state.shown, true);
  renderEnd();
}

function renderEnd() {
  const b = pagedBoard();
  const done = b && b.shown >= b.items.length;
  $('#end').textContent = done ? (state.tab === 'saved' ? 'That’s everything you’ve saved.' : 'You’re caught up.') : '';
}

new IntersectionObserver(entries => {
  if (entries[0].isIntersecting) appendPage();
}, { rootMargin: '1400px' }).observe($('#sentinel'));

let lastCols = 0;
new ResizeObserver(() => {
  const n = colCount();
  if (boards.length && n !== lastCols) flip(layout);
  lastCols = n;
}).observe(grid);

function renderSkeleton() {
  const heights = [260, 180, 320, 220, 200, 300, 160, 240, 280, 190];
  boards = [];
  const cols = Array.from({ length: colCount() }, () => h('div', { class: 'col' }));
  heights.forEach((ht, i) => cols[i % cols.length].append(h('div', { class: 'skel', 'aria-hidden': 'true' },
    h('div', { class: 'block', style: `height:${ht}px` }), h('div', { class: 'line' }), h('div', { class: 'line short' }))));
  grid.replaceChildren(h('div', { class: 'masonry' }, ...cols));
}

function emptyState() {
  if (state.query) {
    return h('div', { class: 'empty' }, h('h2', {}, `Nothing matches “${state.query}”`), h('p', {}, 'Try a shorter word, or search every source.'),
      h('button', { type: 'button', class: 'pill', onclick: () => { $('#find').value = ''; state.query = ''; flip(refreshView); } }, 'Clear search'));
  }
  if (state.tab === 'saved') {
    return h('div', { class: 'empty' }, h('h2', {}, 'Nothing saved yet'), h('p', {}, 'Save anything you enjoy. It lands here, and your feed learns to show more like it.'));
  }
  if (state.only) {
    return h('div', { class: 'empty' }, h('h2', {}, `No posts from ${metaOf({ source: state.only }).label} in this view`), h('p', {}, 'Switch views, or show every source.'),
      h('button', { type: 'button', class: 'pill', onclick: () => setOnly(null) }, 'Show all sources'));
  }
  return h('div', { class: 'empty' }, h('h2', {}, 'Your board is empty'), h('p', {}, 'Connect an account or add a few sources, and iweb builds your feed from them.'),
    h('button', { type: 'button', class: 'pill primary', onclick: () => openSettings('accounts') }, 'Add sources'));
}

// ---------- motion ----------
// FLIP: remember where cards were, change the layout, then glide each from old to new.
function flip(mutate) {
  if (!motionOK()) return mutate();
  const vh = innerHeight;
  const before = new Map();
  for (const el of grid.querySelectorAll('.card')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > -200 && r.top < vh + 200) before.set(el, r);
  }
  mutate();
  let fresh = 0;
  for (const el of grid.querySelectorAll('.card')) {
    const r = el.getBoundingClientRect();
    if (r.bottom < -200 || r.top > vh + 200) continue;
    const b = before.get(el);
    if (!b) {
      el.animate([{ opacity: 0, transform: 'translateY(12px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
        { duration: 420, delay: Math.min(fresh++ * 30, 300), easing: EASE, fill: 'backwards' });
      continue;
    }
    const dx = b.left - r.left, dy = b.top - r.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 560, easing: EASE });
  }
}

// A slide arriving as the board grows: a short rise, never hiding content without script.
const arrivals = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    arrivals.unobserve(e.target);
    e.target.classList.add('arrive');
  }
}, { rootMargin: '0px 0px -40px 0px' });
function arrive(el) {
  if (motionOK()) arrivals.observe(el);
}

function pop(el) {
  if (motionOK()) el.animate([{ transform: 'scale(0.86)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
}

// ---------- cards ----------
function kindOf(it) {
  if (it.media && isHttp(it.media.thumb)) return 'media';
  if (!it.title && (it.text || '').length <= 260) return 'quote';
  return 'headline';
}

function displayName(it, meta) {
  if (it.source === 'reddit') return it.community || it.author;
  if (it.source === 'hackernews') return it.domain || 'Hacker News';
  if (it.source === 'rss') return it.community || it.author || meta.label;
  return it.author || meta.label;
}

function avatar(it, meta, cls = 'avatar') {
  const name = displayName(it, meta).replace(/^[@ur]\//, '').replace(/^@/, '');
  const el = h('span', { class: cls, style: `--src:${meta.color}`, 'aria-hidden': 'true' }, (name[0] || '?').toUpperCase());
  if (isHttp(it.avatar)) {
    const img = h('img', { src: it.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: () => img.remove() });
    el.replaceChildren(img);
  }
  return el;
}

function ratioOf(m) {
  if (!m.w || !m.h) return null;
  return Math.max(m.w / m.h, 0.7); // very tall pictures are cropped to 7:10, as on any board
}

function cardMedia(it) {
  const m = it.media;
  const ratio = ratioOf(m);
  const box = h('div', { class: `media${ratio ? '' : ' unsized'}`, style: ratio ? `aspect-ratio:${ratio}` : null });
  const img = h('img', {
    src: m.thumb, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
    onload: () => box.classList.add('loaded'),
    onerror: () => { box.remove(); },
  });
  box.append(img);
  if (m.type !== 'image') box.append(h('span', { class: 'play' }, icon('play')));
  return box;
}

// Figures in the figure face, words in the text face: "1.2k points · 340 comments".
function statsLine(it, meta) {
  const parts = [];
  const score = it.engagement?.score;
  if (score != null && meta.scoreLabel) parts.push([h('span', { class: 'num' }, fmt(score)), ` ${meta.scoreLabel}`]);
  if (it.discussion?.comments != null) parts.push([h('span', { class: 'num' }, fmt(it.discussion.comments)), ' comments']);
  return parts.flatMap((p, i) => (i ? [' · ', ...p] : p));
}

function saveControl(it, cls) {
  const btn = h('button', {
    type: 'button',
    class: cls,
    'data-like': it.id,
    'aria-pressed': String(!!it.liked),
    'aria-label': 'Save, and show more like this',
    title: 'Save · more like this',
    onclick: e => { e.stopPropagation(); toggleSave(it); },
  }, icon('bookmark'), cls === 'act' ? null : h('span', { class: 'lbl' }, it.liked ? 'Saved' : 'Save'));
  return btn;
}

function lessControl(it) {
  return h('button', {
    type: 'button',
    class: 'act',
    'aria-label': 'Less like this',
    title: 'Less like this',
    onclick: e => { e.stopPropagation(); hideItem(it); },
  }, icon('less'));
}

function card(it) {
  const meta = metaOf(it);
  const kind = kindOf(it);
  const name = displayName(it, meta);
  const el = h('article', { class: `card is-${kind}${it.liked ? ' saved' : ''}`, style: `--src:${meta.color}`, 'data-id': it.id });
  el.append(h('button', { type: 'button', class: 'hit', 'aria-label': `Open: ${it.title || clip(it.text) || name}`, onclick: () => openPlate(it) }));
  if (kind === 'media') {
    const media = cardMedia(it);
    media.append(saveControl(it, 'save-pill'));
    el.append(media);
  }
  const stats = statsLine(it, meta);
  el.append(h('div', { class: 'body' },
    h('div', { class: 'who' },
      avatar(it, meta),
      h('span', { class: 'name' }, name),
      h('span', { class: 'via' }, `· ${meta.label}`),
      h('time', { datetime: new Date(it.createdAt).toISOString(), title: new Date(it.createdAt).toLocaleString() }, timeAgo(it.createdAt))),
    it.title && h('h3', { class: 'title' }, it.title),
    kind === 'headline' && it.domain && it.source !== 'hackernews' && h('span', { class: 'domain' }, it.domain),
    // On a picture card the picture is the content: a title wins over its excerpt.
    it.text && !(kind === 'media' && it.title) && h('p', { class: 'text' }, it.text),
    it.why?.length > 0 && h('p', { class: 'why' }, it.why[0]),
    h('div', { class: 'foot' },
      stats.length > 0 && h('span', { class: 'stats' }, stats),
      h('div', { class: 'acts' }, lessControl(it), saveControl(it, 'act')))));
  return el;
}

function toggleSave(it) {
  it.liked = !it.liked;
  for (const b of document.querySelectorAll(`[data-like="${CSS.escape(it.id)}"]`)) {
    b.setAttribute('aria-pressed', String(it.liked));
    const lbl = b.querySelector('.lbl');
    if (lbl) lbl.textContent = it.liked ? 'Saved' : 'Save';
    pop(b);
  }
  // The feed's copy of this post and the Saved list's copy are separate objects; keep both in step.
  for (const other of [...(state.feed?.items || []), ...state.saved]) if (other.id === it.id) other.liked = it.liked;
  cards.get(it.id)?.classList.toggle('saved', it.liked);
  for (const r of grid.querySelectorAll(`.row[data-id="${CSS.escape(it.id)}"]`)) r.classList.toggle('saved', it.liked);
  reelItems.get(it.id)?.el.classList.toggle('saved', it.liked);
  send(it, it.liked ? 'like' : 'unlike');
  toast(it.liked ? 'Saved. You’ll see more like this.' : 'Removed from Saved.');
  if (!it.liked && state.tab === 'saved') {
    state.saved = state.saved.filter(s => s.id !== it.id);
    flip(relayout);
    renderTitle();
  }
}

async function hideItem(it) {
  if (state.tab === 'watch') return hideReel(it);
  const el = cards.get(it.id);
  if (el && motionOK()) {
    await el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.94)' }], { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).finished;
  }
  flip(() => { it.hidden = true; relayout(); });
  send(it, 'hide');
  toast('Hidden. You’ll see less like this.', {
    label: 'Undo',
    run: () => {
      el?.getAnimations().forEach(a => a.cancel());
      flip(() => { it.hidden = false; relayout(); });
      send(it, 'unhide');
    },
  });
}

// ---------- Watch: reels ----------
// One video per screen, snapped. Only the reel in view holds a player; the rest are posters.
const reelsEl = $('#reels');
const reelItems = new Map();
let activeReel = null;
let soundOn = false;

const ytSrc = id => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=${soundOn ? 0 : 1}&playsinline=1&rel=0&loop=1&playlist=${id}&enablejsapi=1`;
const isYouTube = m => m.type === 'youtube' && /^[\w-]{11}$/.test(m.embedId);
const playable = m => isYouTube(m) || isHttp(m.stream);

// Bluesky and Reddit serve video as HLS: hls.js (fetched once, on first need) plays it, or the browser itself.
let hlsLib = null;
function loadHls() {
  hlsLib ??= new Promise((resolve, reject) => {
    const s = h('script', { src: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js', onload: () => resolve(window.Hls), onerror: reject });
    document.head.append(s);
  });
  return hlsLib;
}

async function streamPlayer(it, frame) {
  const v = h('video', { playsinline: true, loop: true, autoplay: true, poster: it.media.thumb, preload: 'auto', 'aria-label': it.title || clip(it.text) || 'Video' });
  v.muted = !soundOn;
  const fallBack = () => { if (v.isConnected) frame.replaceChildren(...reelPoster(it, true)); };
  v.addEventListener('error', fallBack);
  // Prefer hls.js wherever Media Source exists: some Chromium builds answer "maybe" to native HLS and then fail.
  if (!(window.MediaSource || window.ManagedMediaSource) && v.canPlayType('application/vnd.apple.mpegurl')) {
    v.src = it.media.stream;
  } else {
    try {
      const Hls = await loadHls();
      if (!Hls?.isSupported()) return fallBack();
      const hls = new Hls({ capLevelToPlayerSize: true });
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fallBack(); });
      hls.loadSource(it.media.stream);
      hls.attachMedia(v);
      v.hls = hls;
    } catch {
      return fallBack();
    }
  }
  v.play().catch(() => {});
  return v;
}

function reelPoster(it, failed = false) {
  const m = it.media;
  const frame = [h('img', { class: 'reel-poster', src: m.thumb, alt: '', referrerpolicy: 'no-referrer' })];
  if (failed || !playable(m)) {
    frame.push(ext(it.discussion?.url || it.url, { class: 'reel-out' }, icon('play'), `Watch on ${metaOf(it).label}`));
  }
  return frame;
}

function reel(it) {
  const meta = metaOf(it);
  const m = it.media;
  const ratio = m.w && m.h ? `${m.w} / ${m.h}` : '16 / 9';
  const stats = it.discussion?.comments;
  const frame = h('div', { class: 'reel-frame', style: `--ratio:${ratio}` }, reelPoster(it));
  const portrait = m.w && m.h && m.h > m.w;
  const el = h('section', { class: `reel${portrait ? ' is-portrait' : ''}${it.liked ? ' saved' : ''}`, 'data-id': it.id, 'aria-label': it.title || clip(it.text) || meta.label },
    h('div', { class: 'reel-stage' },
      h('img', { class: 'reel-bg', src: m.thumb, alt: '', referrerpolicy: 'no-referrer', 'aria-hidden': 'true' }),
      frame,
      h('button', { type: 'button', class: 'reel-tap', 'aria-label': 'Play or pause. Double-tap to save', onclick: () => tapReel(it, el) }),
      h('div', { class: 'reel-shade', 'aria-hidden': 'true' }),
      h('span', { class: 'reel-flash', 'aria-hidden': 'true' }),
      playable(m) && h('div', { class: 'reel-progress', 'aria-hidden': 'true' }, h('i')),
      playable(m) && h('button', {
        type: 'button',
        class: 'reel-sound glass-btn',
        'aria-pressed': String(soundOn),
        'aria-label': soundOn ? 'Mute' : 'Turn sound on',
        onclick: toggleSound,
      }, icon(soundOn ? 'sound' : 'muted')),
      h('div', { class: 'reel-info' },
        h('div', { class: 'who' }, avatar(it, meta), h('span', { class: 'name' }, displayName(it, meta)), h('span', { class: 'via' }, `· ${meta.label}`),
          h('time', { datetime: new Date(it.createdAt).toISOString() }, timeAgo(it.createdAt))),
        h('button', { type: 'button', class: 'reel-title', onclick: () => openPlate(it) }, it.title || clip(it.text, 140)),
        it.why?.length > 0 && h('p', { class: 'reel-why' }, it.why[0])),
      h('div', { class: 'reel-rail' },
        h('button', { type: 'button', class: 'glass-btn', 'data-like': it.id, 'aria-pressed': String(!!it.liked), 'aria-label': 'Save, and show more like this', onclick: () => toggleSave(it) }, icon('bookmark')),
        h('button', { type: 'button', class: 'glass-btn', 'aria-label': 'Less like this', onclick: () => hideItem(it) }, icon('less')),
        stats != null && ext(it.discussion.url, { class: 'glass-btn rail-count', 'aria-label': `${stats} comments` }, icon('comment'), h('span', { class: 'num' }, fmt(stats))),
        ext(it.url, { class: 'glass-btn', 'aria-label': `Open on ${meta.label}` }, icon('arrow')))));
  reelItems.set(it.id, { it, el, frame });
  return el;
}

function activate(el) {
  if (activeReel === el) return;
  if (activeReel) deactivate(activeReel);
  activeReel = el;
  const r = reelItems.get(el.dataset.id);
  if (!r) return;
  // The player is laid over the poster and fades in only once it shows a picture,
  // so a slow stream never leaves the reel black.
  if (isYouTube(r.it.media)) {
    const f = h('iframe', {
      class: 'player',
      src: ytSrc(r.it.media.embedId),
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true,
      title: r.it.title || 'YouTube video',
      onload: () => f.classList.add('on'),
    });
    r.frame.append(f);
  } else if (isHttp(r.it.media.stream)) {
    streamPlayer(r.it, r.frame).then(v => {
      if (!v) return;
      if (activeReel !== el) return v.hls?.destroy();
      v.classList.add('player');
      v.addEventListener('playing', () => v.classList.add('on'), { once: true });
      const bar = el.querySelector('.reel-progress i');
      v.addEventListener('timeupdate', () => { if (bar && v.duration) bar.style.transform = `scaleX(${v.currentTime / v.duration})`; });
      r.frame.append(v);
    });
  }
}

// A tap pauses or plays; two taps save, as in any reels app.
let lastTap = 0;
let tapTimer;
function tapReel(it, el) {
  const now = Date.now();
  if (now - lastTap < 280) {
    clearTimeout(tapTimer);
    lastTap = 0;
    if (!it.liked) toggleSave(it);
    flash(el, 'bookmark');
    return;
  }
  lastTap = now;
  tapTimer = setTimeout(() => togglePlay(el), 280);
}

function togglePlay(el) {
  const player = el && reelItems.get(el.dataset.id)?.frame.querySelector('.player');
  if (!player) return;
  if (player.tagName === 'VIDEO') {
    if (player.paused) player.play().catch(() => {});
    else player.pause();
    flash(el, player.paused ? 'pause' : 'play');
  } else {
    const paused = el.dataset.paused === '1';
    player.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: paused ? 'playVideo' : 'pauseVideo', args: [] }), '*');
    el.dataset.paused = paused ? '0' : '1';
    flash(el, paused ? 'play' : 'pause');
  }
}

function flash(el, name) {
  const f = el.querySelector('.reel-flash');
  f.replaceChildren(icon(name));
  f.classList.remove('show');
  void f.offsetWidth; // restart the animation
  f.classList.add('show');
}

function deactivate(el) {
  delete el.dataset.paused;
  const bar = el.querySelector('.reel-progress i');
  if (bar) bar.style.transform = '';
  const r = reelItems.get(el.dataset.id);
  const v = r?.frame.querySelector('video');
  if (v) { v.pause(); v.hls?.destroy(); }
  if (r && (v || r.frame.querySelector('iframe'))) r.frame.replaceChildren(...reelPoster(r.it));
  if (activeReel === el) activeReel = null;
}

const reelWatcher = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (e.isIntersecting) activate(e.target);
    else if (e.target === activeReel) deactivate(e.target);
  }
}, { root: reelsEl, threshold: 0.6 });

function toggleSound() {
  soundOn = !soundOn;
  for (const b of reelsEl.querySelectorAll('.reel-sound')) {
    b.setAttribute('aria-pressed', String(soundOn));
    b.setAttribute('aria-label', soundOn ? 'Mute' : 'Turn sound on');
    b.replaceChildren(icon(soundOn ? 'sound' : 'muted'));
  }
  const frame = activeReel && reelItems.get(activeReel.dataset.id)?.frame;
  frame?.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: soundOn ? 'unMute' : 'mute', args: [] }), '*');
  const v = frame?.querySelector('video');
  if (v) v.muted = !soundOn;
}

function renderReels() {
  stopReels();
  if (!state.list.length) {
    reelsEl.replaceChildren(h('div', { class: 'empty reels-empty' },
      h('h2', {}, 'Nothing to watch yet'),
      h('p', {}, 'Videos from YouTube, and videos shared on Reddit, Bluesky and Hacker News, play here one at a time. Sign in with Google to bring in your subscriptions.'),
      h('button', { type: 'button', class: 'pill primary', onclick: () => openSettings('accounts') }, 'Connect YouTube')));
    return;
  }
  reelsEl.replaceChildren(...state.list.map(reel));
  reelsEl.scrollTop = 0;
  for (const el of reelsEl.querySelectorAll('.reel')) reelWatcher.observe(el);
}

function stopReels() {
  reelWatcher.disconnect();
  if (activeReel) deactivate(activeReel);
  reelItems.clear();
  reelsEl.replaceChildren();
}

function stepReel(d) {
  reelsEl.scrollBy({ top: d * reelsEl.clientHeight, behavior: motionOK() ? 'smooth' : 'auto' });
}

async function hideReel(it) {
  const r = reelItems.get(it.id);
  if (r && motionOK()) await r.el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }], { duration: 220, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).finished;
  it.hidden = true;
  if (r) {
    reelWatcher.unobserve(r.el);
    deactivate(r.el);
    r.el.remove();
    reelItems.delete(it.id);
  }
  state.list = visibleItems();
  send(it, 'hide');
  toast('Hidden. You’ll see less like this.', {
    label: 'Undo',
    run: () => {
      it.hidden = false;
      state.list = visibleItems();
      const next = state.list[state.list.findIndex(x => x.id === it.id) + 1];
      const el = reel(it);
      reelsEl.insertBefore(el, next ? reelItems.get(next.id)?.el || null : null);
      reelWatcher.observe(el);
      el.scrollIntoView({ block: 'start' });
      send(it, 'unhide');
    },
  });
  if (!state.list.length) renderReels();
}

$('#reels-nav').append(
  h('button', { type: 'button', class: 'glass-btn', 'aria-label': 'Previous video', onclick: () => stepReel(-1) }, icon('up')),
  h('button', { type: 'button', class: 'glass-btn', 'aria-label': 'Next video', onclick: () => stepReel(1) }, icon('down')),
);

// ---------- post view: the slide lifted off the table ----------
const plate = $('#plate');
let plateIt = null;

function transition(fn) {
  if (!document.startViewTransition || !motionOK()) {
    fn();
    return null;
  }
  return document.startViewTransition(fn);
}

function slideEl(it) {
  const el = [cards.get(it?.id), grid.querySelector(`.row[data-id="${CSS.escape(it?.id || '')}"]`)].find(e => e?.isConnected);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return null;
  return el.querySelector('.media, .row-thumb') || el;
}

function openPlate(it) {
  if (activeReel) deactivate(activeReel); // one player at a time
  const from = slideEl(it);
  if (from) from.style.viewTransitionName = 'slide';
  transition(() => {
    if (from) from.style.viewTransitionName = '';
    renderPlate(it);
    if (!plate.open) {
      plate.showModal();
      plate.querySelector('.plate-btn.close')?.focus({ preventScroll: true }); // not the scrollable sheet itself
    }
  });
  send(it, 'open');
}

function closePlate() {
  if (!plate.open) return;
  const to = slideEl(plateIt);
  const t = transition(() => {
    plate.close();
    if (to) to.style.viewTransitionName = 'slide';
  });
  const clear = () => { if (to) to.style.viewTransitionName = ''; };
  if (t) t.finished.finally(clear); else clear();
  if (state.tab === 'watch') {
    const current = reelsEl.children[Math.round(reelsEl.scrollTop / Math.max(1, reelsEl.clientHeight))];
    if (current?.classList.contains('reel')) activate(current);
  }
}

function stepPlate(d) {
  const i = state.list.findIndex(x => x.id === plateIt?.id) + d;
  if (i < 0 || i >= state.list.length) return;
  if (i >= state.shown) appendPage();
  transition(() => renderPlate(state.list[i]));
  send(state.list[i], 'open');
}

function plateMedia(it) {
  const m = it.media;
  const ratio = ratioOf(m) || null;
  const box = h('div', { class: 'plate-media', style: `view-transition-name: slide${ratio ? `; aspect-ratio: ${ratio}` : ''}` });
  const img = h('img', { src: m.thumb, alt: it.title || clip(it.text, 120) || '', referrerpolicy: 'no-referrer' });
  // The picture's own colours, blurred, fill any space the picture does not, instead of black bands.
  box.append(h('img', { class: 'plate-bg', src: m.thumb, alt: '', referrerpolicy: 'no-referrer', 'aria-hidden': 'true' }), img);
  if (isHttp(m.full) && m.full !== m.thumb) {
    // Show the card's picture at once (it is cached) and swap in the large one when it arrives.
    const hi = new Image();
    hi.referrerPolicy = 'no-referrer';
    hi.onload = () => { if (img.isConnected && hi.naturalWidth > 320) img.src = m.full; };
    hi.src = m.full;
  }
  if (m.type === 'youtube' && /^[\w-]{11}$/.test(m.embedId)) {
    box.append(h('button', {
      type: 'button',
      class: 'play-big',
      'aria-label': 'Play video',
      onclick: () => box.replaceChildren(h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${m.embedId}?autoplay=1&rel=0`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
        title: it.title || 'YouTube video',
      })),
    }, icon('play')));
  } else if (m.type === 'video') {
    box.append(ext(it.discussion?.url || it.url, { class: 'play-big', 'aria-label': `Watch on ${metaOf(it).label}` }, icon('play')));
  }
  return box;
}

function renderPlate(it) {
  plateIt = it;
  const meta = metaOf(it);
  const hasMedia = it.media && isHttp(it.media.thumb);
  const idx = state.list.findIndex(x => x.id === it.id);
  const solo = !hasMedia;
  const stats = statsLine(it, meta);

  const saveBig = h('button', {
    type: 'button',
    class: 'pill primary',
    'data-like': it.id,
    'aria-pressed': String(!!it.liked),
    onclick: () => toggleSave(it),
  }, icon('bookmark'), h('span', { class: 'lbl' }, it.liked ? 'Saved' : 'Save'));

  const info = h('div', { class: 'plate-info' },
    h('div', { class: 'plate-who' },
      avatar(it, meta, 'avatar lg'),
      h('div', {},
        h('div', { class: 'pname' }, it.author || meta.label, it.authorHandle && h('span', { class: 'handle' }, it.authorHandle)),
        h('div', { class: 'psub' }, [meta.label, it.community && it.community !== it.author ? it.community : null, new Date(it.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })].filter(Boolean).join(' · ')))),
    it.title && h('h2', { class: 'ptitle' }, it.title),
    it.text && h('p', { class: `ptext${solo && !it.title ? ' big' : ''}` }, it.text),
    it.link && ext(it.link.url, { class: 'plink' }, h('strong', {}, it.link.title || it.link.url), h('span', {}, it.link.domain)),
    it.why?.length > 0 && h('div', { class: 'pwhy', 'aria-label': 'Why you’re seeing this' }, it.why.map(w => h('span', {}, w))),
    stats.length > 0 && h('p', { class: 'pstats' }, stats),
    it.alsoOn?.length > 0 && h('div', { class: 'palso' },
      h('p', {}, 'Also discussed on'),
      it.alsoOn.map(a => ext(a.url, {}, h('span', {}, a.label), a.comments != null && h('span', { class: 'num' }, `${fmt(a.comments)} comments`), icon('arrow')))),
    h('div', { class: 'pacts' },
      saveBig,
      h('button', { type: 'button', class: 'pill', onclick: () => { plate.close(); hideItem(it); } }, icon('less'), 'Less like this'),
      ext(it.url, { class: 'pill ghost' }, it.domain && it.source !== 'reddit' ? 'Read article' : `Open on ${meta.label}`, icon('arrow')),
      it.discussion?.url && it.discussion.url !== it.url && ext(it.discussion.url, { class: 'pill ghost' }, it.discussion.comments != null ? `${fmt(it.discussion.comments)} comments` : 'Discussion', icon('arrow'))));

  const panel = h('div', { class: `plate-panel${solo ? ' solo' : ''}`, style: solo ? 'view-transition-name: slide' : null }, hasMedia && plateMedia(it), info);
  plate.replaceChildren(...[
    panel,
    h('button', { type: 'button', class: 'plate-btn close', 'aria-label': 'Close', onclick: closePlate }, icon('close')),
    idx > 0 && h('button', { type: 'button', class: 'plate-btn prev', 'aria-label': 'Previous post', onclick: () => stepPlate(-1) }, icon('left')),
    idx >= 0 && idx < state.list.length - 1 && h('button', { type: 'button', class: 'plate-btn next', 'aria-label': 'Next post', onclick: () => stepPlate(1) }, icon('right')),
  ].filter(Boolean));
  info.scrollTop = 0;
}

plate.addEventListener('cancel', e => { e.preventDefault(); closePlate(); });
plate.addEventListener('click', e => { if (e.target === plate) closePlate(); });
plate.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') stepPlate(1);
  if (e.key === 'ArrowLeft') stepPlate(-1);
});

// ---------- settings ----------
let draft = null;

async function openSettings(focus) {
  // Pick up what feedback has taught it, and any sign-in a feed refresh found broken.
  [state.profile] = await Promise.all([api('/api/profile').catch(() => state.profile), refreshAccounts().catch(() => {})]);
  draft = structuredClone(state.profile);
  renderSettings();
  $('#settings').showModal();
  if (focus) document.getElementById(focus === 'accounts' ? 'accounts' : `src-${focus}`)?.scrollIntoView({ block: 'start' });
}

function copyButton(text) {
  return h('button', {
    type: 'button',
    class: 'copy',
    onclick: async e => {
      const b = e.currentTarget;
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = 'Copied';
      } catch {
        toast('Couldn’t copy. Select the text instead.');
      }
    },
  }, 'Copy');
}

function accountCard(a) {
  const color = state.metaById[a.id]?.color || '#888';
  const head = h('div', { class: 'src-head' }, h('span', { class: 'dot' }), h('strong', {}, a.label));
  const signIn = label => h('button', {
    type: 'button',
    class: 'pill primary small',
    onclick: async () => {
      // Keep any unsaved edits; the sign-in leaves the page.
      await api('/api/profile', { method: 'PUT', body: { interests: draft.interests, freshnessHours: draft.freshnessHours, sources: draft.sources } }).catch(() => {});
      location.href = `/auth/${a.id}/start`;
    },
  }, label);
  const disconnect = h('button', {
    type: 'button',
    class: 'pill ghost small',
    onclick: async () => {
      await api('/api/accounts/disconnect', { method: 'POST', body: { provider: a.id } });
      await refreshAccounts();
      renderSettings();
      toast(`${a.label} disconnected.`);
      loadFeed();
    },
  }, 'Disconnect');

  if (a.connected && a.broken) {
    head.append(h('span', { class: 'pill-tag warn' }, 'Reconnect needed'));
    return h('div', { class: 'account', style: `--src:${color}` }, head,
      h('p', { class: 'note' }, `${a.label} stopped accepting the sign-in for ${a.name || 'your account'} (it was revoked or expired). Sign in again to keep importing ${a.imports}.`),
      h('div', { class: 'row' }, !a.missingEnv.length && signIn('Reconnect'), disconnect),
      a.missingEnv.length > 0 && h('p', { class: 'note' }, 'To reconnect, add ', a.missingEnv.map((k, i) => [i ? ' and ' : '', h('code', {}, k)]), ' to .env and restart iweb.'));
  }
  if (a.connected) {
    head.append(h('span', { class: 'pill-tag ok' }, 'Connected'));
    return h('div', { class: 'account', style: `--src:${color}` }, head,
      h('p', { class: 'note' }, `Signed in as ${a.name || a.label}. Your feed includes ${a.imports}.`),
      disconnect);
  }
  if (a.missingEnv.length) {
    head.append(h('span', { class: 'pill-tag warn' }, 'One-time setup'));
    return h('div', { class: 'account', style: `--src:${color}` }, head,
      h('p', { class: 'note' }, `Import ${a.imports}. iweb needs its own app credentials first:`),
      h('ol', { class: 'steps' },
        a.setupSteps.map((s, i) => h('li', {}, s, i === 1 && h('div', { class: 'uri' }, h('code', {}, a.redirectUri), copyButton(a.redirectUri)))),
        h('li', {}, 'Put ', a.missingEnv.map((k, i) => [i ? ' and ' : '', h('code', {}, k)]), ' in the ', h('code', {}, '.env'), ' file and restart iweb.')),
      ext(a.setupUrl, { class: 'pill small' }, 'Open developer console', icon('arrow')));
  }
  return h('div', { class: 'account', style: `--src:${color}` }, head,
    h('p', { class: 'note' }, `Import ${a.imports}. iweb only asks for read access.`),
    signIn(a.button));
}

function toggle(checked, onchange, label) {
  return h('label', { class: 'switch', title: label },
    h('input', { type: 'checkbox', checked, 'aria-label': label, onchange: e => onchange(e.target.checked) }),
    h('span'));
}

function interestsEditor() {
  const tags = h('div', { class: 'tags' });
  const paint = () => tags.replaceChildren(...draft.interests.map((i, idx) => h('span', { class: 'tag' }, i.term,
    h('button', { type: 'button', 'aria-label': `Remove ${i.term}`, onclick: () => { draft.interests.splice(idx, 1); paint(); } }, icon('close')))));
  paint();
  const input = h('input', {
    type: 'text',
    placeholder: 'Add a topic and press Enter: formula 1, cooking, rust',
    'aria-label': 'Add an interest',
    onkeydown: e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      for (const term of input.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
        if (!draft.interests.some(i => i.term === term)) draft.interests.push({ term, weight: 1 });
      }
      input.value = '';
      paint();
    },
  });
  return [tags, input];
}

function fieldEditor(f, cfg) {
  if (f.type === 'bool') {
    return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!cfg[f.key], onchange: e => (cfg[f.key] = e.target.checked) }), h('span', {}, f.label));
  }
  if (f.type === 'list') {
    const ta = h('textarea', { placeholder: f.placeholder || '', spellcheck: 'false', oninput: () => (cfg[f.key] = ta.value.split('\n')) });
    ta.value = (cfg[f.key] || []).join('\n');
    return h('label', { class: 'field' }, h('span', {}, `${f.label}, one per line`), ta);
  }
  const input = h('input', { type: 'text', placeholder: f.placeholder || '', value: cfg[f.key] || '', oninput: () => (cfg[f.key] = input.value) });
  return h('label', { class: 'field' }, h('span', {}, f.label), input);
}

function sourceEditor(c) {
  const cfg = draft.sources[c.id];
  const st = state.feed?.sources.find(s => s.id === c.id);
  const tag = !cfg.enabled ? h('span', { class: 'pill-tag' }, 'Off')
    : st?.status === 'ok' ? h('span', { class: 'pill-tag ok' }, `${st.count} posts`)
    : st?.status === 'partial' ? h('span', { class: 'pill-tag warn' }, `${st.count} posts, some failed`)
    : st?.status === 'setup' ? h('span', { class: 'pill-tag warn' }, 'Needs setup')
    : st?.status === 'error' ? h('span', { class: 'pill-tag warn' }, 'Error')
    : null;
  const errors = st && st.status !== 'off' ? st.errors || [] : [];
  const box = h('section', { class: `src-card${cfg.enabled ? '' : ' off'}`, id: `src-${c.id}`, style: `--src:${c.color}` },
    h('div', { class: 'src-head' },
      h('span', { class: 'dot' }),
      h('strong', {}, c.label),
      tag,
      toggle(cfg.enabled, v => { cfg.enabled = v; box.classList.toggle('off', !v); }, `Use ${c.label}`)),
    h('div', { class: 'src-fields' },
      c.note && h('p', { class: 'note' }, c.note),
      (c.missingEnv.length > 0 || errors.length > 0) && h('div', { class: 'warn-box' },
        c.missingEnv.length > 0 && h('div', {}, 'Add ', c.missingEnv.map((k, i) => [i ? ' and ' : '', h('code', {}, k)]), ' to the ', h('code', {}, '.env'), ' file, then restart iweb. ', c.setupUrl && ext(c.setupUrl, {}, 'Get a key')),
        errors.length > 0 && !c.missingEnv.length && h('ul', {}, errors.slice(0, 4).map(e => h('li', {}, e)))),
      h('label', { class: 'field' },
        h('span', {}, 'How much of this in your feed'),
        h('input', { type: 'range', min: 0, max: 2, step: 0.1, value: cfg.weight, oninput: e => (cfg.weight = Number(e.target.value)) }),
        h('div', { class: 'range-labels' }, h('span', {}, 'Less'), h('span', {}, 'More'))),
      c.fields.map(f => fieldEditor(f, cfg))));
  return box;
}

function renderSettings() {
  const learned = state.profile.learned;
  $('#settings-body').replaceChildren(
    h('section', { class: 'group', id: 'accounts' },
      h('h3', {}, 'Your accounts'),
      h('p', {}, 'Sign in and iweb builds your feed from what you already follow. Tokens stay on this computer.'),
      h('div', { class: 'accounts' }, state.accounts.map(accountCard))),
    h('section', { class: 'group' },
      h('h3', {}, 'What are you into?'),
      h('p', {}, 'Posts that mention these rank higher everywhere, and Hacker News and YouTube search for them.'),
      interestsEditor()),
    h('section', { class: 'group' },
      h('h3', {}, 'Freshness'),
      h('p', {}, 'How quickly older posts fade out of your feed.'),
      h('input', { type: 'range', min: 6, max: 168, step: 6, value: draft.freshnessHours, 'aria-label': 'Freshness', oninput: e => (draft.freshnessHours = Number(e.target.value)) }),
      h('div', { class: 'range-labels' }, h('span', {}, 'Only the latest'), h('span', {}, 'Keep older posts'))),
    h('section', { class: 'group' },
      h('h3', {}, 'What iweb has learned'),
      h('p', {}, learned.topTerms.length
        ? `From ${learned.savedCount} saved and ${learned.hiddenCount} hidden posts, you seem to like:`
        : 'Nothing yet. Save posts you enjoy and hide ones you don’t, and your feed adapts.'),
      learned.topTerms.length > 0 && h('div', { class: 'tags' }, learned.topTerms.map(t => h('span', { class: 'tag learned' }, t))),
      (learned.topTerms.length > 0 || learned.hiddenCount > 0) && h('button', {
        type: 'button',
        class: 'pill small',
        onclick: async () => {
          state.profile = await api('/api/reset-learning', { method: 'POST' });
          draft.learned = state.profile.learned;
          renderSettings();
          toast('Learned preferences cleared.');
        },
      }, 'Reset what it learned')),
    h('h3', { class: 'group-title' }, 'Sources'),
    ...state.meta.map(c => sourceEditor(c)));
}

async function saveSettings() {
  const btn = $('#save-settings');
  btn.disabled = true;
  try {
    state.profile = await api('/api/profile', { method: 'PUT', body: { interests: draft.interests, freshnessHours: draft.freshnessHours, sources: draft.sources } });
    $('#settings').close();
    toast('Rebuilding your feed…');
    await loadFeed();
  } catch (e) {
    toast(`Couldn’t save: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ---------- boot ----------
function bindUi() {
  $('#refresh').append(icon('refresh'));
  $('#close-settings').append(icon('close'));
  $('#search-icon').append(icon('search'));
  $('#refresh').addEventListener('click', () => loadFeed(true));
  $('#open-settings').addEventListener('click', () => openSettings());
  $('#cancel-settings').addEventListener('click', () => $('#settings').close());
  $('#save-settings').addEventListener('click', saveSettings);
  $('#settings').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  const find = $('#find');
  let timer;
  find.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = find.value;
      toBoardTop();
      flip(refreshView);
    }, 160);
  });
  find.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      find.value = '';
      state.query = '';
      find.blur();
      flip(refreshView);
    }
  });
  addEventListener('keydown', e => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName);
    if (typing || document.querySelector('dialog[open]')) return;
    if (e.key === '/') {
      e.preventDefault();
      find.focus();
    }
    if (state.tab === 'watch' && e.key === ' ' && !/^(button|a)$/i.test(document.activeElement?.tagName)) {
      e.preventDefault();
      togglePlay(activeReel);
    }
    if (state.tab === 'watch' && ['ArrowDown', 'ArrowUp', 'j', 'k'].includes(e.key)) {
      e.preventDefault();
      stepReel(e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1);
    }
  });

  // The tab bar steps aside while reading down, and returns on the way back up.
  let lastY = scrollY;
  addEventListener('scroll', () => {
    const y = scrollY;
    if (y > 160 && y - lastY > 8) document.body.classList.add('tucked');
    else if (lastY - y > 8 || y < 160) document.body.classList.remove('tucked');
    lastY = y;
  }, { passive: true });
}

function handleAuthReturn() {
  const params = new URLSearchParams(location.search);
  const connected = state.accounts.find(a => a.id === params.get('connected'));
  const error = params.get('auth_error');
  if (connected) toast(`${connected.label} connected. Pulling in ${connected.imports}…`);
  if (error) toast(error);
  if (connected || error) history.replaceState(null, '', '/');
}

async function init() {
  bindUi();
  renderViews();
  renderSkeleton();
  const [meta, profile, accounts] = await Promise.all([api('/api/meta'), api('/api/profile'), api('/api/accounts')]);
  state.meta = meta.connectors;
  state.metaById = Object.fromEntries(meta.connectors.map(c => [c.id, c]));
  state.profile = profile;
  state.accounts = accounts.accounts;
  state.loading = true;
  renderChrome();
  handleAuthReturn();
  await loadFeed();
}

init().catch(e => toast(`Couldn’t start: ${e.message}`));
