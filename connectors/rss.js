import { getText } from '../lib/http.js';
import { parseFeed } from '../lib/xml.js';
import { gather, clip, safeUrl, youtubeId, youtubeMedia, domainOf, toMs } from './_shared.js';

const hash = s => {
  let h = 5381;
  for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
};

export default {
  id: 'rss',
  label: 'Blogs & RSS',
  color: '#0ea5a4',
  scoreLabel: null,
  pace: 2,
  note: 'Any RSS or Atom feed: news sites, Substack (/feed), Mastodon (@user.rss), podcasts, blogs.',
  fields: [{ key: 'feeds', type: 'list', label: 'Feed URLs', placeholder: 'https://www.theverge.com/rss/index.xml\nhttps://mastodon.social/@Gargron.rss' }],
  defaults: { enabled: true, weight: 1, feeds: ['https://www.theverge.com/rss/index.xml', 'https://www.nasa.gov/feed/'] },

  async fetch(cfg, { force }) {
    return gather(cfg.feeds, async url => {
      if (!safeUrl(url)) throw new Error('not an http(s) URL');
      const feed = parseFeed(await getText(url, { force, headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } }));
      const site = domainOf(url);
      return feed.items.slice(0, 25).map(e => {
        const link = safeUrl(e.link) || url;
        // Credits fused into the body read as stutter ("NASA NASA issued…"): collapse repeated words.
        e.text = e.text.replace(/\b([\p{L}\p{N}]{2,})(\s+\1\b)+/gu, '$1');
        const yt = youtubeId(link);
        return {
          id: `rss:${hash(e.id || link + e.title)}`,
          source: 'rss',
          author: e.author || feed.title || site,
          authorKey: `rss:${site}`,
          community: feed.title || site,
          title: e.title,
          // Some feeds stuff their description with site navigation that repeats the title; that is not a summary.
          text: clip(e.text.slice(0, 200).includes(e.title.slice(0, 18)) ? '' : e.text, 300),
          url: link,
          domain: domainOf(link),
          createdAt: toMs(e.published),
          engagement: null,
          media: yt ? youtubeMedia(yt) : safeUrl(e.thumb) ? { type: 'image', thumb: e.thumb } : null,
        };
      });
    });
  },
};
