// iweb — your personal internet. Copyright (C) 2026 the iweb contributors.
// Free software under the GNU Affero General Public License v3.0 or later; see LICENSE.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';
import { connectors, connectorMeta } from './connectors/index.js';
import { SetupError } from './connectors/_shared.js';
import { getProfile, updateProfile, saveProfile, resetLearning, withDefaults } from './lib/profile.js';
import { rank, learn } from './lib/ranker.js';
import { dedupe } from './lib/dedupe.js';
import { createAccounts } from './lib/accounts.js';
import { createGate } from './lib/gate.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const env = loadEnv(path.join(root, '.env'));
const PORT = Number(env.PORT) || 3000;
// Must match the redirect URI registered with Google / Reddit exactly.
const BASE_URL = (env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
// A public demo: one shared, read-only set of sources; each visitor's interests, saves and hides stay in their browser.
const DEMO = /^(1|true|yes)$/i.test(env.DEMO || '') || process.argv.includes('--demo');
// AGPL: anyone using this install over the network can get its source. Point this at your fork if you change the code.
const SOURCE_URL = env.SOURCE_URL || 'https://github.com/4040chan/mewsnewws';
const accounts = createAccounts(env, BASE_URL);
const gate = createGate(env.IWEB_PASSWORD, { secure: BASE_URL.startsWith('https://') });

const labels = Object.fromEntries(connectors.map(c => [c.id, c.label]));
const pace = Object.fromEntries(connectors.map(c => [c.id, c.pace || 1]));
const recent = new Map(); // id -> item, so feedback can learn from what was shown

async function collect(profile, force) {
  const ctx = { env, force, interests: profile.interests.map(i => i.term), token: id => accounts.token(id), authFailed: id => accounts.markBroken(id) };
  const sources = await Promise.all(connectors.map(async c => {
    const cfg = profile.sources[c.id];
    if (!cfg?.enabled) return { id: c.id, status: 'off', items: [], errors: [] };
    const started = Date.now();
    try {
      const { items, errors } = await c.fetch(cfg, ctx);
      const status = !errors.length ? 'ok' : items.length ? 'partial' : 'error';
      return { id: c.id, status, items, errors, ms: Date.now() - started };
    } catch (e) {
      return { id: c.id, status: e instanceof SetupError ? 'setup' : 'error', items: [], errors: [e.message] };
    }
  }));
  return {
    at: Date.now(),
    all: dedupe(sources.flatMap(s => s.items), labels),
    sources: sources.map(({ items, ...s }) => ({ ...s, count: items.length })),
  };
}

async function buildFeed(force) {
  const profile = await getProfile();
  const { at, all, sources } = await collect(profile, force);
  for (const it of all) recent.set(it.id, it);
  while (recent.size > 6000) recent.delete(recent.keys().next().value);

  const savedIds = new Set(profile.saved.map(s => s.id));
  const items = rank(all, profile, pace).slice(0, 250).map(it => ({ ...it, liked: savedIds.has(it.id) }));
  return { generatedAt: at, items, sources };
}

// ---------- demo mode ----------
const demoProfile = withDefaults();
let pool = null; // { at, promise }: one fetch of the shared sources, reused by every visitor for ten minutes

function demoPool() {
  if (!pool || Date.now() - pool.at > 10 * 60e3) {
    const next = { at: Date.now(), promise: collect(demoProfile, false) };
    next.promise.catch(() => { if (pool === next) pool = null; });
    pool = next;
  }
  return pool.promise;
}

// The visitor's own interests and freshness arrive as query parameters; nothing about them is stored here.
function visitorProfile(url) {
  const terms = (url.searchParams.get('interests') || '').split(',').map(t => t.trim().toLowerCase().slice(0, 60)).filter(Boolean);
  const hours = Number(url.searchParams.get('freshness'));
  return {
    ...demoProfile,
    interests: url.searchParams.has('interests') ? [...new Set(terms)].slice(0, 30).map(term => ({ term, weight: 1 })) : demoProfile.interests,
    freshnessHours: hours >= 3 && hours <= 24 * 14 ? hours : demoProfile.freshnessHours,
    affinity: { terms: {}, authors: {} },
    hidden: [],
  };
}

async function demoFeed(url) {
  const { at, all, sources } = await demoPool();
  return { generatedAt: at, items: rank(all, visitorProfile(url), pace).slice(0, 250).map(it => ({ ...it, liked: false })), sources };
}

const readOnly = async () => { throw Object.assign(new Error('This is a demo. Run your own copy of iweb to change its sources.'), { status: 403 }); };

// ---------- API ----------
async function feedback({ id, action }) {
  const profile = await getProfile();
  const item = recent.get(id) || profile.saved.find(s => s.id === id);
  if (!item) throw Object.assign(new Error('Unknown item — refresh the feed'), { status: 404 });
  const { score, why, liked, ...snapshot } = item;

  learn(profile, item, action);
  if (action === 'like' && !profile.saved.some(s => s.id === id)) profile.saved = [{ ...snapshot, savedAt: Date.now() }, ...profile.saved].slice(0, 300);
  if (action === 'unlike') profile.saved = profile.saved.filter(s => s.id !== id);
  if (action === 'hide') profile.hidden = [...profile.hidden.filter(h => h !== id), id].slice(-3000);
  if (action === 'unhide') profile.hidden = profile.hidden.filter(h => h !== id);
  await saveProfile();
  return { ok: true };
}

function publicProfile(p) {
  const topTerms = Object.entries(p.affinity.terms).sort((a, b) => b[1] - a[1]).slice(0, 14).filter(([, v]) => v > 0.15).map(([t]) => t);
  return { interests: p.interests, freshnessHours: p.freshnessHours, sources: p.sources, learned: { topTerms, hiddenCount: p.hidden.length, savedCount: p.saved.length } };
}

const routes = {
  'GET /api/health': async () => ({ ok: true }),
  'GET /api/meta': async () => ({ connectors: connectorMeta(env), demo: DEMO, sourceUrl: SOURCE_URL, locked: gate.enabled }),
  'GET /api/profile': async () => publicProfile(DEMO ? demoProfile : await getProfile()),
  'PUT /api/profile': DEMO ? readOnly : async body => publicProfile(await updateProfile(body)),
  'GET /api/feed': async (_, url) => (DEMO ? demoFeed(url) : buildFeed(url.searchParams.has('refresh'))),
  'GET /api/saved': async () => ({ items: DEMO ? [] : (await getProfile()).saved.map(s => ({ ...s, liked: true })) }),
  'POST /api/feedback': DEMO ? readOnly : feedback,
  'POST /api/reset-learning': DEMO ? readOnly : async () => publicProfile(await resetLearning()),
  'GET /api/accounts': async () => ({ accounts: DEMO ? [] : await accounts.list() }),
  'POST /api/accounts/disconnect': DEMO ? readOnly : async ({ provider }) => {
    await accounts.disconnect(provider);
    return { accounts: await accounts.list() };
  },
};

// GET /auth/:provider/start → provider's consent screen → GET /auth/:provider/callback → back to the app.
async function handleAuth(url, res, [, id, step]) {
  if (DEMO) return redirect(res, '/');
  try {
    if (step === 'start') return redirect(res, accounts.startUrl(id));
    await accounts.finish(id, url.searchParams);
    redirect(res, `/?connected=${encodeURIComponent(id)}`);
  } catch (e) {
    console.error(`[auth:${id}]`, e.message);
    redirect(res, `/?auth_error=${encodeURIComponent(e.message)}`);
  }
}

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

async function serveStatic(url, res) {
  let rel;
  try { rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); } catch { return send(res, 400, 'Bad request'); }
  const file = path.join(publicDir, rel);
  if (!file.startsWith(publicDir + path.sep)) return send(res, 404, 'Not found');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    send(res, 404, 'Not found');
  }
}

function send(res, status, body) {
  const json = typeof body !== 'string';
  res.writeHead(status, { 'content-type': json ? 'application/json' : 'text/plain', 'cache-control': 'no-store' });
  res.end(json ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Body is not valid JSON'), { status: 400 }); }
}

http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  const url = new URL(req.url, 'http://localhost');

  if (gate.enabled) {
    if (url.pathname === '/login') return gate.login(req, res, url);
    if (url.pathname === '/logout') return gate.logout(res);
    if (url.pathname !== '/api/health' && !gate.allowed(req)) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Sign in first' });
      return redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
  }

  const auth = req.method === 'GET' && url.pathname.match(/^\/auth\/(\w+)\/(start|callback)$/);
  if (auth) return handleAuth(url, res, auth);
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return req.method === 'GET' || req.method === 'HEAD' ? serveStatic(url, res) : send(res, 405, 'Method not allowed');
  try {
    const body = req.method === 'GET' ? null : await readBody(req);
    send(res, 200, await route(body, url));
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.message });
  }
}).listen(PORT, () => {
  console.log(`iweb running at ${BASE_URL}${DEMO ? ' (demo mode)' : ''}${gate.enabled ? ' (password protected)' : ''}`);
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE_URL);
  if (!local && !DEMO && !gate.enabled) {
    console.warn('\n  Warning: BASE_URL is not localhost, but IWEB_PASSWORD is not set.\n  Anyone who finds this address can read your feed and change your settings and accounts.\n  Set IWEB_PASSWORD, or DEMO=1 for a public read-only demo.\n');
  }
});
