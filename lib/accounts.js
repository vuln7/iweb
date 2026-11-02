import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir } from './env.js';

// "Sign in with…" via OAuth 2.0 authorization-code flow. Tokens live in
// accounts.json in the data folder on this machine and are never sent to the browser.

const file = () => path.join(dataDir(), 'accounts.json');
const UA = 'web:iweb:v0.1 (personal feed aggregator)';
const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

export const providers = {
  youtube: {
    label: 'YouTube',
    button: 'Sign in with Google',
    imports: 'your YouTube subscriptions',
    clientEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
    setupSteps: [
      'In Google Cloud, enable “YouTube Data API v3”, then create an OAuth client ID of type “Web application”.',
      'Add this as an authorized redirect URI:',
      'While the app is in “Testing”, add your Google account as a test user on the OAuth consent screen.',
    ],
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    authParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    async whoami(token) {
      const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: `Bearer ${token}` } });
      const data = await res.json();
      return data.items?.[0]?.snippet?.title || 'your Google account';
    },
    async revoke(token) {
      await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
    },
  },

  reddit: {
    label: 'Reddit',
    button: 'Sign in with Reddit',
    imports: 'your Reddit home feed',
    clientEnv: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
    basicAuth: true,
    setupUrl: 'https://www.reddit.com/prefs/apps',
    setupSteps: [
      'At reddit.com/prefs/apps, create an app of type “web app”.',
      'Set its redirect URI to:',
      'Copy the ID (under the app name) and the secret.',
    ],
    authorizeUrl: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    scope: 'identity mysubreddits read',
    authParams: { duration: 'permanent' },
    async whoami(token) {
      const res = await fetch('https://oauth.reddit.com/api/v1/me', { headers: { authorization: `Bearer ${token}`, 'user-agent': UA } });
      const data = await res.json();
      return data.name ? `u/${data.name}` : 'your Reddit account';
    },
    async revoke(token, env) {
      await fetch('https://www.reddit.com/api/v1/revoke_token', {
        method: 'POST',
        headers: { authorization: basic(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET), 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
        body: new URLSearchParams({ token, token_type_hint: 'refresh_token' }),
      });
    },
  },
};

async function tokenRequest(p, env, params) {
  const [id, secret] = p.clientEnv.map(k => env[k]);
  const body = new URLSearchParams(params);
  const headers = { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA };
  if (p.basicAuth) headers.authorization = basic(id, secret);
  else { body.set('client_id', id); body.set('client_secret', secret); }
  const res = await fetch(p.tokenUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(12000) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error(`${p.label} rejected iweb’s app credentials. Check ${p.clientEnv.join(' and ')} in .env.`);
  if (!res.ok || data.error) throw Object.assign(new Error(data.error_description || data.error || `HTTP ${res.status}`), { code: data.error });
  return data;
}

export function createAccounts(env, baseUrl) {
  let store = null;
  const pending = new Map(); // OAuth state -> { id, at }, guards the callback against CSRF
  const refreshing = new Map();

  const load = async () => (store ??= await readFile(file(), 'utf8').then(JSON.parse).catch(() => ({})));
  const save = async () => {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(file(), JSON.stringify(store, null, 2));
  };
  const redirectUri = id => `${baseUrl}/auth/${id}/callback`;
  const missing = p => p.clientEnv.filter(k => !env[k]);
  const provider = id => {
    const p = providers[id];
    if (!p) throw Object.assign(new Error('Unknown account type'), { status: 404 });
    return p;
  };

  async function refresh(id) {
    const a = store[id];
    try {
      const t = await tokenRequest(providers[id], env, { grant_type: 'refresh_token', refresh_token: a.refresh_token });
      a.access_token = t.access_token;
      a.expires_at = Date.now() + (t.expires_in || 3600) * 1000;
      if (t.refresh_token) a.refresh_token = t.refresh_token;
      await save();
      return a.access_token;
    } catch (e) {
      if (e.code === 'invalid_grant') {
        delete store[id];
        await save();
      }
      throw new Error(`${providers[id].label} sign-in expired. Reconnect it in Tune my feed.`);
    }
  }

  return {
    async list() {
      await load();
      return Object.entries(providers).map(([id, p]) => ({
        id,
        label: p.label,
        button: p.button,
        imports: p.imports,
        setupUrl: p.setupUrl,
        setupSteps: p.setupSteps,
        redirectUri: redirectUri(id),
        missingEnv: missing(p),
        connected: !!store[id],
        broken: !!store[id]?.broken,
        name: store[id]?.name || null,
        connectedAt: store[id]?.connectedAt || null,
      }));
    },

    startUrl(id) {
      const p = provider(id);
      if (missing(p).length) throw new Error(`Add ${missing(p).join(' and ')} to .env first.`);
      for (const [s, v] of pending) if (Date.now() - v.at > 15 * 60e3) pending.delete(s);
      const state = randomBytes(16).toString('hex');
      pending.set(state, { id, at: Date.now() });
      const q = new URLSearchParams({ client_id: env[p.clientEnv[0]], response_type: 'code', redirect_uri: redirectUri(id), scope: p.scope, state, ...p.authParams });
      return `${p.authorizeUrl}?${q}`;
    },

    async finish(id, params) {
      const p = provider(id);
      const st = pending.get(params.get('state'));
      pending.delete(params.get('state'));
      if (params.get('error')) throw new Error(params.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in failed: ${params.get('error')}`);
      if (!st || st.id !== id || Date.now() - st.at > 15 * 60e3) throw new Error('That sign-in expired or didn’t start from iweb. Please try again.');
      const t = await tokenRequest(p, env, { grant_type: 'authorization_code', code: params.get('code') || '', redirect_uri: redirectUri(id) });
      const name = await p.whoami(t.access_token).catch(() => null);
      await load();
      store[id] = {
        access_token: t.access_token,
        refresh_token: t.refresh_token || null,
        expires_at: Date.now() + (t.expires_in || 3600) * 1000,
        name,
        connectedAt: Date.now(),
      };
      await save();
    },

    // A valid access token for the provider, refreshing it if needed; null when not connected.
    async token(id) {
      await load();
      const a = store[id];
      if (!a) return null;
      if (a.broken) throw new Error(`${providers[id].label} sign-in stopped working. Reconnect it in Tune my feed.`);
      if (a.expires_at > Date.now() + 60e3) return a.access_token;
      if (!a.refresh_token) throw new Error(`${providers[id].label} sign-in expired. Reconnect it in Tune my feed.`);
      if (!refreshing.has(id)) refreshing.set(id, refresh(id).finally(() => refreshing.delete(id)));
      return refreshing.get(id);
    },

    // A connector got 401 with this token (revoked, or expired early): stop using it until reconnected.
    async markBroken(id) {
      await load();
      if (!store[id] || store[id].broken) return;
      store[id].broken = true;
      await save();
    },

    async disconnect(id) {
      const p = provider(id);
      await load();
      const a = store[id];
      if (!a) return;
      delete store[id];
      await save();
      await p.revoke(a.refresh_token || a.access_token, env).catch(() => {}); // best effort
    },
  };
}
