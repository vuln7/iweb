import { getJSON } from '../lib/http.js';
import { gather, clip, safeUrl, youtubeId, youtubeMedia, domainOf, toMs, DAY } from './_shared.js';

const API = 'https://public.api.bsky.app/xrpc';
const cleanHandle = s => s.trim().replace(/^https?:\/\/bsky\.app\/profile\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');

function embedMedia(embed) {
  if (!embed) return { media: null };
  const type = embed.$type || '';
  if (type.startsWith('app.bsky.embed.recordWithMedia')) return embedMedia(embed.media);
  if (type.startsWith('app.bsky.embed.images')) {
    const im = embed.images?.[0];
    const thumb = safeUrl(im?.thumb);
    return { media: thumb ? { type: 'image', thumb, full: safeUrl(im.fullsize), w: im.aspectRatio?.width, h: im.aspectRatio?.height } : null };
  }
  if (type.startsWith('app.bsky.embed.video')) {
    const thumb = safeUrl(embed.thumbnail);
    return { media: thumb ? { type: 'video', thumb, stream: safeUrl(embed.playlist), w: embed.aspectRatio?.width, h: embed.aspectRatio?.height } : null };
  }
  if (type.startsWith('app.bsky.embed.external')) {
    const ext = embed.external || {};
    const yt = youtubeId(ext.uri);
    const url = safeUrl(ext.uri);
    return {
      media: yt ? youtubeMedia(yt) : safeUrl(ext.thumb) ? { type: 'image', thumb: ext.thumb } : null,
      link: url && !yt ? { url, title: ext.title, domain: domainOf(url) } : null,
    };
  }
  return { media: null };
}

function toItem(post) {
  const rkey = post.uri.split('/').pop();
  const handle = post.author.handle;
  const { media, link } = embedMedia(post.embed);
  const url = `https://bsky.app/profile/${handle}/post/${rkey}`;
  return {
    id: `bluesky:${post.cid}`,
    source: 'bluesky',
    author: post.author.displayName || handle,
    authorHandle: `@${handle}`,
    authorKey: `bluesky:${post.author.did}`,
    avatar: safeUrl(post.author.avatar),
    title: '',
    // Bluesky truncates a shared URL in the text ("site.com/path..."); the link card already carries it.
    text: clip((post.record?.text || '').replace(link ? /\s*\S+\.\S+\/\S*(\.\.\.|…)\s*$/ : /$^/, ''), 600),
    url,
    link: link || null,
    discussion: { url, comments: post.replyCount || 0 },
    createdAt: toMs(post.record?.createdAt || post.indexedAt),
    engagement: { score: (post.likeCount || 0) + 2 * (post.repostCount || 0), comments: post.replyCount || 0 },
    media,
  };
}

async function authorFeed(actor, limit, force) {
  const q = new URLSearchParams({ actor, limit: String(limit), filter: 'posts_no_replies' });
  const data = await getJSON(`${API}/app.bsky.feed.getAuthorFeed?${q}`, { force });
  return (data.feed || []).filter(f => !f.reason).map(f => toItem(f.post));
}

export default {
  id: 'bluesky',
  label: 'Bluesky',
  color: '#1185fe',
  scoreLabel: 'likes',
  pace: 1.5,
  note: 'Enter your own handle to import everyone you follow, and/or list specific accounts. Uses the public API, no login.',
  fields: [
    { key: 'me', type: 'text', label: 'Your handle (imports who you follow)', placeholder: 'you.bsky.social' },
    { key: 'handles', type: 'list', label: 'Extra accounts', placeholder: 'bsky.app\nnytimes.com' },
  ],
  defaults: { enabled: true, weight: 1, me: '', handles: ['bsky.app', 'theverge.com', 'nytimes.com', 'npr.org'] },

  async fetch(cfg, { force }) {
    const listed = cfg.handles.map(cleanHandle);
    const handles = [...listed];
    const errors = [];
    if (cfg.me) {
      try {
        const q = new URLSearchParams({ actor: cleanHandle(cfg.me), limit: '100' });
        const data = await getJSON(`${API}/app.bsky.graph.getFollows?${q}`, { ttl: DAY, force });
        handles.push(...(data.follows || []).slice(0, 40).map(f => f.handle));
      } catch (e) {
        errors.push(`${cfg.me}: couldn't import follows (${e.message})`);
      }
    }
    // Fewer posts per imported account keeps request volume sane when you follow a lot of people.
    const result = await gather(handles, h => authorFeed(h, listed.includes(h) ? 25 : 12, force));
    result.errors.unshift(...errors);
    return result;
  },
};
