#!/usr/bin/env node
// Freeze manifest for PREREG-TRACKER (research/tracker-20261021/freeze.json): sha256 of every code file, prompt, gold and input the
// evaluation depends on. `node experiments/tracker-v2/freeze.mjs` writes it; `--check` compares the tree against it and exits 1 on drift.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTURE_SYSTEM, BIND_SYSTEM, CAPTURE_PROMPT_ID, BIND_PROMPT_ID } from '../../app/core/tracker/model.mjs';
import { PROSE_SYSTEM, PROSE_PROMPT_ID } from './prose.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = path.join(ROOT, 'research/tracker-20261021/freeze.json');
const sha = b => createHash('sha256').update(b).digest('hex');
const CODE = ['app/core/tracker/checks.mjs', 'app/core/tracker/status.mjs', 'app/core/tracker/gates.mjs', 'app/core/tracker/vocab.mjs', 'app/core/tracker/words.mjs',
  'app/core/tracker/scenarios.mjs', 'app/core/tracker/practice.mjs', 'app/core/tracker/model.mjs', 'app/core/tracker/index.mjs', 'app/core/practice.mjs', 'app/core/stand-ins.mjs',
  'app/core/capabilities.mjs', 'experiments/tracker-v2/builder1.mjs', 'experiments/tracker-v2/e8.mjs', 'experiments/tracker-v2/prose.mjs', 'experiments/tracker-v2/run-builder1.mjs',
  'experiments/tracker-v2/run-e8.mjs', 'experiments/tracker/trace.mjs', 'experiments/tracker/run.mjs', 'experiments/tracker/ledger.mjs', 'experiments/tracker/eval-e8.mjs'];
const INPUTS = ['research/surface-20261021/eval/cases.json', 'research/tracker-20261021/gold-builder1.json', 'research/need-router-20261014/tracker-e8/gold.json',
  'research/need-router-20261014/tracker-e8/extraction/haiku.s0.json', 'policy/models.json', 'experiments/surface/b0.mjs'];
const records = () => Object.fromEntries(['b-h-1', 'b-m-1', 'b0-h-1', 'b-h-fix-1', 'b-m-fix-1'].flatMap(arm => {
  const dir = path.join(ROOT, 'research/surface-20261021/runs', arm, 'records');
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => [`${arm}/${f}`, sha(readFileSync(path.join(dir, f)))]);
}));
const templates = () => Object.fromEntries(readdirSync(path.join(ROOT, 'app/core/templates')).sort().map(f => [f, sha(readFileSync(path.join(ROOT, 'app/core/templates', f)))]));
function manifest() {
  return {
    prereg: 'research/tracker-20261021/PREREG-TRACKER.md',
    code: Object.fromEntries(CODE.map(f => [f, sha(readFileSync(path.join(ROOT, f)))])),
    prompts: { [CAPTURE_PROMPT_ID]: sha(CAPTURE_SYSTEM), [BIND_PROMPT_ID]: sha(BIND_SYSTEM), [PROSE_PROMPT_ID]: sha(PROSE_SYSTEM) },
    inputs: Object.fromEntries(INPUTS.map(f => [f, sha(readFileSync(path.join(ROOT, f)))])),
    templates: templates(),
    builder1Records: records(),
  };
}
const m = manifest();
if (process.argv.includes('--check')) {
  if (!existsSync(FILE)) { console.error('no freeze.json'); process.exit(1); }
  const f = JSON.parse(readFileSync(FILE, 'utf8'));
  // A drifted file is accepted only when a recorded deviation (deviations.json, PREREG-TRACKER §8) names its exact current hash.
  const devFile = path.join(ROOT, 'research/tracker-20261021/deviations.json');
  const devs = existsSync(devFile) ? Object.entries(JSON.parse(readFileSync(devFile, 'utf8'))).filter(([k]) => /^D\d+$/.test(k)) : [];
  const drift = [], accepted = [];
  for (const k of ['code', 'prompts', 'inputs', 'templates', 'builder1Records']) for (const [name, h] of Object.entries(f[k])) {
    if (m[k][name] === h) continue;
    const dev = devs.find(([, d]) => d.files?.[name] === m[k][name]);
    if (dev) accepted.push(`${k}: ${name} (${dev[0]})`); else drift.push(`${k}: ${name}`);
  }
  if (drift.length) { console.error(`drift since the freeze:\n${drift.join('\n')}`); process.exit(1); }
  console.log(accepted.length ? `no unrecorded drift; recorded deviations: ${accepted.join(', ')}` : 'no drift');
} else {
  writeFileSync(FILE, `${JSON.stringify({ frozenAt: new Date().toISOString(), ...m }, null, 1)}\n`);
  console.log(`wrote ${path.relative(ROOT, FILE)}`);
}
