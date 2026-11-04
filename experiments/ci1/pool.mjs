// CI-1 pool census: which corpus n8n templates n8n-sim can execute, and which of those are non-trivial (research/ci1-20261021).
// Reads raw template files as DATA (structure fields only; no text is printed or written). Writes a feature table outside git and
// prints counts. Usage: node experiments/ci1/pool.mjs [--out /var/tmp/foundry-work/ci1-20261021/pool.json]
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflowOf } from '../../app/importers/n8n.mjs';
import { RAW_DIR, LOCAL_DIR, INDEX, CUTOFF } from './acquire.mjs';

// What n8n-sim implements (experiments/ci1/sim/n8n-sim.js). An operation list of null means every operation listed in OPS_OK.
export const TRIGGERS = new Set(['manualTrigger', 'scheduleTrigger', 'cron', 'interval', 'start', 'webhook', 'formTrigger', 'gmailTrigger', 'telegramTrigger', 'googleSheetsTrigger', 'emailReadImap']);
export const CORE = new Set(['set', 'if', 'switch', 'filter', 'merge', 'code', 'function', 'functionItem', 'splitOut', 'aggregate', 'itemLists', 'sort', 'limit',
  'removeDuplicates', 'dateTime', 'noOp', 'splitInBatches', 'wait', 'respondToWebhook', 'summarize', 'renameKeys', 'compareDatasets', 'stopAndError', 'stickyNote']);
export const EFFECT_NODES = new Set(['googleSheets', 'gmail', 'emailSend', 'slack', 'telegram', 'discord', 'respondToWebhook']);
export const LOGIC = new Set(['if', 'switch', 'filter', 'merge', 'code', 'function', 'functionItem', 'splitOut', 'aggregate', 'itemLists', 'sort', 'limit', 'removeDuplicates',
  'dateTime', 'summarize', 'compareDatasets', 'splitInBatches', 'renameKeys']);
const opOf = p => String(p?.operation ?? '');
/** null when the node is supported, else a short reason. */
export function unsupported(node) {
  const type = String(node.type ?? ''), base = type.split('.').pop(), p = node.parameters ?? {};
  if (!type.startsWith('n8n-nodes-base.')) return `pkg:${type.split('.')[0]}`;
  if (TRIGGERS.has(base)) return null;
  if (base === 'code') return p.language && p.language !== 'javaScript' ? 'code:python' : null;
  if (base === 'wait') return ['webhook', 'form'].includes(p.resume) ? `wait:${p.resume}` : null;
  if (CORE.has(base)) return null;
  if (base === 'googleSheets') { const op = opOf(p) || 'read'; return ['append', 'appendOrUpdate', 'update', 'read', 'getAll', 'lookup', 'clear', 'delete'].includes(op) && (p.resource ?? 'sheet') !== 'spreadsheet' ? null : `sheets:${op}`; }
  if (base === 'gmail') { const op = opOf(p) || 'send'; return ['send', 'reply', 'getAll', 'get', 'addLabels', 'removeLabels', 'markAsRead', 'markAsUnread'].includes(op) && ['message', undefined].includes(p.resource) ? null : `gmail:${p.resource ?? 'message'}.${op}`; }
  if (base === 'emailSend') return null;
  if (base === 'slack') { const op = opOf(p) || 'post'; return ['post', 'send'].includes(op) && ['message', undefined].includes(p.resource) ? null : `slack:${p.resource ?? 'message'}.${op}`; }
  if (base === 'telegram') { const op = opOf(p) || 'sendMessage'; return op === 'sendMessage' && ['message', undefined].includes(p.resource) ? null : `telegram:${p.resource ?? 'message'}.${op}`; }
  if (base === 'discord') { const op = opOf(p) || 'sendLegacy'; return ['send', 'sendLegacy'].includes(op) || p.resource === 'webhook' ? null : `discord:${op}`; }
  return `node:${base}`;
}

export function loadRaw(id) {
  for (const dir of [LOCAL_DIR, RAW_DIR]) {
    const file = path.join(dir, `${id}.json.gz`);
    if (existsSync(file)) { const buf = readFileSync(file); return { file, sha256: createHash('sha256').update(buf).digest('hex'), doc: JSON.parse(gunzipSync(buf).toString('utf8')) }; }
  }
  return null;
}

export function census() {
  const index = JSON.parse(readFileSync(INDEX, 'utf8'));
  const ids = [...new Set([LOCAL_DIR, RAW_DIR].flatMap(d => existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.json.gz')).map(f => f.replace('.json.gz', '')) : []))];
  const rows = [];
  for (const id of ids) {
    const raw = loadRaw(id);
    let wf; try { wf = workflowOf(raw.doc); } catch { rows.push({ id, parse: false }); continue; }
    const nodes = wf.nodes.filter(n => !String(n.type).endsWith('stickyNote'));
    const blockers = [...new Set(nodes.map(unsupported).filter(Boolean))];
    const bases = nodes.map(n => String(n.type).split('.').pop());
    const triggers = bases.filter(b => TRIGGERS.has(b));
    const meta = index[id] ?? {}, createdAt = raw.doc?.workflow?.createdAt ?? meta.createdAt ?? null;
    rows.push({ id, sha256: raw.sha256, source: raw.file.startsWith(LOCAL_DIR) ? 'local-20261006' : 'ci1-fetch-20261021', createdAt, post: (createdAt ?? '') >= CUTOFF,
      n: nodes.length, blockers, triggers, effects: bases.filter(b => EFFECT_NODES.has(b)).length, logic: bases.filter(b => LOGIC.has(b)).length,
      code: bases.filter(b => ['code', 'function', 'functionItem'].includes(b)).length, author: raw.doc?.workflow?.user?.username ?? null,
      types: [...new Set(bases)].sort() });
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '/var/tmp/foundry-work/ci1-20261021/pool.json';
  const rows = census();
  const ok = rows.filter(r => r.parse !== false);
  const sim = ok.filter(r => !r.blockers.length && r.triggers.length >= 1);
  const nontrivial = sim.filter(r => r.n >= 4 && r.effects >= 1 && r.logic >= 1);
  const bc = new Map(); for (const r of ok) for (const b of r.blockers) bc.set(b, (bc.get(b) ?? 0) + 1);
  console.log({ files: rows.length, parsed: ok.length, simulable: sim.length, nontrivial: nontrivial.length, nontrivialPost: nontrivial.filter(r => r.post).length,
    singleTrigger: nontrivial.filter(r => r.triggers.length === 1).length, withCode: nontrivial.filter(r => r.code).length, medianNodes: nontrivial.map(r => r.n).sort((a, b) => a - b)[nontrivial.length >> 1] });
  console.log('top blockers', [...bc].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k}:${v}`).join(' '));
  writeFileSync(out, JSON.stringify(rows));
}
