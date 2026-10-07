// Shared plumbing for the Kev probe (research/kev-20261007/03-probe-results.md). DEVELOPMENT evidence:
// dev-split bed seeds, generator truth as labels. Every Kev and hosted-model request is counted in a
// persistent budget file so the run can never exceed the caps it was given (Kev <= 2500, hosted <= 400).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { SystemOneClient } from '../../src/judgment.mjs';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const RUN_DIR = process.env.KEV_PROBE_RUN_DIR ?? path.join(ROOT, 'experiments/runs/kev-probe');
export const KEV_URL = process.env.KEV_PROBE_URL ?? 'http://127.0.0.1:8008';
export const CAPS = { kev: 2500, hosted: 400 };
mkdirSync(RUN_DIR, { recursive: true });

// ---- budget ---------------------------------------------------------------------------------
const BUDGET_FILE = path.join(RUN_DIR, 'budget.json');
export function budget() {
  return existsSync(BUDGET_FILE) ? JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) : { kev: 0, hosted: 0, log: [] };
}
// Reserve n requests of a kind before sending them; throws once the cap would be exceeded.
export function spend(kind, n = 1, why = '') {
  const b = budget();
  if (b[kind] + n > CAPS[kind]) throw new Error(`budget: ${kind} ${b[kind]} + ${n} would exceed cap ${CAPS[kind]} (${why})`);
  b[kind] += n;
  writeFileSync(BUDGET_FILE, JSON.stringify(b, null, 1));
  return b[kind];
}

// ---- Kev ------------------------------------------------------------------------------------
export function kevClient() { return new SystemOneClient({ url: KEV_URL, model: 'kev-latest', timeoutMs: 600000 }); }
export async function kevIdentity() {
  const { raw } = await kevClient().describe();
  const m = raw?.models?.[0] ?? {};
  return { run: m.run, base: m.base, device: m.device, dtype: m.dtype, temperature: m.temperature, backend: m.backend, lora: m.lora };
}
// Raw POST for endpoints the Foundry client does not wrap (permute).
export async function kevPost(route, body) {
  const res = await fetch(KEV_URL + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(900000) });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`kev ${route} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ---- machine load ---------------------------------------------------------------------------
export function load() {
  const [one, five, fifteen] = readFileSync('/proc/loadavg', 'utf8').split(' ').map(Number);
  let uptime = '';
  try { uptime = execFileSync('uptime', { encoding: 'utf8' }).trim(); } catch {}
  return { one, five, fifteen, uptime, at: new Date().toISOString() };
}

// ---- files ----------------------------------------------------------------------------------
export const readJsonl = file => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
export const appendJsonl = (file, row) => { mkdirSync(path.dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(row) + '\n'); };
export const writeJsonl = (file, rows) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };

// ---- small stats ----------------------------------------------------------------------------
export const median = xs => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
// p90 by nearest rank.
export const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : NaN; };

// Jaro-Winkler similarity (for the name-matching rule baseline).
export function jaroWinkler(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) for (let j = Math.max(0, i - win); j < Math.min(lb, i + win + 1); j++) {
    if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < Math.min(4, la, lb) && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

// Deterministic split: calibration vs evaluation by seed parity of a hash, 50/50 within each dataset.
export function splitOf(key) {
  let h = 2166136261;
  for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h % 2 === 0 ? 'calibration' : 'evaluation';
}
