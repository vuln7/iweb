import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

// A one-password lock for installs that live on the public internet. With IWEB_PASSWORD set, every page
// and API call needs a session cookie, which /login hands out for the right password. The cookie is an
// HMAC of the password, so changing the password signs everyone out.

const COOKIE = 'iweb_session';
const MONTH = 30 * 24 * 3600;
const same = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export function createGate(password, { secure = false } = {}) {
  if (!password) return { enabled: false };
  const token = createHmac('sha256', password).update('iweb-session-v1').digest('hex');
  const attempts = new Map(); // remote address -> { count, until }

  const cookieOf = req => (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  const setCookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  // Only a path on this site: "//host" and "/\host" are other sites to a browser.
  const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : '/');

  function throttled(ip) {
    const a = attempts.get(ip);
    if (!a || a.until < Date.now()) return false;
    return a.count >= 10;
  }
  function failed(ip) {
    const a = attempts.get(ip);
    if (!a || a.until < Date.now()) attempts.set(ip, { count: 1, until: Date.now() + 10 * 60e3 });
    else a.count++;
    if (attempts.size > 5000) attempts.delete(attempts.keys().next().value);
  }

  function page(res, status, { error = '', next = '/' } = {}) {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(loginHtml(error, next));
  }

  return {
    enabled: true,
    allowed: req => same(cookieOf(req), token),

    async login(req, res, url) {
      if (req.method !== 'POST') return page(res, 200, { next: safeNext(url.searchParams.get('next')) });
      const ip = req.socket.remoteAddress || '';
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) break;
      }
      const form = new URLSearchParams(raw);
      const next = safeNext(form.get('next'));
      if (throttled(ip)) return page(res, 429, { error: 'Too many tries. Wait ten minutes and try again.', next });
      if (!same(form.get('password') || '', password)) {
        failed(ip);
        return page(res, 401, { error: 'That password isn’t right.', next });
      }
      attempts.delete(ip);
      res.writeHead(303, { location: next, 'set-cookie': setCookie(token, MONTH), 'cache-control': 'no-store' });
      res.end();
    },

    logout(res) {
      res.writeHead(303, { location: '/login', 'set-cookie': setCookie('', 0), 'cache-control': 'no-store' });
      res.end();
    },
  };
}

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function loginHtml(error, next) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>iweb</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --ground: #000; --surface: #111; --raised: #2a2a2a; --text: #fff; --muted: #b4b4b4; --faint: #949494; --accent: #4c86ff; --negative: #e5566f; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 16px; background: var(--ground); color: var(--text); font: 400 14px/1.5 Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  main { width: min(360px, 100%); padding: 28px 24px 24px; border-radius: 26px; background: var(--surface); }
  .mark { width: 28px; height: 28px; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 13fr 9fr 9fr 13fr; gap: 2px; margin-bottom: 20px; }
  .mark i { border-radius: 3px; background: #fff; }
  .mark i:nth-child(1) { grid-row: 1 / span 2; }
  .mark i:nth-child(2) { grid-row: 1; background: var(--accent); }
  .mark i:nth-child(3) { grid-row: 3 / span 2; opacity: 0.5; }
  .mark i:nth-child(4) { grid-row: 2 / span 3; }
  h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  p { margin: 0 0 20px; color: var(--muted); }
  label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; }
  input { width: 100%; height: 44px; padding: 0 14px; border: 1px solid #262626; border-radius: 12px; background: var(--ground); color: var(--text); font: inherit; font-size: 16px; }
  input:focus { outline: none; border-color: var(--accent); }
  button { width: 100%; height: 44px; margin-top: 14px; border: 0; border-radius: 999px; background: #fff; color: #000; font: inherit; font-weight: 500; cursor: pointer; }
  button:hover { background: #e6e6e6; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .error { margin: 12px 0 0; color: var(--negative); font-size: 13px; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  <h1>This iweb is private</h1>
  <p>Enter the password its owner set to open the feed.</p>
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${esc(next)}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <button type="submit">Open iweb</button>
  </form>
</main>
</body>
</html>`;
}
