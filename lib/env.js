import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Where profile.json and accounts.json live. DATA_DIR points it at a mounted volume in Docker or on a host.
export const dataDir = () => path.resolve(root, process.env.DATA_DIR || 'data');

// Minimal .env reader: KEY=value lines, # comments, optional quotes.
// Real environment variables win over the file. Values from the file are copied into
// process.env too, so modules that read a setting later (dataDir) see it.
export function loadEnv(file) {
  const env = { ...process.env };
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return env; }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    env[m[1]] = process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
