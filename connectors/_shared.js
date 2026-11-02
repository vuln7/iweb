export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

// A connector that can't run until the user adds a key / does setup.
export class SetupError extends Error {}

// Fetch every entry (subreddit, channel, handle…) in parallel; one bad entry
// shouldn't sink the whole source.
export async function gather(list = [], fn) {
  const entries = [...new Set(list.map(s => String(s).trim()).filter(Boolean))];
  const results = await Promise.allSettled(entries.map(fn));
  const items = [], errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push(`${entries[i]}: ${r.reason?.message || r.reason}`);
  });
  return { items, errors };
}

export const clip = (s = '', n = 420) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
export const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

export function toMs(d) {
  const t = typeof d === 'number' ? d : Date.parse(d);
  return Number.isFinite(t) ? t : Date.now();
}

export function youtubeId(url = '') {
  const m = String(url).match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m?.[1] || null;
}

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

export function youtubeMedia(id) {
  return { type: 'youtube', embedId: id, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, full: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, w: 16, h: 9 };
}
