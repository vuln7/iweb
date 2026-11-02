import { getJSON } from '../lib/http.js';
import { stripHtml } from '../lib/xml.js';
import { gather, clip, domainOf, youtubeId, youtubeMedia, DAY } from './_shared.js';

function toItem(h) {
  const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
  const yt = youtubeId(h.url);
  return {
    id: `hn:${h.objectID}`,
    source: 'hackernews',
    author: h.author,
    authorKey: `hn:${h.author}`,
    community: 'Hacker News',
    title: h.title,
    text: clip(stripHtml(h.story_text || '')),
    url: h.url || discussion,
    domain: h.url ? domainOf(h.url) : null,
    discussion: { url: discussion, comments: h.num_comments || 0 },
    createdAt: h.created_at_i * 1000,
    engagement: { score: h.points || 0, comments: h.num_comments || 0 },
    media: yt ? youtubeMedia(yt) : null,
  };
}

export default {
  id: 'hackernews',
  label: 'Hacker News',
  color: '#e9b43c', // amber, so it never reads as Reddit's orange
  scoreLabel: 'points',
  pace: 1,
  note: 'The front page, plus recent stories that match your interests.',
  fields: [
    { key: 'frontPage', type: 'bool', label: 'Front page' },
    { key: 'searchInterests', type: 'bool', label: 'Search stories matching my interests' },
  ],
  defaults: { enabled: true, weight: 0.8, frontPage: true, searchInterests: true },

  async fetch(cfg, { force, interests }) {
    const urls = [];
    if (cfg.frontPage) urls.push('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30');
    if (cfg.searchInterests) {
      const since = Math.floor((Date.now() - 4 * DAY) / 3600e3) * 3600; // hour-rounded so the cache key is stable
      for (const term of interests.slice(0, 8)) {
        const q = new URLSearchParams({ query: term, tags: 'story', numericFilters: `created_at_i>${since},points>15`, hitsPerPage: '10' });
        urls.push(`https://hn.algolia.com/api/v1/search?${q}`);
      }
    }
    return gather(urls, async url => (await getJSON(url, { force })).hits.map(toItem));
  },
};
