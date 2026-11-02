import { getJSON, getText } from '../lib/http.js';
import { parseFeed, attr } from '../lib/xml.js';
import { clip, safeUrl, youtubeId, youtubeMedia, domainOf, toMs } from './_shared.js';

const UA = 'web:iweb:v0.1 (personal feed aggregator)';
const REDDIT_HOST = /^https?:\/\/([\w-]+\.)?(reddit\.com|redd\.it)\//i;

let token = null; // { value, expires }

// App-only OAuth: free "script" app credentials from reddit.com/prefs/apps.
async function accessToken(env) {
  if (token && token.expires > Date.now() + 60e3) return token.value;
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Reddit login failed (HTTP ${res.status}) — check REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET`);
  const data = await res.json();
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}

function fromJson(p) {
  const external = !p.is_self && p.url && !REDDIT_HOST.test(p.url) ? p.url : null;
  const permalink = `https://www.reddit.com${p.permalink}`;
  const yt = youtubeId(p.url);
  let img = null; // { url, w, h, full }
  const preview = p.preview?.images?.[0];
  if (preview) {
    const r = preview.resolutions?.find(r => r.width >= 640) || preview.source;
    if (r) img = { url: r.url, w: r.width, h: r.height, full: preview.source?.url };
  }
  if (!img && p.is_gallery && p.gallery_data?.items?.length) {
    const meta = p.media_metadata?.[p.gallery_data.items[0].media_id];
    const r = meta?.p?.find(r => r.x >= 640) || meta?.s;
    if (r) img = { url: r.u, w: r.x, h: r.y, full: meta.s?.u };
  }
  const thumb = safeUrl(img?.url);

  return {
    id: `reddit:${p.id}`,
    source: 'reddit',
    author: `u/${p.author}`,
    authorKey: `reddit:${p.author}`,
    community: `r/${p.subreddit}`,
    title: p.title,
    text: clip(p.selftext || ''),
    url: external || permalink,
    domain: external ? domainOf(external) : null,
    discussion: { url: permalink, comments: p.num_comments },
    createdAt: p.created_utc * 1000,
    engagement: { score: p.score, comments: p.num_comments },
    media: yt ? youtubeMedia(yt) : thumb ? {
      type: p.is_video ? 'video' : 'image',
      thumb,
      full: safeUrl(img.full),
      stream: p.is_video ? safeUrl((p.secure_media || p.media)?.reddit_video?.hls_url) : null,
      w: img.w,
      h: img.h,
    } : null,
  };
}

function fromRss(e) {
  const id = String(e.id).replace(/^t3_/, '');
  const external = e.html.match(/<a href="([^"]+)">\[link\]<\/a>/)?.[1];
  const ext = external && !REDDIT_HOST.test(external) ? external : null;
  const yt = youtubeId(ext || '');
  const author = e.author.replace(/^\/?u\//, '');
  return {
    id: `reddit:${id}`,
    source: 'reddit',
    author: `u/${author}`,
    authorKey: `reddit:${author}`,
    community: attr(e.block, 'category', 'label') || null,
    title: e.title,
    text: clip(e.text.replace(/\s*submitted by[\s\S]*$/, '')),
    url: ext || e.link,
    domain: ext ? domainOf(ext) : null,
    discussion: { url: e.link },
    createdAt: toMs(e.published),
    engagement: null,
    media: yt ? youtubeMedia(yt) : safeUrl(e.thumb) ? { type: 'image', thumb: e.thumb } : null,
  };
}

export default {
  id: 'reddit',
  label: 'Reddit',
  color: '#ff4500',
  scoreLabel: 'points',
  pace: 1,
  note: 'Sign in with Reddit to pull in your home feed, and/or list subreddits. Without keys it falls back to Reddit’s public RSS (no scores, often rate-limited).',
  setupUrl: 'https://www.reddit.com/prefs/apps',
  fields: [
    { key: 'homeFeed', type: 'bool', label: 'Include my home feed (when signed in)' },
    { key: 'subreddits', type: 'list', label: 'Extra subreddits', placeholder: 'technology\nspace' },
    { key: 'allowNsfw', type: 'bool', label: 'Include NSFW posts' },
  ],
  defaults: { enabled: true, weight: 1, homeFeed: true, subreddits: ['technology', 'space', 'InternetIsBeautiful'], allowNsfw: false },

  async fetch(cfg, { env, force, token, authFailed }) {
    const subs = cfg.subreddits.map(s => s.replace(/^(https?:\/\/(www\.|old\.)?reddit\.com)?\/?r\//i, '').replace(/[/?#].*$/, '')).filter(Boolean);
    // One multireddit request (r/a+b+c) instead of one per subreddit keeps us well inside rate limits.
    const multi = subs.map(encodeURIComponent).join('+');
    const limit = Math.min(100, 25 * subs.length);
    const keep = p => !p.stickied && (cfg.allowNsfw || !p.over_18);

    const errors = [];
    const userToken = await token('reddit').catch(e => { errors.push(e.message); return null; });
    if (userToken) {
      const headers = { authorization: `Bearer ${userToken}`, 'user-agent': UA };
      const lists = [];
      if (cfg.homeFeed) lists.push({ label: 'home feed', url: 'https://oauth.reddit.com/best?limit=100&raw_json=1', fromAccount: 'From your Reddit home feed' });
      if (subs.length) lists.push({ label: 'subreddits', url: `https://oauth.reddit.com/r/${multi}/hot?limit=${limit}&raw_json=1` });
      const items = [];
      const results = await Promise.allSettled(lists.map(l => getJSON(l.url, { headers, force })));
      for (const [i, r] of results.entries()) {
        if (r.status === 'fulfilled') {
          items.push(...r.value.data.children.map(c => c.data).filter(keep).map(p => ({ ...fromJson(p), fromAccount: lists[i].fromAccount })));
        }
      }
      const failures = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
      if (failures.some(m => /HTTP 401/.test(m))) {
        await authFailed('reddit');
        errors.push('Reddit sign-in stopped working. Reconnect it in Tune my feed.');
      } else if (failures.some(m => /HTTP 403/.test(m))) {
        errors.push('Reddit refused the request (403). Try reconnecting; Reddit also blocks some networks and VPNs.');
      } else {
        errors.push(...failures);
      }
      return { items, errors };
    }

    if (!subs.length) return { items: [], errors };
    if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
      const headers = { authorization: `Bearer ${await accessToken(env)}`, 'user-agent': UA };
      const data = await getJSON(`https://oauth.reddit.com/r/${multi}/hot?limit=${limit}&raw_json=1`, { headers, force });
      return { items: data.data.children.map(c => c.data).filter(keep).map(fromJson), errors };
    }

    try {
      const xml = await getText(`https://www.reddit.com/r/${multi}/hot/.rss?limit=${limit}`, { headers: { 'user-agent': UA }, force });
      return { items: parseFeed(xml).items.map(fromRss), errors };
    } catch (e) {
      return { items: [], errors: [...errors, `${e.message.split(' (')[0]}: Reddit limits anonymous access. Sign in with Reddit, or add REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET to .env`] };
    }
  },
};
