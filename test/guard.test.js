import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, fetchUntrusted } from '../lib/guard.js';

test('private, loopback and link-local addresses are refused', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.4.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '64:ff9b::10.0.0.1', 'not-an-ip']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('untrusted fetches refuse local hosts before connecting', async () => {
  for (const url of ['http://127.0.0.1:9/', 'http://[::1]:9/', 'http://localhost:9/', 'http://169.254.169.254/latest/meta-data/']) {
    await assert.rejects(fetchUntrusted(url), /private network address/, url);
  }
});

test('untrusted fetches only speak http and https', async () => {
  await assert.rejects(fetchUntrusted('file:///etc/passwd'), /http\(s\)/);
  await assert.rejects(fetchUntrusted('not a url'), /valid URL/);
});
