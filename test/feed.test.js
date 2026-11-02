import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, dedupe } from '../lib/dedupe.js';
import { rank } from '../lib/ranker.js';
import { tokens, matchesTerm } from '../lib/text.js';
import { withDefaults } from '../lib/profile.js';

const now = Date.now();
const post = (id, source, extra = {}) => ({ id, source, author: id, authorKey: `${source}:${id}`, title: '', text: '', url: `https://example.com/${id}`, createdAt: now - 3600e3, engagement: null, media: null, ...extra });

test('canonical URLs ignore tracking parameters, www and trailing slashes', () => {
  assert.equal(canonical('https://www.example.com/a/?utm_source=x&id=2'), canonical('https://example.com/a?id=2'));
  assert.equal(canonical('https://youtu.be/dQw4w9WgXcQ'), canonical('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc'));
});

test('the same link on two platforms becomes one card with "also on"', () => {
  const items = dedupe([
    post('r1', 'reddit', { url: 'https://example.com/story', community: 'r/space', discussion: { url: 'https://reddit.com/r/space/1', comments: 40 } }),
    post('rss1', 'rss', { url: 'https://www.example.com/story?utm_medium=feed' }),
  ], { reddit: 'Reddit' });
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'rss');
  assert.equal(items[0].alsoOn[0].label, 'r/space');
  assert.equal(items[0].alsoOn[0].comments, 40);
});

test('interests match whole words and simple plurals only', () => {
  assert.equal(matchesTerm('New rocket engines tested', 'rocket'), true);
  assert.equal(matchesTerm('Three rockets launched', 'rocket'), true);
  assert.equal(matchesTerm('Rocketry club', 'rocket'), false);
  assert.equal(matchesTerm('Big AI news', 'ai'), true);
  assert.equal(matchesTerm('Said the chair', 'ai'), false);
});

test('tokens drop URLs, stopwords and numbers', () => {
  assert.deepEqual(tokens('The telescope https://nasa.gov/x found 42 galaxies'), ['telescope', 'galaxies']);
});

test('ranking boosts interests, explains why, and leaves the input untouched', () => {
  const profile = withDefaults({ interests: [{ term: 'telescope', weight: 1 }] });
  const items = [post('a', 'rss', { title: 'Gardening tips' }), post('b', 'rss', { title: 'A new telescope opens' })];
  const ranked = rank(items, profile);
  assert.equal(ranked[0].id, 'b');
  assert.deepEqual(ranked[0].why, ['Matches “telescope”']);
  assert.equal(items[1].why, undefined);
});

test('hidden posts and switched-off sources are left out', () => {
  const profile = withDefaults({ hidden: ['a'], sources: { reddit: { weight: 0 } } });
  const ranked = rank([post('a', 'rss'), post('b', 'reddit'), post('c', 'rss')], profile);
  assert.deepEqual(ranked.map(i => i.id), ['c']);
});
