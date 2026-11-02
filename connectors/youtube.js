import { getJSON } from '../lib/http.js';
import { decode } from '../lib/xml.js';
import { gather, clip, youtubeMedia, toMs, DAY, SetupError } from './_shared.js';

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_SUBSCRIPTIONS = 60;

// Signed in → calls go out with the user's token; otherwise with the API key.
// Cost per refresh: ~1 quota unit per channel + 1 per 50 videos (10,000 free units/day).
function call(path, params, auth, opts = {}) {
  const q = new URLSearchParams(params);
  const headers = {};
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  else q.set('key', auth.key);
  return getJSON(`${API}/${path}?${q}`, { ...opts, headers });
}

// A channel's uploads playlist is its id with UC → UU, which saves a lookup per subscription.
const uploadsOf = channelId => `UU${channelId.slice(2)}`;

async function channel(input, auth) {
  const s = input.trim().replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//i, '').replace(/[?#].*$/, '');
  const id = s.match(/(?:^|channel\/)(UC[\w-]{22})/)?.[1];
  const params = { part: 'snippet' };
  if (id) params.id = id;
  else params.forHandle = `@${s.replace(/^@/, '')}`;
  const data = await call('channels', params, auth, { ttl: 30 * DAY });
  const ch = data.items?.[0];
  if (!ch) throw new Error('channel not found');
  return { id: ch.id, title: ch.snippet.title, avatar: ch.snippet.thumbnails?.default?.url };
}

async function subscriptions(auth, force) {
  const out = [];
  let pageToken = '';
  do {
    const params = { part: 'snippet', mine: 'true', maxResults: '50', order: 'relevance' };
    if (pageToken) params.pageToken = pageToken;
    const data = await call('subscriptions', params, auth, { ttl: 6 * 3600e3, force });
    for (const s of data.items || []) {
      out.push({ id: s.snippet.resourceId.channelId, title: s.snippet.title, avatar: s.snippet.thumbnails?.default?.url, subscribed: true });
    }
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < MAX_SUBSCRIPTIONS);
  return out.slice(0, MAX_SUBSCRIPTIONS);
}

async function uploads(ch, perChannel, auth, force) {
  const data = await call('playlistItems', { part: 'snippet,contentDetails', playlistId: uploadsOf(ch.id), maxResults: String(perChannel) }, auth, { force, ttl: 30 * 60e3 });
  return (data.items || []).map(v => ({
    ...toItem(v.contentDetails.videoId, v.snippet, v.contentDetails.videoPublishedAt, ch),
    fromAccount: ch.subscribed ? 'You’re subscribed' : undefined,
  }));
}

function toItem(videoId, sn, publishedAt, ch = {}) {
  return {
    id: `youtube:${videoId}`,
    source: 'youtube',
    author: decode(ch.title || sn.videoOwnerChannelTitle || sn.channelTitle || ''),
    authorKey: `youtube:${ch.id || sn.channelId}`,
    avatar: ch.avatar || null,
    community: null,
    title: decode(sn.title),
    text: clip(decode(sn.description || ''), 260),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    createdAt: toMs(publishedAt || sn.publishedAt),
    engagement: null,
    media: youtubeMedia(videoId),
  };
}

async function discover(term, auth, force) {
  const after = new Date(Math.floor(Date.now() / DAY) * DAY - 7 * DAY).toISOString(); // day-rounded: stable cache key
  const data = await call('search', { part: 'snippet', type: 'video', maxResults: '8', order: 'relevance', publishedAfter: after, q: term }, auth, { ttl: 6 * 3600e3, force });
  return (data.items || []).filter(v => v.id?.videoId).map(v => ({ ...toItem(v.id.videoId, v.snippet), discoveredVia: term }));
}

const seconds = iso => {
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
};

// One batched call fills in view counts and lets us drop Shorts.
async function addStats(items, auth, includeShorts) {
  const byId = new Map();
  for (const it of items) if (!byId.has(it.media.embedId)) byId.set(it.media.embedId, it); // subscription copy wins over discovery
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await call('videos', { part: 'statistics,contentDetails', id: ids.slice(i, i + 50).join(',') }, auth, { ttl: 30 * 60e3 });
    for (const v of data.items || []) {
      const it = byId.get(v.id);
      it.engagement = { score: Number(v.statistics?.viewCount) || 0, comments: Number(v.statistics?.commentCount) || 0 };
      it.short = seconds(v.contentDetails?.duration) <= 60;
    }
  }
  return [...byId.values()].filter(it => includeShorts || !it.short);
}

async function collect(cfg, auth, interests, force) {
  const errors = [];
  const channels = new Map();
  if (auth.token && cfg.useSubscriptions) {
    try {
      for (const ch of await subscriptions(auth, force)) channels.set(ch.id, ch);
    } catch (e) {
      errors.push(`subscriptions: ${e.message}`);
    }
  }
  const listed = await gather(cfg.channels, async ch => [await channel(ch, auth)]);
  for (const ch of listed.items) if (!channels.has(ch.id)) channels.set(ch.id, ch);
  errors.push(...listed.errors);

  const perChannel = channels.size > 20 ? 5 : 12;
  const list = [...channels.values()];
  const results = await Promise.allSettled(list.map(ch => uploads(ch, perChannel, auth, force)));
  let items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push(`${list[i].title}: ${r.reason.message}`);
  });

  if (cfg.discover && interests.length) {
    const found = await gather(interests.slice(0, 6), term => discover(term, auth, force));
    items.push(...found.items);
    errors.push(...found.errors);
  }
  try {
    items = await addStats(items, auth, cfg.includeShorts);
  } catch (e) {
    errors.push(`view counts: ${e.message}`);
  }
  return { items, errors };
}

export default {
  id: 'youtube',
  label: 'YouTube',
  color: '#ff0033',
  scoreLabel: 'views',
  pace: 4, // channels post every few days, so their videos stay "fresh" longer
  note: 'Sign in with Google to pull in your subscriptions, or list channels below (needs a YOUTUBE_API_KEY when not signed in).',
  fields: [
    { key: 'useSubscriptions', type: 'bool', label: 'Include my subscriptions (when signed in)' },
    { key: 'channels', type: 'list', label: 'Extra channels', placeholder: '@veritasium\nhttps://www.youtube.com/@mkbhd' },
    { key: 'includeShorts', type: 'bool', label: 'Include Shorts' },
    { key: 'discover', type: 'bool', label: 'Discover new videos matching my interests' },
  ],
  defaults: { enabled: true, weight: 1, useSubscriptions: true, channels: ['@veritasium', '@kurzgesagt', '@mkbhd', '@3blue1brown'], includeShorts: false, discover: true },

  async fetch(cfg, { force, env, interests, token, authFailed }) {
    const notes = [];
    const userToken = await token('youtube').catch(e => { notes.push(e.message); return null; });
    const key = env.YOUTUBE_API_KEY;

    if (userToken) {
      const result = await collect(cfg, { token: userToken }, interests, force);
      if (!result.errors.some(e => /HTTP 401/.test(e))) return result;
      // Token was revoked or expired early: flag it once instead of reporting a 401 per channel.
      await authFailed('youtube');
      notes.push('YouTube sign-in stopped working. Reconnect it in Tune my feed.');
    }
    if (!key) throw new SetupError(notes[0] || 'Sign in with Google in Tune my feed, or add YOUTUBE_API_KEY to .env.');
    const result = await collect(cfg, { key }, interests, force);
    result.errors.unshift(...notes);
    return result;
  },
};
