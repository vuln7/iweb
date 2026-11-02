import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

// Feed URLs are typed in by whoever uses this install. On a public server, an unguarded fetch could be
// pointed at the host's own network (cloud metadata, admin panels, databases). Every request made for an
// untrusted URL resolves its host here and refuses private, loopback and link-local addresses; the check
// runs inside the connection's own DNS lookup, so a name can't resolve one way for the check and another
// for the request. Self-hosters with feeds on their own network can set ALLOW_PRIVATE_FEEDS=1.

const v4 = ip => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const range = (base, bits) => [v4(base), 2 ** (32 - bits)];
const PRIVATE_V4 = [
  range('0.0.0.0', 8), range('10.0.0.0', 8), range('100.64.0.0', 10), range('127.0.0.0', 8),
  range('169.254.0.0', 16), range('172.16.0.0', 12), range('192.0.0.0', 24), range('192.0.2.0', 24),
  range('192.168.0.0', 16), range('198.18.0.0', 15), range('198.51.100.0', 24), range('203.0.113.0', 24),
  range('224.0.0.0', 4), range('240.0.0.0', 4),
];

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = v4(ip);
    return PRIVATE_V4.some(([start, size]) => n >= start && n < start + size);
  }
  if (!net.isIPv6(ip)) return true;
  const a = ip.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) || a.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(a)) {
    const [hi, lo] = a.slice(7).split(':').map(h => parseInt(h, 16));
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a) || /^2001:db8:/.test(a);
}

const allowPrivate = () => process.env.ALLOW_PRIVATE_FEEDS === '1';
const blocked = host => Object.assign(new Error(`${host} points to a private network address, which iweb won’t fetch`), { code: 'EPRIVATE' });

function lookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!allowPrivate() && addrs.some(a => isPrivateAddress(a.address))) return cb(blocked(hostname));
    if (options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

const decoders = { gzip: zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress };

// A GET for a URL nobody vetted: guarded DNS, at most 5 redirects (each one checked again),
// a time limit and a size limit. Resolves to { status, text }.
export function fetchUntrusted(url, { headers = {}, timeout = 12000, maxBytes = 5e6, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('not a valid URL')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('not an http(s) URL'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !allowPrivate() && isPrivateAddress(host)) return reject(blocked(host));

    const req = (u.protocol === 'https:' ? https : http).get(u, {
      headers: { 'accept-encoding': 'gzip, deflate, br', ...headers },
      lookup,
      timeout,
    }, res => {
      const { statusCode: status, headers: h } = res;
      if (status >= 300 && status < 400 && h.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error(`too many redirects from ${u.host}`));
        return resolve(fetchUntrusted(new URL(h.location, u).href, { headers, timeout, maxBytes, redirects: redirects - 1 }));
      }
      const decode = decoders[(h['content-encoding'] || '').trim()];
      const body = decode ? res.pipe(decode()) : res;
      const chunks = [];
      let size = 0;
      body.on('data', c => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new Error(`response from ${u.host} is larger than ${Math.round(maxBytes / 1e6)} MB`));
        } else chunks.push(c);
      });
      body.on('end', () => resolve({ status, text: Buffer.concat(chunks).toString('utf8') }));
      body.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`timed out fetching ${u.host}`)));
    req.on('error', reject);
  });
}
