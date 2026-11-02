// fetch() with a small in-memory TTL cache, so refreshing the feed doesn't
// hammer every upstream API (and burn rate limits / paid quota).
const cache = new Map();
const DEFAULT_TTL = 10 * 60e3;
const UA = 'iweb/0.1 (personal feed aggregator)';

async function get(url, { ttl = DEFAULT_TTL, headers = {}, force = false, as }) {
  const key = `${as} ${url}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.value;

  const res = await fetch(url, {
    headers: { 'user-agent': UA, ...headers },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.text()).trim();
      if (!body.startsWith('<')) detail = body.slice(0, 160).replace(/\s+/g, ' '); // skip HTML error pages
    } catch {}
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}${detail ? ` (${detail})` : ''}`);
  }
  const value = as === 'json' ? await res.json() : await res.text();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

export const getJSON = (url, opts = {}) => get(url, { ...opts, as: 'json' });
export const getText = (url, opts = {}) => get(url, { ...opts, as: 'text' });
