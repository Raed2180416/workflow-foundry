// The person's settings for one workspace: <workspace>/settings.json (atomic write, 0600). FoundryApp.run reads `mode` directly
// (practice-only refuses every live run, from the site, the CLI and MCP alike).
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { FoundryError } from '../../src/data.mjs';

export const DEFAULTS = Object.freeze({ theme: 'auto', mode: 'normal', allowedAI: 'none', builder: 'templates', tokenCap: 200000, notifications: false });
const ALLOWED = { theme: ['auto', 'light', 'dark'], mode: ['normal', 'practice-only'], allowedAI: ['none', 'mercury'], builder: ['templates', 'mercury'] };

export function loadSettings(root) {
  const file = path.join(root, 'settings.json');
  if (!existsSync(file)) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...pick(JSON.parse(readFileSync(file, 'utf8'))) }; }
  catch { return { ...DEFAULTS, mode: 'practice-only', unreadable: true }; }
}
function pick(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, list] of Object.entries(ALLOWED)) if (list.includes(v[k])) out[k] = v[k];
  if (Number.isInteger(v.tokenCap) && v.tokenCap >= 1000 && v.tokenCap <= 5000000) out.tokenCap = v.tokenCap;
  if (typeof v.notifications === 'boolean') out.notifications = v.notifications;
  return out;
}
/** Change some settings; unknown keys or values are refused (never silently dropped). */
export function saveSettings(root, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new FoundryError('SETTINGS', 'settings is an object');
  const picked = pick(changes);
  const bad = Object.keys(changes).filter(k => !(k in picked));
  if (bad.length) throw new FoundryError('SETTINGS', `Not a setting or not an allowed value: ${bad.join(', ')}`);
  // The builder can only be an AI the settings allow.
  const next = { ...loadSettings(root), ...picked };
  delete next.unreadable;
  if (next.builder === 'mercury' && next.allowedAI !== 'mercury') next.builder = 'templates';
  const file = path.join(root, 'settings.json'), tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  return next;
}
