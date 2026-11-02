import { tokens, matchesTerm, itemText } from './text.js';

const HOUR = 3600e3;
const MAX_AGE = 30 * 24 * HOUR;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Engagement means different things per platform (a million YouTube views vs
// 300 HN points), so popularity is measured against each source's own 90th
// percentile instead of raw numbers.
function engagementCeilings(items) {
  const bySource = new Map();
  for (const it of items) {
    if (!it.engagement) continue;
    const list = bySource.get(it.source) || [];
    list.push(Math.log1p(Math.max(0, it.engagement.score || 0)));
    bySource.set(it.source, list);
  }
  const out = {};
  for (const [src, vals] of bySource) {
    vals.sort((a, b) => a - b);
    out[src] = Math.max(1, vals[Math.floor(vals.length * 0.9)] || 1);
  }
  return out;
}

export function rank(items, profile, paceBySource = {}, now = Date.now()) {
  const hidden = new Set(profile.hidden);
  const { terms, authors } = profile.affinity;
  const halfLife = profile.freshnessHours || 36;
  const ceiling = engagementCeilings(items);
  // A source that returns 400 posts shouldn't drown out one that returns 20.
  const counts = {};
  for (const it of items) counts[it.source] = (counts[it.source] || 0) + 1;
  const avgCount = items.length / Math.max(1, Object.keys(counts).length);
  const volume = src => clamp(Math.sqrt(avgCount / counts[src]), 0.5, 1.6);
  const scored = [];

  for (const item of items) {
    if (hidden.has(item.id)) continue;
    const weight = profile.sources[item.source]?.weight ?? 1;
    const age = Math.max(0, now - item.createdAt);
    if (weight <= 0 || age > MAX_AGE) continue;

    const text = itemText(item);
    const why = [];

    let interest = 0;
    for (const { term, weight: w = 1 } of profile.interests) {
      if (matchesTerm(text, term)) {
        interest += w;
        why.push(`Matches “${term}”`);
      }
    }
    if (item.discoveredVia && !why.length) why.push(`Discovered via “${item.discoveredVia}”`);
    if (item.fromAccount) why.push(item.fromAccount);

    let learned = 0;
    for (const t of new Set(tokens(text))) learned += terms[t] || 0;
    learned = clamp(learned, -3, 3);
    if (learned > 0.75) why.push('Similar to posts you’ve opened or saved');

    const author = clamp(authors[item.authorKey] || 0, -4, 4);
    if (author > 0.5) why.push(`You’ve opened or saved ${item.author} before`);

    let pop = 0.5; // neutral when a source has no engagement data (RSS)
    if (item.engagement && ceiling[item.source]) {
      pop = clamp(Math.log1p(Math.max(0, item.engagement.score || 0)) / ceiling[item.source], 0, 1.25);
      if (pop >= 1) why.push('Trending');
    }
    if (item.alsoOn?.length) pop += 0.3 * item.alsoOn.length;

    // Slow sources (YouTube, blogs) decay slower so they aren't buried by Reddit's churn.
    const fresh = 0.5 ** (age / HOUR / (halfLife * (paceBySource[item.source] || 1)));

    const score = weight * volume(item.source) * fresh * (0.55 + 0.45 * pop) * Math.exp(0.4 * interest + 0.3 * learned + 0.25 * author + (item.fromAccount ? 0.2 : 0));
    scored.push({ ...item, score, why });
  }
  return diversify(scored);
}

// Greedy re-rank so the feed doesn't turn into ten Reddit posts in a row or a
// single prolific account.
function diversify(list) {
  const pool = list.sort((a, b) => b.score - a.score);
  const out = [];
  while (pool.length) {
    const recentSrc = out.slice(-4), recentAuthor = out.slice(-12);
    let bestI = 0, best = -Infinity;
    for (let i = 0; i < Math.min(pool.length, 40); i++) {
      const it = pool[i];
      const sameSrc = recentSrc.filter(r => r.source === it.source).length;
      const sameAuthor = recentAuthor.filter(r => r.authorKey === it.authorKey).length;
      const eff = it.score * 0.72 ** sameSrc * 0.5 ** sameAuthor;
      if (eff > best) { best = eff; bestI = i; }
    }
    out.push(pool.splice(bestI, 1)[0]);
  }
  return out;
}

const DELTA = { like: 1, unlike: -1, open: 0.3, hide: -1, unhide: 1 };

function prune(map, max) {
  const keys = Object.keys(map);
  if (keys.length <= max) return;
  keys.sort((a, b) => Math.abs(map[a]) - Math.abs(map[b]));
  for (const k of keys.slice(0, keys.length - max)) delete map[k];
}

// Feedback nudges word and author affinities; the next ranking picks them up.
export function learn(profile, item, action) {
  const delta = DELTA[action] || 0;
  if (!delta) return;
  const { terms, authors } = profile.affinity;
  const toks = [...new Set(tokens(itemText(item)))];
  const per = delta / Math.sqrt(Math.max(toks.length, 1));
  for (const t of toks) terms[t] = Math.round(clamp((terms[t] || 0) + per, -2, 2) * 1000) / 1000;
  if (item.authorKey) authors[item.authorKey] = clamp((authors[item.authorKey] || 0) + delta * 1.5, -4, 4);
  prune(terms, 800);
  prune(authors, 400);
}
