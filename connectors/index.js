import youtube from './youtube.js';
import reddit from './reddit.js';
import x from './x.js';
import bluesky from './bluesky.js';
import instagram from './instagram.js';
import hackernews from './hackernews.js';
import rss from './rss.js';

// To add a platform: write a module with { id, label, color, fields, defaults, fetch } and list it here.
export const connectors = [youtube, reddit, x, bluesky, instagram, hackernews, rss];

export function connectorMeta(env) {
  return connectors.map(({ fetch, defaults, ...meta }) => ({
    ...meta,
    requiredEnv: meta.requiredEnv || [],
    missingEnv: (meta.requiredEnv || []).filter(k => !env[k]),
  }));
}
