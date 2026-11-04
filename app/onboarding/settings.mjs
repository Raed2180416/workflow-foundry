// The person's settings for one workspace: <workspace>/settings.json (atomic write, 0600). FoundryApp.run reads `mode` directly
// (practice-only refuses every live run, from the site, the CLI and MCP alike).
//
// An organisation's machine policy (app/core/machine-policy.mjs) is applied on top: a key it sets is reported in `managed` and cannot be
// changed here (saveSettings refuses it). It can only make Foundry stricter.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { FoundryError } from '../../src/data.mjs';
import { machinePolicy } from '../core/machine-policy.mjs';

export const DEFAULTS = Object.freeze({ theme: 'auto', mode: 'normal', allowedAI: 'none', builder: 'templates', tokenCap: 200000, notifications: false, yourName: '' });
const ALLOWED = { theme: ['auto', 'light', 'dark'], mode: ['normal', 'practice-only'], allowedAI: ['none', 'mercury', 'haiku'], builder: ['templates', 'mercury'] };

function own(root) {
  const file = path.join(root, 'settings.json');
  if (!existsSync(file)) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...pick(JSON.parse(readFileSync(file, 'utf8'))) }; }
  catch { return { ...DEFAULTS, mode: 'practice-only', unreadable: true }; }
}
export function loadSettings(root, { policy = machinePolicy() } = {}) {
  const s = own(root);
  const managed = {};
  if (policy.mode) { s.mode = policy.mode; managed.mode = true; }
  if (policy.allowedAI) { s.allowedAI = policy.allowedAI; managed.allowedAI = true; if (s.builder !== 'templates') s.builder = 'templates'; }
  return { ...s, managed, policyFiles: policy.files, ...(policy.ignored.length ? { policyIgnored: policy.ignored } : {}) };
}
function pick(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, list] of Object.entries(ALLOWED)) if (list.includes(v[k])) out[k] = v[k];
  // tokenCap is not a setting here (fix round 2026-10-21, review:honesty older defect): the per-build limit is fixed when Foundry starts
  // (--token-cap, default DEFAULTS.tokenCap), and nothing read a value saved here, so saving one is refused rather than kept and ignored.
  if (typeof v.notifications === 'boolean') out.notifications = v.notifications;
  // The name shown in records next to this computer's account ("Ravi Patel (ravi@laptop)"); plain text, no markup is ever parsed.
  if (typeof v.yourName === 'string' && v.yourName.length <= 80 && !/[\u0000-\u001f<>]/.test(v.yourName)) out.yourName = v.yourName.trim();
  return out;
}
/** Change some settings; unknown keys or values are refused (never silently dropped), and so is a key the organisation set. */
export function saveSettings(root, changes, { policy = machinePolicy() } = {}) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new FoundryError('SETTINGS', 'settings is an object');
  if (Object.hasOwn(changes, 'tokenCap')) throw new FoundryError('SETTINGS', 'The AI builder\'s limit is set when Foundry starts (--token-cap), not in Settings. Nothing was saved.');
  const picked = pick(changes);
  const bad = Object.keys(changes).filter(k => !(k in picked));
  if (bad.length) throw new FoundryError('SETTINGS', `Not a setting or not an allowed value: ${bad.join(', ')}`);
  const locked = Object.keys(picked).filter(k => (k === 'mode' && policy.mode && picked.mode !== policy.mode) || (k === 'allowedAI' && policy.allowedAI && picked.allowedAI !== policy.allowedAI));
  if (locked.length) throw new FoundryError('SETTINGS_MANAGED', 'Your organisation set this on this computer, so it can\'t be changed here. Ask whoever set up the pilot.');
  // The builder can only be an AI the settings allow.
  const next = { ...own(root), ...picked };
  delete next.unreadable;
  if (next.builder === 'mercury' && next.allowedAI !== 'mercury') next.builder = 'templates';
  const file = path.join(root, 'settings.json'), tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  return loadSettings(root, { policy });
}
