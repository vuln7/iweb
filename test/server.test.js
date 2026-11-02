import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Boots real servers on spare ports. Nothing here asks for the feed, so no test needs the network.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const running = [];

async function boot(env) {
  const port = 40000 + Math.floor(Math.random() * 20000);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'iweb-test-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...env }, stdio: 'pipe' });
  running.push({ child, dataDir });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', d => String(d).includes('iweb running') && resolve());
    child.on('exit', code => reject(new Error(`server exited with ${code}`)));
  });
  return `http://127.0.0.1:${port}`;
}

after(async () => {
  for (const { child, dataDir } of running) {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('serves the app, health and settings', async () => {
  const base = await boot({});
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>iweb/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const meta = await (await fetch(`${base}/api/meta`)).json();
  assert.equal(meta.demo, false);
  assert.ok(meta.sourceUrl.startsWith('https://'));
  const profile = await (await fetch(`${base}/api/profile`)).json();
  assert.ok(profile.interests.length > 0);
  assert.equal((await fetch(`${base}/../server.js`)).status, 404);
});

test('a password locks everything but the health check', async () => {
  const base = await boot({ IWEB_PASSWORD: 'correct horse' });
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/profile`)).status, 401);
  const page = await fetch(base, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/login/);

  const wrong = await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ password: 'nope' }), redirect: 'manual' });
  assert.equal(wrong.status, 401);
  const right = await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ password: 'correct horse', next: '//evil.example' }), redirect: 'manual' });
  assert.equal(right.status, 303);
  assert.equal(right.headers.get('location'), '/');
  const cookie = right.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/profile`, { headers: { cookie } })).status, 200);
});

test('demo mode is read-only and never starts a sign-in', async () => {
  const base = await boot({ DEMO: '1' });
  assert.equal((await (await fetch(`${base}/api/meta`)).json()).demo, true);
  const put = await fetch(`${base}/api/profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sources: { rss: { feeds: ['http://127.0.0.1/'] } } }) });
  assert.equal(put.status, 403);
  assert.equal((await fetch(`${base}/api/feedback`, { method: 'POST', body: '{}' })).status, 403);
  assert.deepEqual((await (await fetch(`${base}/api/accounts`)).json()).accounts, []);
  const auth = await fetch(`${base}/auth/youtube/start`, { redirect: 'manual' });
  assert.equal(auth.headers.get('location'), '/');
});
