import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';
import { connectors, connectorMeta } from './connectors/index.js';
import { SetupError } from './connectors/_shared.js';
import { getProfile, updateProfile, saveProfile, resetLearning } from './lib/profile.js';
import { rank, learn } from './lib/ranker.js';
import { dedupe } from './lib/dedupe.js';
import { createAccounts } from './lib/accounts.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const env = loadEnv(path.join(root, '.env'));
const PORT = Number(env.PORT) || 3000;
// Must match the redirect URI registered with Google / Reddit exactly.
const BASE_URL = (env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const accounts = createAccounts(env, BASE_URL);

const labels = Object.fromEntries(connectors.map(c => [c.id, c.label]));
const pace = Object.fromEntries(connectors.map(c => [c.id, c.pace || 1]));
const recent = new Map(); // id -> item, so feedback can learn from what was shown

async function buildFeed(force) {
  const profile = await getProfile();
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

  const all = dedupe(sources.flatMap(s => s.items), labels);
  for (const it of all) recent.set(it.id, it);
  while (recent.size > 6000) recent.delete(recent.keys().next().value);

  const savedIds = new Set(profile.saved.map(s => s.id));
  const items = rank(all, profile, pace).slice(0, 250).map(it => ({ ...it, liked: savedIds.has(it.id) }));
  return {
    generatedAt: Date.now(),
    items,
    sources: sources.map(({ items, ...s }) => ({ ...s, count: items.length })),
  };
}

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
  'GET /api/meta': async () => ({ connectors: connectorMeta(env) }),
  'GET /api/profile': async () => publicProfile(await getProfile()),
  'PUT /api/profile': async body => publicProfile(await updateProfile(body)),
  'GET /api/feed': async (_, url) => buildFeed(url.searchParams.has('refresh')),
  'GET /api/saved': async () => ({ items: (await getProfile()).saved.map(s => ({ ...s, liked: true })) }),
  'POST /api/feedback': feedback,
  'POST /api/reset-learning': async () => publicProfile(await resetLearning()),
  'GET /api/accounts': async () => ({ accounts: await accounts.list() }),
  'POST /api/accounts/disconnect': async ({ provider }) => {
    await accounts.disconnect(provider);
    return { accounts: await accounts.list() };
  },
};

// GET /auth/:provider/start → provider's consent screen → GET /auth/:provider/callback → back to the app.
async function handleAuth(url, res, [, id, step]) {
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
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
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
  res.writeHead(status, { 'content-type': json ? 'application/json' : 'text/plain' });
  res.end(json ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const auth = req.method === 'GET' && url.pathname.match(/^\/auth\/(\w+)\/(start|callback)$/);
  if (auth) return handleAuth(url, res, auth);
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return serveStatic(url, res);
  try {
    const body = req.method === 'GET' ? null : await readBody(req);
    send(res, 200, await route(body, url));
  } catch (e) {
    console.error(e);
    send(res, e.status || 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`iweb running at ${BASE_URL}`));
