// Just enough RSS / Atom parsing for feeds, without pulling in a dependency.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

export function stripHtml(html = '') {
  return decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const re = (src, flags = 'i') => new RegExp(src, flags);

export function tag(xml, name) {
  const m = xml.match(re(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]).trim() : '';
}

export function attr(xml, name, attrName) {
  const m = xml.match(re(`<${name}\\b[^>]*?\\s${attrName}=["']([^"']*)["']`));
  return m ? decode(m[1]) : '';
}

export function blocks(xml, name) {
  return [...xml.matchAll(re(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map(m => m[1]);
}

function atomLink(b) {
  let fallback = '';
  for (const m of b.matchAll(/<link\b([^>]*)>/gi)) {
    const href = m[1].match(/\shref=["']([^"']*)["']/i)?.[1];
    if (!href) continue;
    const rel = m[1].match(/\srel=["']([^"']*)["']/i)?.[1] || 'alternate';
    if (rel === 'alternate') return decode(href);
    fallback ||= decode(href);
  }
  return fallback;
}

function mediaImage(b) {
  for (const m of b.matchAll(/<media:content\b([^>]*)>/gi)) {
    const url = m[1].match(/\surl=["']([^"']*)["']/i)?.[1];
    if (url && (/medium=["']image|type=["']image\//i.test(m[1]) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))) return decode(url);
  }
  for (const m of b.matchAll(/<enclosure\b([^>]*)>/gi)) {
    const url = m[1].match(/\surl=["']([^"']*)["']/i)?.[1];
    if (url && /type=["']image\//i.test(m[1])) return decode(url);
  }
  return '';
}

const firstImg = html => decode(html.match(/<img\b[^>]*\ssrc=["']([^"']+)["']/i)?.[1] || '');

export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const head = xml.split(/<(?:item|entry)[\s>]/i)[0];
  const items = blocks(xml, isAtom ? 'entry' : 'item').map(b => {
    const html = tag(b, 'content:encoded') || tag(b, 'content') || tag(b, 'description') || tag(b, 'summary') || tag(b, 'media:description');
    const link = (tag(b, 'link') || atomLink(b)).trim();
    return {
      id: tag(b, 'id') || tag(b, 'guid') || link,
      title: stripHtml(tag(b, 'title')),
      link,
      html,
      text: stripHtml(html),
      author: stripHtml(tag(tag(b, 'author'), 'name') || tag(b, 'dc:creator') || tag(b, 'author')),
      published: tag(b, 'published') || tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'updated'),
      thumb: attr(b, 'media:thumbnail', 'url') || mediaImage(b) || firstImg(html),
      block: b,
    };
  });
  return { title: stripHtml(tag(head, 'title')), items };
}
