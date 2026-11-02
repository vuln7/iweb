import { getJSON } from '../lib/http.js';
import { gather, clip, safeUrl, toMs, SetupError } from './_shared.js';

const FIELDS = 'username,name,profile_picture_url,media.limit(12){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count}';

export default {
  id: 'instagram',
  label: 'Instagram',
  color: '#d62976',
  scoreLabel: 'likes',
  pace: 2,
  note: 'Instagram has no API for your personal feed. With a Meta developer app and an Instagram professional account, iweb can read other public Business/Creator accounts.',
  requiredEnv: ['IG_ACCESS_TOKEN', 'IG_USER_ID'],
  setupUrl: 'https://developers.facebook.com/docs/instagram-platform',
  fields: [{ key: 'accounts', type: 'list', label: 'Business / Creator accounts', placeholder: 'natgeo\nnasa' }],
  defaults: { enabled: false, weight: 1, accounts: ['natgeo', 'nasa'] },

  async fetch(cfg, { env, force }) {
    if (!env.IG_ACCESS_TOKEN || !env.IG_USER_ID) throw new SetupError('Add IG_ACCESS_TOKEN and IG_USER_ID to .env (Instagram Graph API).');
    const version = env.IG_GRAPH_VERSION || 'v23.0';
    return gather(cfg.accounts, async raw => {
      const username = raw.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
      const q = new URLSearchParams({ fields: `business_discovery.username(${username}){${FIELDS}}`, access_token: env.IG_ACCESS_TOKEN });
      const data = await getJSON(`https://graph.facebook.com/${version}/${env.IG_USER_ID}?${q}`, { force, ttl: 30 * 60e3 });
      const acct = data.business_discovery;
      if (!acct) throw new Error('not a public Business/Creator account');
      return (acct.media?.data || []).map(m => {
        const video = m.media_type === 'VIDEO';
        const thumb = safeUrl(video ? m.thumbnail_url : m.media_url);
        return {
          id: `instagram:${m.id}`,
          source: 'instagram',
          author: acct.name || acct.username,
          authorHandle: `@${acct.username}`,
          authorKey: `instagram:${acct.username}`,
          avatar: safeUrl(acct.profile_picture_url),
          title: '',
          text: clip(m.caption || '', 500),
          url: m.permalink,
          discussion: { url: m.permalink, comments: m.comments_count || 0 },
          createdAt: toMs(m.timestamp),
          engagement: m.like_count != null ? { score: m.like_count, comments: m.comments_count || 0 } : null,
          media: thumb ? { type: video ? 'video' : 'image', thumb } : null,
        };
      });
    });
  },
};
