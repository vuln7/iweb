import { readFileSync } from 'node:fs';

// Minimal .env reader: KEY=value lines, # comments, optional quotes.
// Real environment variables win over the file.
export function loadEnv(file) {
  const env = { ...process.env };
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return env; }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
