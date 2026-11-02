import { getJSON } from '../lib/http.js';
import { gather, clip, safeUrl, youtubeId, youtubeMedia, toMs, DAY, SetupError } from './_shared.js';

const API = 'https://api.x.com/2';
const cleanHandle = s => s.trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');

export default {
  id: 'x',
  label: 'X',
  color: '#8b8b93',
  scoreLabel: 'likes',
  pace: 1,
  note: 'Recent posts from the accounts you list. X only allows this through its paid developer API.',
  requiredEnv: ['X_BEARER_TOKEN'],
  setupUrl: 'https://developer.x.com/en/portal/dashboard',
  fields: [{ key: 'handles', type: 'list', label: 'Accounts', placeholder: '@nasa\n@verge' }],
  defaults: { enabled: false, weight: 1, handles: ['nasa', 'verge'] },

  async fetch(cfg, { env, force }) {
    if (!env.X_BEARER_TOKEN) throw new SetupError('Add X_BEARER_TOKEN to .env (X API read access is a paid plan).');
    const headers = { authorization: `Bearer ${env.X_BEARER_TOKEN}` };
    return gather(cfg.handles, async raw => {
      const handle = cleanHandle(raw);
      const user = await getJSON(`${API}/users/by/username/${encodeURIComponent(handle)}?user.fields=profile_image_url`, { headers, ttl: 30 * DAY });
      if (!user.data) throw new Error(user.errors?.[0]?.detail || 'user not found');
      const q = new URLSearchParams({
        max_results: '20',
        exclude: 'replies,retweets',
        'tweet.fields': 'created_at,public_metrics,attachments,entities',
        expansions: 'attachments.media_keys',
        'media.fields': 'url,preview_image_url,type,width,height',
      });
      // Longer TTL than other sources: every call costs money on X's API.
      const res = await getJSON(`${API}/users/${user.data.id}/tweets?${q}`, { headers, force, ttl: 30 * 60e3 });
      const mediaByKey = new Map((res.includes?.media || []).map(m => [m.media_key, m]));
      return (res.data || []).map(t => {
        const m = mediaByKey.get(t.attachments?.media_keys?.[0]);
        const yt = youtubeId(t.entities?.urls?.find(u => youtubeId(u.expanded_url))?.expanded_url);
        const thumb = m && safeUrl(m.url || m.preview_image_url);
        const pm = t.public_metrics || {};
        const url = `https://x.com/${user.data.username}/status/${t.id}`;
        return {
          id: `x:${t.id}`,
          source: 'x',
          author: user.data.name,
          authorHandle: `@${user.data.username}`,
          authorKey: `x:${user.data.id}`,
          avatar: safeUrl(user.data.profile_image_url),
          title: '',
          text: clip(t.text.replace(/\s*https:\/\/t\.co\/\w+$/, ''), 600),
          url,
          discussion: { url, comments: pm.reply_count || 0 },
          createdAt: toMs(t.created_at),
          engagement: { score: (pm.like_count || 0) + 2 * (pm.retweet_count || 0) + (pm.quote_count || 0), comments: pm.reply_count || 0 },
          media: yt ? youtubeMedia(yt) : thumb ? { type: m.type === 'photo' ? 'image' : 'video', thumb, w: m.width, h: m.height } : null,
        };
      });
    });
  },
};
