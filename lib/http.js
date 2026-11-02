import { fetchUntrusted } from './guard.js';

// fetch() with a small in-memory TTL cache, so refreshing the feed doesn't
// hammer every upstream API (and burn rate limits / paid quota).
// `untrusted: true` is for URLs a user typed in (feed URLs): those go through the network guard.
const cache = new Map();
const DEFAULT_TTL = 10 * 60e3;
const UA = 'iweb/0.1 (personal feed aggregator)';

const errorDetail = body => {
  const text = body.trim();
  return text.startsWith('<') ? '' : text.slice(0, 160).replace(/\s+/g, ' '); // skip HTML error pages
};

async function request(url, headers, untrusted) {
  if (untrusted) {
    const { status, text } = await fetchUntrusted(url, { headers });
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }
  return fetch(url, { headers, signal: AbortSignal.timeout(12000), redirect: 'follow' });
}

async function get(url, { ttl = DEFAULT_TTL, headers = {}, force = false, untrusted = false, as }) {
  const key = `${as} ${url}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.value;

  const res = await request(url, { 'user-agent': UA, ...headers }, untrusted);
  if (!res.ok) {
    let detail = '';
    try { detail = errorDetail(await res.text()); } catch {}
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}${detail ? ` (${detail})` : ''}`);
  }
  const text = await res.text();
  const value = as === 'json' ? JSON.parse(text) : text;
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

export const getJSON = (url, opts = {}) => get(url, { ...opts, as: 'json' });
export const getText = (url, opts = {}) => get(url, { ...opts, as: 'text' });
