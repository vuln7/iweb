import { youtubeId } from '../connectors/_shared.js';

// When the same link shows up in several places (a video posted on Reddit and
// HN, an article from RSS that's also on the front page), keep one card for
// the original and list the others as "also on".
const ORIGIN_FIRST = ['youtube', 'x', 'bluesky', 'instagram', 'rss', 'hackernews', 'reddit'];

const TRACKING = /^(utm_|ref$|ref_src$|fbclid$|gclid$|si$|s$|feature$)/;

export function canonical(url = '') {
  const yt = youtubeId(url);
  if (yt) return `yt:${yt}`;
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  } catch {
    return url;
  }
}

export function dedupe(items, labels = {}) {
  const sorted = [...items].sort((a, b) => ORIGIN_FIRST.indexOf(a.source) - ORIGIN_FIRST.indexOf(b.source));
  const byKey = new Map();
  const byId = new Set();
  const out = [];
  for (const it of sorted) {
    if (byId.has(it.id)) continue;
    byId.add(it.id);
    // A post that shares a link (e.g. a Bluesky post of an article) matches on that link too.
    const keys = [it.url, it.link?.url].filter(Boolean).map(canonical);
    const kept = keys.map(k => byKey.get(k)).find(Boolean);
    if (!kept) {
      for (const k of keys) byKey.set(k, it);
      out.push(it);
    } else if (kept.source !== it.source || kept.community !== it.community) {
      (kept.alsoOn ||= []).push({
        source: it.source,
        label: it.community || labels[it.source] || it.source,
        url: it.discussion?.url || it.url,
        comments: it.discussion?.comments ?? null,
      });
    }
  }
  return out;
}
