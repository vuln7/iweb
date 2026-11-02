import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectors } from '../connectors/index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const file = path.join(dir, 'profile.json');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const DEFAULT_INTERESTS = ['ai', 'space', 'design', 'science', 'gadgets'];

function withDefaults(p = {}) {
  const sources = {};
  for (const c of connectors) sources[c.id] = { ...c.defaults, ...(p.sources?.[c.id] || {}) };
  return {
    interests: p.interests || DEFAULT_INTERESTS.map(term => ({ term, weight: 1 })),
    freshnessHours: p.freshnessHours || 36,
    sources,
    affinity: { terms: p.affinity?.terms || {}, authors: p.affinity?.authors || {} },
    hidden: p.hidden || [],
    saved: p.saved || [],
  };
}

let profile;

export async function getProfile() {
  if (!profile) {
    try { profile = withDefaults(JSON.parse(await readFile(file, 'utf8'))); }
    catch { profile = withDefaults(); }
  }
  return profile;
}

export async function saveProfile() {
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(profile, null, 2));
}

const asList = v => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/)).map(s => String(s).trim()).filter(Boolean).slice(0, 150);

// Only the user-editable parts come from the client; learned affinities and
// hidden/saved lists are managed server-side through feedback.
export async function updateProfile(input = {}) {
  const p = await getProfile();
  if (Array.isArray(input.interests)) {
    const seen = new Set();
    p.interests = input.interests
      .map(i => (typeof i === 'string' ? { term: i } : i))
      .map(i => ({ term: String(i.term || '').trim().toLowerCase().slice(0, 60), weight: clamp(Number(i.weight) || 1, 0.1, 3) }))
      .filter(i => i.term && !seen.has(i.term) && seen.add(i.term))
      .slice(0, 50);
  }
  if (input.freshnessHours != null) p.freshnessHours = clamp(Number(input.freshnessHours) || 36, 3, 24 * 14);
  for (const c of connectors) {
    const src = input.sources?.[c.id];
    if (!src) continue;
    const cur = p.sources[c.id];
    if ('enabled' in src) cur.enabled = !!src.enabled;
    if ('weight' in src) cur.weight = clamp(Number(src.weight) || 0, 0, 3);
    for (const f of c.fields) {
      if (!(f.key in src)) continue;
      const v = src[f.key];
      cur[f.key] = f.type === 'list' ? asList(v) : f.type === 'bool' ? !!v : String(v ?? '').trim().slice(0, 200);
    }
  }
  await saveProfile();
  return p;
}

export async function resetLearning() {
  const p = await getProfile();
  p.affinity = { terms: {}, authors: {} };
  p.hidden = [];
  await saveProfile();
  return p;
}
