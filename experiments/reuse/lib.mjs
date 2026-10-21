// Shared helpers for the C2 reuse experiment (experiments/reuse; research/reuse-20261021/). Node built-ins only, plus the
// SOP-Bench harness helpers this experiment reuses unchanged.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
export const RESEARCH = path.join(REPO, 'research/reuse-20261021');
/** Live run data (per-item records, worlds, builder workdirs): outside the repo; SOP-Bench-derived text is CC BY-NC. */
export const LIVE_ROOT = '/var/tmp/foundry-work/reuse-c2';
export const FROZEN_P2 = path.join(REPO, 'experiments/sopbench/frozen/p2');

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export function writeJson(p, obj, indent = 1) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, indent) + '\n'); }
export const readJsonl = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export function appendJsonl(p, obj) { mkdirSync(path.dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify(obj) + '\n'); }

/** Canonical JSON (sorted keys, no spaces), as experiments/sopbench/lib.mjs canon(). */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const shaCanon = v => sha256(canon(v));

/** Python json.dumps(obj) with the default separators (', ', ': ') and ensure_ascii=True, for JSON values built here
 * (strings, finite numbers, booleans, null, arrays, plain objects in insertion order). Integers print as integers. */
export function pyDumps(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === 'string') return JSON.stringify(v).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (Array.isArray(v)) return `[${v.map(pyDumps).join(', ')}]`;
  return `{${Object.entries(v).map(([k, x]) => `${pyDumps(k)}: ${pyDumps(x)}`).join(', ')}}`;
}

/** Deterministic PRNG (mulberry32 seeded from sha256), as experiments/sopbench/lib.mjs rng(). */
export function rng(seedStr) {
  let a = parseInt(sha256(String(seedStr)).slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
export function shuffled(xs, r) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const usd = x => Math.round(x * 1e6) / 1e6;
